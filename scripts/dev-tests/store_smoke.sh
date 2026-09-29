#!/usr/bin/env bash
# End-to-end smoke of the opt-in SQLite store (-store), using the real
# engine and devsensor. Complements the unit tests in internal/store
# with four deployment-facing scenarios:
#
#   1. default mode (no -store)      -> store_enabled=false, store_events=0:
#                                       without the flag the engine behaves
#                                       exactly as before (opt-in default)
#   2. store on + one devsensor      -> store_enabled=true, store_events>0,
#      replay                          store_alerts>0, and /api/events serves
#                                      the stored history (count == store_events)
#   3. kill + restart on the SAME    -> in-process counters reset to 0 while
#      store file                      store_events/store_alerts re-seed to the
#                                      pre-kill values; the API still serves the
#                                      full history and free-text search works
#                                      against the store
#   4. unopenable store file         -> FATAL startup error (exit != 0) with a
#                                       loud log line: persistence the operator
#                                       believes is armed must not silently
#                                       stay off
#
# NOT exercised here (covered by the unit tests in internal/store): the
# 5-minute retention pruner and same-ID insert idempotence. Note that a
# devsensor replay generates FRESH event ids on every run, so re-running
# the scenario ADDS rows by design; idempotence applies to re-inserting
# the same ids, not to the demo sensor producing new ones.
#
# Usage: scripts/dev-tests/store_smoke.sh [engine-binary] [devsensor-binary]
# Missing binaries are built automatically (requires go >= 1.22 in PATH).
# Exit 0 only if all four scenarios behave as documented in README.md
# ("Persistent storage (SQLite, opt-in)").

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${STORE_SMOKE_PORT:-17887}"
API="${STORE_SMOKE_API_PORT:-17888}"
WORK="$(mktemp -d)"
ENGINE="${1:-$WORK/engine}"
DEVSENSOR="${2:-$WORK/devsensor}"
FAILED=0
PIDS=()

log()  { printf '[store_smoke] %s\n' "$*"; }
fail() { printf '[store_smoke] FAIL: %s\n' "$*" >&2; FAILED=1; }

bail_with_log() { # $1 = message, $2 = log file whose tail explains the failure
  fail "$1"
  echo "[store_smoke] ---- tail of $2 ----" >&2
  tail -5 "$2" 2>/dev/null >&2
  exit 1
}

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; done
  [ "${SMOKE_KEEP:-0}" = "1" ] && echo "[store_smoke] artifacts kept in $WORK"
  [ "${SMOKE_KEEP:-0}" != "1" ] && rm -rf "$WORK"
  return 0
}
trap cleanup EXIT

port_busy() { # $1 = port; returns 0 (busy) if something already listens
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}
for p in "$PORT" "$API"; do
  if port_busy "$p"; then
    fail "port $p is already in use (leftover engine? set STORE_SMOKE_PORT/STORE_SMOKE_API_PORT)"; exit 1
  fi
done

# --- build binaries if not supplied
if [ ! -x "$ENGINE" ] || [ ! -x "$DEVSENSOR" ]; then
  log "building engine and devsensor with go..."
  (cd "$ROOT" && go build -o "$WORK/engine" ./cmd/engine && go build -o "$WORK/devsensor" ./cmd/devsensor) || {
    fail "go build failed"; exit 1; }
fi

# exec so the subshell PID ($!) IS the engine process and `kill $!` reaches it
start_engine() { # $1 = log file, $2+ = extra engine flags (e.g. -store, -store-retention)
  local logf="$1"; shift
  (exec "$ENGINE" -addr "127.0.0.1:$PORT" -api "127.0.0.1:$API" \
      -rules "$ROOT/rules" -sequences "$ROOT/sequences" -reload-every 0 "$@" >"$logf" 2>&1) &
  PIDS+=($!)
}

stats_on() { curl -sf "http://127.0.0.1:$API/api/stats" 2>/dev/null; }
field()     { printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | cut -d: -f2; }
field_bool() { printf '%s' "$1" | grep -o "\"$2\":[a-z]*" | cut -d: -f2; }
wait_api() { for _ in $(seq 1 50); do stats_on >/dev/null && return 0; sleep 0.2; done; return 1; }
# the telemetry lists answer a bare JSON array when the store is attached
events_count() { curl -sf "http://127.0.0.1:$API/api/events?limit=200" 2>/dev/null \
                 | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'; }
alerts_count() { curl -sf "http://127.0.0.1:$API/api/alerts?limit=200" 2>/dev/null \
                 | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'; }

# --- scenario 1: default mode, store off -> identical to the pre-store engine
log "scenario 1: no -store -> store_enabled=false, counters at zero"
start_engine "$WORK/s1.log"
wait_api || bail_with_log "engine API did not come up (binary stale? engine crashed?)" "$WORK/s1.log"
S="$(stats_on)"
[ "$(field_bool "$S" store_enabled)" = "false" ] || fail "scenario 1: store_enabled=$(field_bool "$S" store_enabled), expected false"
[ "$(field "$S" store_events)" = "0" ] || fail "scenario 1: store_events=$(field "$S" store_events) without -store, expected 0"
log "  store_enabled=$(field_bool "$S" store_enabled) store_events=$(field "$S" store_events)"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null; PIDS=()
sleep 0.3

# --- scenario 2: store on + one replay -> history persisted and served
log "scenario 2: -store + one devsensor replay -> counters live, lists read the store"
DB="$WORK/store.db"
start_engine "$WORK/s2.log" -store "$DB"
wait_api || bail_with_log "engine API did not come up with -store" "$WORK/s2.log"
S="$(stats_on)"
[ "$(field_bool "$S" store_enabled)" = "true" ] || fail "scenario 2: store_enabled=$(field_bool "$S" store_enabled), expected true"
# devsensor has no duration flag; bound the feed externally with timeout
# (124 = killed after the feed window, which is the expected outcome here).
timeout 30 "$DEVSENSOR" -addr "127.0.0.1:$PORT" >"$WORK/s2.sensor.log" 2>&1
RC=$?
[ $RC -eq 0 ] || [ $RC -eq 124 ] || fail "scenario 2: devsensor exited $RC against a store-enabled engine (see $WORK/s2.sensor.log)"
sleep 1
S="$(stats_on)"
EV="$(field "$S" store_events)"; AL="$(field "$S" store_alerts)"
[ "${EV:-0}" -gt 0 ] || fail "scenario 2: store_events=$EV after a replay, expected > 0"
[ "${AL:-0}" -gt 0 ] || fail "scenario 2: store_alerts=$AL after a replay, expected > 0"
N="$(events_count)"
[ "${N:-0}" -eq "${EV:-1}" ] || fail "scenario 2: /api/events served $N rows, store_events=$EV (expected equal)"
log "  store_events=$EV store_alerts=$AL /api/events=$N"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null; PIDS=()
sleep 0.3

# --- scenario 3: restart on the same file -> history re-seeds, rings don't
log "scenario 3: kill + restart on the same file -> counters re-seed, history served"
start_engine "$WORK/s3.log" -store "$DB"
wait_api || bail_with_log "restarted engine did not come up on the same store file" "$WORK/s3.log"
S="$(stats_on)"
EV3="$(field "$S" store_events)"; AL3="$(field "$S" store_alerts)"; INPROC="$(field "$S" events_total)"
[ "${EV3:-0}" -eq "${EV:-1}" ] || fail "scenario 3: store_events=$EV3 after restart, expected $EV"
[ "${AL3:-0}" -eq "${AL:-1}" ] || fail "scenario 3: store_alerts=$AL3 after restart, expected $AL"
[ "${INPROC:-1}" -eq 0 ] || fail "scenario 3: events_total=$INPROC in process after restart, expected 0 (history lives in the store, not the rings)"
N3="$(events_count)"
[ "${N3:-0}" -eq "${EV3:-1}" ] || fail "scenario 3: /api/events served $N3 rows after restart, store_events=$EV3"
Q="$(curl -sf "http://127.0.0.1:$API/api/events?q=lsass" 2>/dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
[ "${Q:-0}" -ge 1 ] || fail "scenario 3: q=lsass served $Q rows from the store, expected >= 1"
log "  in-process events_total=$INPROC, store re-seeded $EV3 events / $AL3 alerts, q=lsass -> $Q"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null; PIDS=()
sleep 0.3

# --- scenario 4: unopenable store -> FATAL, never a silent no-store start
log "scenario 4: store path that cannot be opened -> FATAL startup error"
mkdir -p "$WORK/closed.db" # a directory: sqlite cannot open it as a db file
"$ENGINE" -addr "127.0.0.1:$PORT" -api "127.0.0.1:$API" -rules "$ROOT/rules" \
    -store "$WORK/closed.db" >"$WORK/s4.log" 2>&1
RC=$?
[ $RC -ne 0 ] || fail "scenario 4: engine exited 0 with an unopenable store, expected FATAL"
grep -q 'store' "$WORK/s4.log" || fail "scenario 4: no store error in the startup log"
log "  exit=$RC, log: $(grep -m1 store "$WORK/s4.log" | head -c 120)"

# --- verdict
if [ "$FAILED" -eq 0 ]; then
  log "ALL 4 SCENARIOS OK"
  exit 0
fi
fail "one or more scenarios failed (see the lines above)"
exit 1

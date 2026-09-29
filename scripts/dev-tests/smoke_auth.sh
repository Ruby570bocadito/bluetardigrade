#!/usr/bin/env bash
# End-to-end smoke of the ingest auth handshake (AUTH <token>), using the
# real engine and devsensor binaries. Complements the unit tests in
# internal/ingest with the four deployment-facing scenarios:
#
#   1. engine with token + sensor with the same token -> accepted, events flow
#   2. engine with token + sensor with a WRONG token  -> sensor fails, ack error
#   3. engine WITHOUT token + sensor WITH a token     -> sensor fails with guidance
#   4. engine bound to 0.0.0.0 without a token        -> startup warning
#
# Usage: scripts/dev-tests/smoke_auth.sh [engine-binary] [devsensor-binary]
# Missing binaries are built automatically (requires go >= 1.22 in PATH).
# Exit 0 only if all four scenarios behave as documented in README.md
# ("Ingest authentication (shared token)").

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${SMOKE_PORT:-17877}"
API="${SMOKE_API_PORT:-17878}"
TOKEN="smoke-token-$$"
WORK="$(mktemp -d)"
[ "${SMOKE_KEEP:-0}" = "1" ] || RM_WORK=1
ENGINE="${1:-$WORK/engine}"
DEVSENSOR="${2:-$WORK/devsensor}"
FAILED=0
PIDS=()

log()  { printf '[smoke_auth] %s\n' "$*"; }
fail() { printf '[smoke_auth] FAIL: %s\n' "$*" >&2; FAILED=1; }

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; done
  [ "${RM_WORK:-0}" = "1" ] && rm -rf "$WORK"
  [ "${RM_WORK:-0}" != "1" ] && echo "[smoke_auth] artifacts kept in $WORK"
  return 0
}
trap cleanup EXIT

port_busy() { # $1 = port; returns 0 (busy) if something already listens
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}
for p in "$PORT" "$API" "$((PORT+10))" "$((API+10))" "$((PORT+20))" "$((API+20))"; do
  if port_busy "$p"; then
    fail "port $p is already in use (leftover engine? set SMOKE_PORT/SMOKE_API_PORT)"; exit 1
  fi
done

# --- build binaries if not supplied
if [ ! -x "$ENGINE" ] || [ ! -x "$DEVSENSOR" ]; then
  log "building engine and devsensor with go..."
  (cd "$ROOT" && go build -o "$WORK/engine" ./cmd/engine && go build -o "$WORK/devsensor" ./cmd/devsensor) || {
    fail "go build failed"; exit 1; }
fi

# exec so the subshell PID ($!) IS the engine process and `kill $!` reaches it
start_engine() { # $1 = bind addr, $2 = token ("" = disabled), $3 = api port, $4 = log file
  (cd "$WORK" && exec "$ENGINE" -addr "$1" -api "127.0.0.1:$3" \
      -rules "$ROOT/rules" -sequences "$ROOT/sequences" \
      ${2:+-token "$2"} -reload-every 0 >"$4" 2>&1) &
  PIDS+=($!)
}

stats_on() { curl -sf "http://127.0.0.1:$1/api/stats" 2>/dev/null; }
stats() { stats_on "$API"; }
wait_api_on() { # $1 = api port; wait until that engine's HTTP API answers
  for _ in $(seq 1 50); do stats_on "$1" >/dev/null && return 0; sleep 0.2; done
  return 1
}

# --- scenario 1: matching tokens -> accepted and events ingested
log "scenario 1: engine+sensor with matching token"
start_engine "127.0.0.1:$PORT" "$TOKEN" "$API" "$WORK/s1.log"
wait_api_on "$API" || { fail "engine API did not come up (see $WORK/s1.log)"; exit 1; }
# devsensor has no duration flag; bound the feed externally with timeout
# (124 = killed after the feed window, which is the expected outcome here).
timeout 6 "$DEVSENSOR" -addr "127.0.0.1:$PORT" -token "$TOKEN" \
    -interval 100ms >"$WORK/s1.sensor.log" 2>&1
RC=$?
[ $RC -eq 0 ] || [ $RC -eq 124 ] || fail "scenario 1: devsensor exited $RC with a correct token (see $WORK/s1.sensor.log)"
sleep 1
TOTAL=$(stats | grep -o '"events_total":[0-9]*' | cut -d: -f2)
[ "${TOTAL:-0}" -gt 0 ] || fail "scenario 1: events_total=$TOTAL, expected > 0"
REJECTED=$(stats | grep -o '"ingest_rejected":[0-9]*' | cut -d: -f2)
[ "${REJECTED:-1}" -eq 0 ] || fail "scenario 1: ingest_rejected=$REJECTED, expected 0"
log "  events_total=$TOTAL ingest_rejected=$REJECTED"

# --- scenario 2: wrong token -> sensor rejected, no events accepted
log "scenario 2: sensor with a wrong token"
BEFORE=$TOTAL
timeout 20 "$DEVSENSOR" -addr "127.0.0.1:$PORT" -token "WRONG-$$" \
    >"$WORK/s2.sensor.log" 2>&1
RC=$?
[ $RC -ne 0 ] || fail "scenario 2: devsensor exited 0 despite auth rejection"
grep -q "auth" "$WORK/s2.sensor.log" || fail "scenario 2: sensor log lacks the ack error (see $WORK/s2.sensor.log)"
sleep 1
AFTER=$(stats | grep -o '"events_total":[0-9]*' | cut -d: -f2)
[ "$AFTER" -eq "$BEFORE" ] || fail "scenario 2: events_total moved ($BEFORE -> $AFTER) despite rejection"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null

# --- scenario 3: sensor with token against a tokenless engine -> visible failure
log "scenario 3: sensor with token against a tokenless engine"
start_engine "127.0.0.1:$((PORT+10))" "" "$((API+10))" "$WORK/s3.log"
wait_api_on "$((API+10))" || { fail "scenario 3: tokenless engine did not come up (see $WORK/s3.log)"; exit 1; }
timeout 20 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+10))" -token "$TOKEN" \
    >"$WORK/s3.sensor.log" 2>&1
RC=$?
[ $RC -ne 0 ] || fail "scenario 3: devsensor exited 0 against a tokenless engine"
grep -qi "token" "$WORK/s3.sensor.log" || fail "scenario 3: sensor log lacks configuration guidance (see $WORK/s3.sensor.log)"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null

# --- scenario 4: open bind without token -> startup warning
log "scenario 4: bind 0.0.0.0 without token"
start_engine "0.0.0.0:$((PORT+20))" "" "$((API+20))" "$WORK/s4.log"
sleep 1.5
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null
grep -qi "warning" "$WORK/s4.log" || fail "scenario 4: engine log lacks the open-bind warning (see $WORK/s4.log)"

if [ $FAILED -eq 0 ]; then
  log "ALL 4 SCENARIOS OK"
else
  log "FAILURES DETECTED (see lines above)"
fi
exit $FAILED

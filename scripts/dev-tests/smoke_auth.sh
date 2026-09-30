#!/usr/bin/env bash
# End-to-end smoke of the ingest auth handshake (AUTH <token>), token
# rotation and outbound webhook auth, using the real engine, devsensor
# and the repo's webhook_receiver.py. Complements the unit tests in
# internal/ingest and internal/webhook with six deployment-facing
# scenarios:
#
#   1. engine with token + sensor with the same token -> accepted, events flow
#   2. engine with token + sensor with a WRONG token  -> sensor fails, ack error
#   3. engine WITHOUT token + sensor WITH a token     -> sensor fails with guidance
#   4. engine bound to 0.0.0.0 without a token        -> startup warning
#   5. rotation window (-token-previous)              -> old AND new accepted,
#                                                        intruder still rejected
#   6. webhook delivery with -webhook-token           -> receiver confirms the
#        Bearer header; without the header a demanding receiver 401s and the
#        engine reports webhook_failed
#   7. local API auth (-api-token)                    -> /api/* 401 without the
#        Bearer token, 200 with it; /api/health stays open; /metrics rides
#        the same credential (401/200 + valid text exposition)
#   8. alert lifecycle write is gated too             -> POST /api/alerts/{id}/status
#        401 without the Bearer token, 200 with it (r6)
#
# Usage: scripts/dev-tests/smoke_auth.sh [engine-binary] [devsensor-binary]
# Missing binaries are built automatically (requires go >= 1.22 in PATH).
# Exit 0 only if all eight scenarios behave as documented in README.md
# ("Ingest authentication (shared token)" + "Rotating the token without
# downtime" + the webhook and local API auth sections).

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

bail_with_log() { # $1 = message, $2 = log file whose tail explains the failure
  fail "$1"
  echo "[smoke_auth] ---- tail of $2 ----" >&2
  tail -5 "$2" 2>/dev/null >&2
  exit 1
}

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
for p in "$PORT" "$API" "$((PORT+10))" "$((API+10))" "$((PORT+20))" "$((API+20))" \
         "$((PORT+30))" "$((API+30))" "$((PORT+40))" "$((PORT+41))" "$((API+41))" \
         "$((PORT+42))" "$((PORT+43))" "$((API+44))" "$((PORT+50))" "$((API+50))"; do
  if port_busy "$p"; then
    fail "port $p is already in use (leftover engine? set SMOKE_PORT/SMOKE_API_PORT)"; exit 1
  fi
done

# --- build binaries if not supplied
if [ ! -x "$ENGINE" ] || [ ! -x "$DEVSENSOR" ]; then
  command -v go >/dev/null || { fail "FALLO preflight: go no está en PATH (exporta el toolchain para compilar los binarios)"; exit 1; }
  log "building engine and devsensor with go..."
  (cd "$ROOT" && go build -o "$WORK/engine" ./cmd/engine && go build -o "$WORK/devsensor" ./cmd/devsensor) || {
    fail "go build failed"; exit 1; }
fi

# exec so the subshell PID ($!) IS the engine process and `kill $!` reaches it
start_engine() { # $1 = bind addr, $2 = token ("" = disabled), $3 = api port,
                 # $4 = log file, $5+ = extra engine flags (e.g. -token-previous)
  local addr="$1" tok="$2" apiport="$3" logf="$4"
  shift 4
  (cd "$WORK" && exec "$ENGINE" -addr "$addr" -api "127.0.0.1:$apiport" \
      -rules "$ROOT/rules" -sequences "$ROOT/sequences" \
      ${tok:+-token "$tok"} -reload-every 0 "$@" >"$logf" 2>&1) &
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
wait_api_on "$API" || bail_with_log "engine API did not come up (binary stale? engine crashed?)" "$WORK/s1.log"
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
wait_api_on "$((API+10))" || bail_with_log "scenario 3: tokenless engine did not come up" "$WORK/s3.log"
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

# --- scenario 5: rotation window -> old AND new tokens accepted, intruder rejected
log "scenario 5: rotation window (-token-previous)"
TOKEN_NEW="rot-new-$$"
TOKEN_OLD="rot-old-$$"
start_engine "127.0.0.1:$((PORT+30))" "$TOKEN_NEW" "$((API+30))" "$WORK/s5.log" \
    -token-previous "$TOKEN_OLD"
wait_api_on "$((API+30))" || bail_with_log "scenario 5: rotating engine did not come up (does the binary know -token-previous?)" "$WORK/s5.log"
grep -q "rotation window OPEN" "$WORK/s5.log" \
  || fail "scenario 5: startup banner lacks 'rotation window OPEN' (see $WORK/s5.log)"
timeout 5 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+30))" -token "$TOKEN_OLD" -interval 100ms \
  >"$WORK/s5.old.log" 2>&1
RC=$?; [ $RC -eq 0 ] || [ $RC -eq 124 ] || fail "scenario 5: OLD token rejected during window (see $WORK/s5.old.log)"
OLD_TOTAL=$(stats_on "$((API+30))" | grep -o '"events_total":[0-9]*' | cut -d: -f2)
[ "${OLD_TOTAL:-0}" -gt 0 ] || fail "scenario 5: old token accepted but events_total=$OLD_TOTAL"
timeout 5 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+30))" -token "$TOKEN_NEW" -interval 100ms \
  >"$WORK/s5.new.log" 2>&1
RC=$?; [ $RC -eq 0 ] || [ $RC -eq 124 ] || fail "scenario 5: NEW token rejected during window (see $WORK/s5.new.log)"
NEW_TOTAL=$(stats_on "$((API+30))" | grep -o '"events_total":[0-9]*' | cut -d: -f2)
[ "${NEW_TOTAL:-0}" -gt "${OLD_TOTAL:-0}" ] \
  || fail "scenario 5: new token accepted but events_total did not grow ($OLD_TOTAL -> $NEW_TOTAL)"
timeout 20 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+30))" -token "INTRUDER-$$" \
  >"$WORK/s5.intruder.log" 2>&1
RC=$?; [ $RC -ne 0 ] || fail "scenario 5: intruder token ACCEPTED during window"
REJ=$(stats_on "$((API+30))" | grep -o '"ingest_rejected":[0-9]*' | cut -d: -f2)
[ "${REJ:-0}" -ge 1 ] || fail "scenario 5: ingest_rejected=$REJ after intruder, expected >= 1"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null
log "  rotation: old=$OLD_TOTAL new=$NEW_TOTAL intruder_rejected=$REJ"

# --- scenario 6: webhook delivery with Authorization: Bearer, verified by the
#     repo's own receiver (positive: correct secret; negative: demanding
#     receiver + tokenless engine -> 401s -> webhook_failed)
log "scenario 6: webhook auth (-webhook-token vs receiver --secret)"
WEBHOOK_TOKEN="whk-$$"
RCV_PORT=$((PORT+40)); RCV_PORT2=$((PORT+42))

# positive: engine sends the Bearer token, receiver counts the delivery
python3 "$ROOT/scripts/dev-tests/webhook_receiver.py" --host 127.0.0.1 --port "$RCV_PORT" \
    --secret "$WEBHOOK_TOKEN" --expect 1 --timeout 40 >"$WORK/s6.receiver.log" 2>&1 &
RCV_PID=$!; PIDS+=("$RCV_PID")
for _ in $(seq 1 25); do port_busy "$RCV_PORT" && break; sleep 0.2; done
port_busy "$RCV_PORT" || { fail "scenario 6: webhook receiver did not come up (see $WORK/s6.receiver.log)"; exit 1; }
start_engine "127.0.0.1:$((PORT+41))" "" "$((API+41))" "$WORK/s6.log" \
    -webhook "http://127.0.0.1:$RCV_PORT/alerts" -webhook-token "$WEBHOOK_TOKEN"
wait_api_on "$((API+41))" || bail_with_log "scenario 6: webhook engine did not come up" "$WORK/s6.log"
timeout 8 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+41))" -interval 100ms \
  >"$WORK/s6.sensor.log" 2>&1
wait "$RCV_PID"; RC=$?
RX=$(grep -o '"received": [0-9]*' "$WORK/s6.receiver.log" | cut -d' ' -f2)
WAUTH=$(grep -o '"with_auth": [0-9]*' "$WORK/s6.receiver.log" | cut -d' ' -f2)
[ "$RC" -eq 0 ] && [ "${RX:-0}" -ge 1 ] && [ "${WAUTH:-0}" -ge 1 ] \
  || fail "scenario 6: Bearer delivery not confirmed (receiver exit=$RC received=${RX:-0} with_auth=${WAUTH:-0}; see $WORK/s6.receiver.log)"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null
log "  webhook positive: received=${RX:-0} with_auth=${WAUTH:-0}"

# negative: tokenless engine vs demanding receiver -> 401s -> webhook_failed
python3 "$ROOT/scripts/dev-tests/webhook_receiver.py" --host 127.0.0.1 --port "$RCV_PORT2" \
    --secret "OTHER-$$_$$" --expect 1 --timeout 15 >"$WORK/s6b.receiver.log" 2>&1 &
RCV2_PID=$!; PIDS+=("$RCV2_PID")
for _ in $(seq 1 25); do port_busy "$RCV_PORT2" && break; sleep 0.2; done
port_busy "$RCV_PORT2" || { fail "scenario 6b: receiver did not come up (see $WORK/s6b.receiver.log)"; exit 1; }
start_engine "127.0.0.1:$((PORT+43))" "" "$((API+44))" "$WORK/s6b.log" \
    -webhook "http://127.0.0.1:$RCV_PORT2/alerts"
wait_api_on "$((API+44))" || bail_with_log "scenario 6b: tokenless webhook engine did not come up" "$WORK/s6b.log"
timeout 8 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+43))" -interval 100ms \
  >"$WORK/s6b.sensor.log" 2>&1
wait "$RCV2_PID"; RC=$?
[ "$RC" -ne 0 ] || fail "scenario 6b: receiver counted a delivery that should have been 401'd"
FAILED_WH=$(stats_on "$((API+44))" | grep -o '"webhook_failed":[0-9]*' | cut -d: -f2)
[ "${FAILED_WH:-0}" -ge 1 ] \
  || fail "scenario 6b: webhook_failed=$FAILED_WH after 401 deliveries, expected >= 1 (see $WORK/s6b.log)"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null
log "  webhook negative: receiver_exit=$RC webhook_failed=$FAILED_WH"

# --- scenario 7: local API auth (-api-token) -> /api/* gated, /api/health open
log "scenario 7: local API bearer auth (-api-token)"
API_TOKEN="api-$$_$$"
start_engine "127.0.0.1:$((PORT+50))" "" "$((API+50))" "$WORK/s7.log" -api-token "$API_TOKEN"
# wait on /api/health (stays open on purpose): /api/stats answers 401 now
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$((API+50))/api/health" >/dev/null && break; sleep 0.2; done
curl -sf "http://127.0.0.1:$((API+50))/api/health" >/dev/null \
  || bail_with_log "scenario 7: authed API engine did not come up" "$WORK/s7.log"
RC_NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$((API+50))/api/stats")
RC_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $API_TOKEN" "http://127.0.0.1:$((API+50))/api/stats")
RC_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$((API+50))/api/health")
[ "$RC_NOAUTH" = "401" ] || fail "scenario 7: /api/stats without token answered $RC_NOAUTH, expected 401"
[ "$RC_AUTH" = "200" ] || fail "scenario 7: /api/stats with Bearer token answered $RC_AUTH, expected 200"
[ "$RC_HEALTH" = "200" ] || fail "scenario 7: /api/health answered $RC_HEALTH, expected 200 (stays open for probes)"
# RFC 7235: the 401 must carry a WWW-Authenticate Bearer challenge and an
# actionable body naming the knob; /api/health must carry neither (auth()
# passes it through untouched)
CHALLENGE=$(curl -s -D - -o /dev/null "http://127.0.0.1:$((API+50))/api/stats" | tr -d '\r' | grep -i '^www-authenticate:')
echo "$CHALLENGE" | grep -qi 'bearer' \
  || fail "scenario 7: 401 without a WWW-Authenticate Bearer challenge (got: '$CHALLENGE')"
BODY_NOAUTH=$(curl -s "http://127.0.0.1:$((API+50))/api/stats")
echo "$BODY_NOAUTH" | grep -q 'api-token' \
  || fail "scenario 7: 401 body not actionable (no -api-token hint): $BODY_NOAUTH"
CHALLENGE_HEALTH=$(curl -s -D - -o /dev/null "http://127.0.0.1:$((API+50))/api/health" | tr -d '\r' | grep -ci '^www-authenticate:')
[ "$CHALLENGE_HEALTH" = "0" ] \
  || fail "scenario 7: /api/health carries a WWW-Authenticate challenge (must stay probe-clean)"
# /metrics rides the same middleware: 401 without the credential (with the
# challenge), 200 + text exposition with it, counters actually present
RC_M_NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$((API+50))/metrics")
RC_M_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $API_TOKEN" "http://127.0.0.1:$((API+50))/metrics")
[ "$RC_M_NOAUTH" = "401" ] || fail "scenario 7: /metrics without token answered $RC_M_NOAUTH, expected 401"
[ "$RC_M_AUTH" = "200" ] || fail "scenario 7: /metrics with Bearer token answered $RC_M_AUTH, expected 200"
METRICS=$(curl -s -H "Authorization: Bearer $API_TOKEN" "http://127.0.0.1:$((API+50))/metrics")
echo "$METRICS" | grep -q '^sf_events_total ' \
  || fail "scenario 7: /metrics lacks the sf_events_total family (body: $(echo "$METRICS" | head -3))"
echo "$METRICS" | grep -q '^# TYPE sf_events_total counter' \
  || fail "scenario 7: /metrics output lacks HELP/TYPE lines (not a valid exposition)"
M_CT=$(curl -s -o /dev/null -w "%{content_type}" -H "Authorization: Bearer $API_TOKEN" "http://127.0.0.1:$((API+50))/metrics")
echo "$M_CT" | grep -q 'text/plain' \
  || fail "scenario 7: /metrics Content-Type '$M_CT' is not text/plain exposition"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null
log "  api auth: no_token=$RC_NOAUTH bearer=$RC_AUTH health=$RC_HEALTH metrics=$RC_M_NOAUTH/$RC_M_AUTH challenge=ok body=ok"

# --- scenario 8: the WRITE surface is gated too -> POST /api/alerts/{id}/status
# 401 without the Bearer token, 200 with it. A triage endpoint that could be
# called unauthenticated would let anyone rewrite the operator's queue.
log "scenario 8: alert lifecycle write is bearer-gated"
API_TOKEN="smoke-lifecycle-token"
PORT=$((API+51))
"$ENGINE" -addr "127.0.0.1:$((PORT+1))" -api "127.0.0.1:$PORT" -api-token "$API_TOKEN" \
  -rules "$ROOT/rules" -lifecycle "$WORK/s8-lifecycle.json" > "$WORK/s8.log" 2>&1 &
PIDS+=("$!")
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 0.2; done
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null \
  || bail_with_log "scenario 8: authed lifecycle engine did not come up" "$WORK/s8.log"
RC_LC_NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'Content-Type: application/json' \
  -d '{"status":"closed"}' "http://127.0.0.1:$PORT/api/alerts/ffffffffffffffff/status")
RC_LC_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"status":"acknowledged","by":"smoke"}' "http://127.0.0.1:$PORT/api/alerts/ffffffffffffffff/status")
[ "$RC_LC_NOAUTH" = "401" ] || fail "scenario 8: lifecycle POST without token answered $RC_LC_NOAUTH, expected 401"
[ "$RC_LC_AUTH" = "200" ] || fail "scenario 8: lifecycle POST with Bearer answered $RC_LC_AUTH, expected 200"
CHALLENGE_LC=$(curl -s -D - -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d '{"status":"closed"}' "http://127.0.0.1:$PORT/api/alerts/ffffffffffffffff/status" | tr -d '\r' | grep -i '^www-authenticate:')
echo "$CHALLENGE_LC" | grep -qi 'bearer' \
  || fail "scenario 8: lifecycle 401 without WWW-Authenticate Bearer challenge"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null
log "  lifecycle auth: no_token=$RC_LC_NOAUTH bearer=$RC_LC_AUTH challenge=ok"

if [ $FAILED -eq 0 ]; then
  log "ALL 8 SCENARIOS OK"
else
  log "FAILURES DETECTED (see lines above)"
fi
exit $FAILED

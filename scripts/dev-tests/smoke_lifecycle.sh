#!/usr/bin/env bash
# End-to-end verification of the alert lifecycle (r6): triage decisions
# (acknowledged / closed / reopen with note) recorded against the REAL
# engine binary, persisted through a restart via -lifecycle, and served
# back merged into GET /api/alerts and the alerts export.
#
# Scenarios (exit 0 only if all pass):
#   1. raise an alert from real telemetry (rule hit via the TCP feed)
#   2. GET /api/alerts carries the engine id and status "new"
#   3. POST /api/alerts/{id}/status acknowledged with note -> 200 + entry
#   4. GET /api/alerts shows the merged overlay (status/note/by/at)
#   5. POST an invalid status -> 400 with an actionable error
#   6. POST with a malformed id -> 400
#   7. alerts CSV export carries id/status columns
#   8. ENGINE RESTART -> the triage state survives (file persistence)
#
# Usage: scripts/dev-tests/smoke_lifecycle.sh [engine-binary]
# The engine is built automatically when missing (go >= 1.22 in PATH).

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API="${SMOKE_API_PORT:-17879}"
INGEST="${SMOKE_INGEST_PORT:-17877}"
WORK="$(mktemp -d)"
ENGINE="${1:-$WORK/sf-engine}"
PASS=0
FAIL=0

cleanup() { kill "$ENGINE_PID" 2>/dev/null; wait "$ENGINE_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "  ok: $*"; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL: $*"; }

api() { curl -s -m 5 "http://127.0.0.1:${API}$1"; }
api_post() {
  curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' -d "$2" "http://127.0.0.1:${API}$1"
}

start_engine() {
  "$ENGINE" -api "127.0.0.1:${API}" -addr "127.0.0.1:${INGEST}" \
    -lifecycle "$WORK/lifecycle.json" -rules "$ROOT/rules" \
    -sequences "$WORK/no-sequences" -suppressions "" \
    > "$WORK/engine.log" 2>&1 &
  ENGINE_PID=$!
  for _ in $(seq 1 50); do
    if api /api/health | grep -q '"ok"'; then return 0; fi
    sleep 0.2
  done
  say "engine did not become healthy:"; cat "$WORK/engine.log"; exit 1
}

say "== smoke_lifecycle: alert triage against the real engine =="

if [ ! -x "$ENGINE" ]; then
  command -v go >/dev/null || { say "FALLO preflight: go no está en PATH (exporta el toolchain para compilar el engine)"; exit 1; }
  (cd "$ROOT" && go build -o "$ENGINE" ./cmd/engine) || { say "build failed"; exit 1; }
fi
mkdir -p "$WORK/no-sequences"

start_engine
say "-- scenario 1-2: real telemetry raises an alert with an id"

# rundll32 + comsvcs.dll + MiniDump -> the LSASS comsvcs rule fires
EVENT_ID="e2e-$(date +%s)"
printf '{"id":"%s","timestamp":"%s","type":"process.create","source":"e2e","host":"LAB-E2E","process":{"pid":4242,"name":"rundll32.exe","command_line":"rundll32.exe comsvcs.dll MiniDump 4242 C:\\\\Temp\\\\dump.full"}}\n' \
  "$EVENT_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | timeout 3 python3 -c "
import socket,sys
s=socket.create_connection(('127.0.0.1',$INGEST),timeout=2)
s.sendall(sys.stdin.buffer.read()); s.close()"

sleep 0.5
ALERTS=$(api "/api/alerts?limit=10")
ALERT_ID=$(printf '%s' "$ALERTS" | python3 -c "
import json,sys
data=json.load(sys.stdin)
hits=[a for a in data if a.get('event_id')=='$EVENT_ID']
print(hits[0]['id'] if hits else '')")
if [ -n "$ALERT_ID" ]; then ok "alert raised with engine id $ALERT_ID"; else bad "no alert for event $EVENT_ID"; cat "$WORK/engine.log"; exit 1; fi

STATUS0=$(printf '%s' "$ALERTS" | python3 -c "
import json,sys
data=json.load(sys.stdin)
hits=[a for a in data if a.get('id')=='$ALERT_ID']
print(hits[0].get('status',''))")
[ "$STATUS0" = "new" ] && ok "initial status is new" || bad "initial status = $STATUS0"

say "-- scenario 3-4: acknowledge with note, merged view reflects it"
CODE=$(api_post "/api/alerts/$ALERT_ID/status" '{"status":"acknowledged","note":"visto en lab, investigando","by":"e2e"}')
[ "$CODE" = "200" ] && ok "POST acknowledged -> 200" || bad "POST acknowledged -> $CODE"

MERGED=$(api "/api/alerts?limit=10")
echo "$MERGED" | python3 -c "
import json,sys
data=json.load(sys.stdin)
hits=[a for a in data if a.get('id')=='$ALERT_ID']
a=hits[0] if hits else {}
assert a.get('status')=='acknowledged', a.get('status')
assert a.get('status_note')=='visto en lab, investigando', a.get('status_note')
assert a.get('status_by')=='e2e'
assert a.get('status_at')
" && ok "GET /api/alerts merges status/note/by/at" || bad "merged view wrong"

say "-- scenario 5-6: bad requests answer 400 with an actionable body"
CODE=$(api_post "/api/alerts/$ALERT_ID/status" '{"status":"resolved"}')
[ "$CODE" = "400" ] && ok "unknown status -> 400" || bad "unknown status -> $CODE"
ERR=$(curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '{"status":"closed"}' "http://127.0.0.1:${API}/api/alerts/zzz/status")
echo "$ERR" | grep -q "malformed alert id" && ok "malformed id -> 400 naming the problem" || bad "malformed id error: $ERR"

say "-- scenario 7: CSV export carries id/status"
CSV=$(curl -s -m 5 "http://127.0.0.1:${API}/api/alerts/export?format=csv")
echo "$CSV" | head -1 | grep -q '^id,status,timestamp,' && ok "csv header has id,status" || bad "csv header: $(echo "$CSV" | head -1)"

say "-- scenario 8: restart keeps the triage record"
kill "$ENGINE_PID" 2>/dev/null; wait "$ENGINE_PID" 2>/dev/null
# Honest contract (r6): the alert RING is in-memory, so after a restart
# the alert itself is gone and the merged view cannot show it. What the
# -lifecycle file guarantees today is the AUDIT RECORD (SQLite, roadmap
# phase 2, will persist alert + lifecycle together and make the state
# visible across restarts). Verify the record survived: the engine logs
# the loaded count and the file carries the entry verbatim.
start_engine
grep -q "alert lifecycle: 1 triage states loaded from" "$WORK/engine.log" \
  && ok "engine logs the persisted triage state on boot" || bad "no load line in engine.log"
python3 - "$WORK/lifecycle.json" "$ALERT_ID" <<'PY' && ok "lifecycle.json carries the acknowledged entry" || bad "file record wrong"
import json,sys
data=json.load(open(sys.argv[1]))
want=sys.argv[2]
entries=data["entries"]
assert data["version"]==1
assert any(e["alert_id"]==want and e["status"]=="acknowledged"
           and e["note"]=="visto en lab, investigando" and e["by"]=="e2e"
           for e in entries), entries
PY

say "=============================="
say "smoke_lifecycle: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ]

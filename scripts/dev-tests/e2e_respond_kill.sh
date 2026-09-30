#!/usr/bin/env bash
# e2e_respond_kill.sh — E2E de la respuesta activa C3 (kill_process,
# iteración 1) sobre binarios reales, sin mocks. Verifica el POSITIVO
# y los NEGATIVOS (cada denegación audita):
#
#   a. kill feliz        → 200 (NO 202, R7a) + proceso muerto + audit
#   b. sin token         → 401 (el token es obligatorio incluso en
#                          loopback, dictamen 04-B)
#   c. sin -allow-kill   → 404 REAL (la superficie no existe)
#   d. operator fuera    → 403 operator_not_allowed
#   e. host remoto       → 403 host_mismatch (R3: el campo host no es
#                          decorativo)
#   f. pid del engine    → 403 self_protected
#   g. cooldown          → 429 cooldown_active (2º kill del mismo pid)
#   h. idempotencia      → 409 en la 2ª petición con la misma clave
#   i. audit JSONL       → cada línea parsea; las denegaciones están
#                          (el NEGATIVO queda registrado)
#
# Uso:
#   bash scripts/dev-tests/e2e_respond_kill.sh
#   SF_E2E_INGEST_PORT=18117 SF_E2E_API_PORT=18118 bash scripts/dev-tests/e2e_respond_kill.sh
#   SF_E2E_ENGINE=./bin/engine bash ...
#
# Requiere: go (para compilar si no hay SF_E2E_ENGINE), curl, python3.
# Puertos por defecto 18117/18118: fuera del rango de los demás e2e.
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
INGEST_PORT="${SF_E2E_INGEST_PORT:-18117}"
API_PORT="${SF_E2E_API_PORT:-18118}"
DISARM_API_PORT=$((API_PORT + 10))
BASE="http://127.0.0.1:$API_PORT"
BASE_DISARM="http://127.0.0.1:$DISARM_API_PORT"
TOKEN="e2e-respond-token"
PASS=0; FAIL=0
ok()  { echo "  OK  - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL- $1"; FAIL=$((FAIL+1)); }
check() { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi; }

command -v curl >/dev/null    || { echo "FALLO preflight: curl no está"; exit 1; }
command -v python3 >/dev/null || { echo "FALLO preflight: python3 no está"; exit 1; }

TMPDIR_E2E=$(mktemp -d /tmp/sf-e2e-respond.XXXXXX)
LOG="$TMPDIR_E2E/engine.log"
LOG_DISARM="$TMPDIR_E2E/engine-disarm.log"
OPS="$TMPDIR_E2E/respond-operators.yaml"
AUDIT="$TMPDIR_E2E/respond-audit.jsonl"
PIDFILE="$TMPDIR_E2E/engine.pid"
: >"$LOG"; : >"$LOG_DISARM"

cleanup() {
  [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
  [ -n "${ENGINE_DISARM_PID:-}" ] && kill "$ENGINE_DISARM_PID" 2>/dev/null
  if [ "${SF_E2E_KEEP:-0}" != "1" ]; then rm -rf "$TMPDIR_E2E"; fi
}
trap cleanup EXIT

# ---- build ----------------------------------------------------------
ENGINE="${SF_E2E_ENGINE:-$REPO/bin/engine}"
if [ ! -x "$ENGINE" ]; then
  echo "* compilando engine (no hay SF_E2E_ENGINE)..."
  (cd "$REPO" && go build -o bin/engine ./cmd/engine) || { echo "FALLO: go build"; exit 1; }
  ENGINE="$REPO/bin/engine"
fi

# hostname real del host de pruebas (el guard R3 compara contra él)
HOSTNAME_E2E=$(python3 -c "import socket;print(socket.gethostname())")

# operadores de laboratorio: solo "e2e-op"
printf 'version: 1\nnames:\n  - e2e-op\n' > "$OPS"

# ---- engine armado --------------------------------------------------
"$ENGINE" run \
  -addr "127.0.0.1:$INGEST_PORT" \
  -api "127.0.0.1:$API_PORT" \
  -rules "$REPO/rules" \
  -allow-kill \
  -api-token "$TOKEN" \
  -respond-operators "$OPS" \
  -respond-audit "$AUDIT" \
  -pidfile "$PIDFILE" \
  >"$LOG" 2>&1 &
ENGINE_PID=$!

# ---- engine desarmado (sin -allow-kill) para el 404 real ------------
"$ENGINE" run \
  -addr "127.0.0.1:$((INGEST_PORT + 10))" \
  -api "127.0.0.1:$((API_PORT + 10))" \
  -rules "$REPO/rules" \
  -api-token "$TOKEN" \
  >"$LOG_DISARM" 2>&1 &
ENGINE_DISARM_PID=$!

wait_up() { # wait_up <base> <log>
  for _ in $(seq 1 50); do
    if curl -s -o /dev/null "$1/api/health"; then return 0; fi
    sleep 0.2
  done
  echo "FALLO: el engine no levantó ($2)"; tail -5 "$2"; exit 1
}
wait_up "$BASE" "$LOG"
wait_up "$BASE_DISARM" "$LOG_DISARM"

post_kill() { # post_kill <url-base> <body-json> <con-token 0|1>
  local code body
  if [ "$3" = "1" ]; then
    code=$(curl -s -o /tmp/sf-respond-body.$$ -w '%{http_code}' -X POST \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "$2" "$1/api/respond/kill")
  else
    code=$(curl -s -o /tmp/sf-respond-body.$$ -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' -d "$2" "$1/api/respond/kill")
  fi
  body=$(cat /tmp/sf-respond-body.$$); rm -f /tmp/sf-respond-body.$$
  echo "$code|$body"
}

echo "== a. kill feliz: 200 (no 202), proceso muerto, audit =="
sleep 300 &
VICTIM=$!
for _ in $(seq 1 50); do [ -d "/proc/$VICTIM" ] && break; sleep 0.1; done
RES=$(post_kill "$BASE" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":$VICTIM,\"process_name\":\"sleep\",\"operator\":\"e2e-op\",\"reason\":\"e2e happy path\",\"rule_id\":\"e2e\",\"idempotency_key\":\"e2e-happy-1\"}" 1)
CODE="${RES%%|*}"; BODY="${RES#*|}"
check "HTTP 200 (R7a: sincrónico, nunca 202)" "$([ "$CODE" = "200" ] && echo 1 || echo 0)"
check "status=executed en el cuerpo" "$(echo "$BODY" | rg -q '"status":"executed"' && echo 1 || echo 0)"
check "mechanism registrado (R1)" "$(echo "$BODY" | rg -q '"mechanism":"(pidfd|fallback)"' && echo 1 || echo 0)"
wait "$VICTIM" 2>/dev/null
check "el proceso murió de verdad" "$(! kill -0 "$VICTIM" 2>/dev/null && echo 1 || echo 0)"

echo "== b. sin token → 401 =="
RES=$(post_kill "$BASE" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":1,\"process_name\":\"x\",\"operator\":\"e2e-op\",\"reason\":\"no token\"}" 0)
CODE="${RES%%|*}"
check "HTTP 401 sin Authorization" "$([ "$CODE" = "401" ] && echo 1 || echo 0)"

echo "== c. sin -allow-kill → 404 real =="
RES=$(post_kill "$BASE_DISARM" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":1,\"process_name\":\"x\",\"operator\":\"e2e-op\",\"reason\":\"disarmed\"}" 1)
CODE="${RES%%|*}"
check "HTTP 404 real (la ruta no existe)" "$([ "$CODE" = "404" ] && echo 1 || echo 0)"

echo "== d. operator fuera de allowlist → 403 =="
RES=$(post_kill "$BASE" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":$((VICTIM+3)),\"process_name\":\"sleep\",\"operator\":\"intruso\",\"reason\":\"not allowlisted\"}" 1)
CODE="${RES%%|*}"; BODY="${RES#*|}"
check "HTTP 403 operator_not_allowed" "$(echo "$RES" | rg -q '^403\|' && echo "$BODY" | rg -q operator_not_allowed && echo 1 || echo 0)"

echo "== e. host remoto → 403 host_mismatch (R3) =="
RES=$(post_kill "$BASE" "{\"host\":\"HOST-REMOTO-DE-OTRO-SENSOR\",\"pid\":$((VICTIM+4)),\"process_name\":\"sleep\",\"operator\":\"e2e-op\",\"reason\":\"replay\"}" 1)
CODE="${RES%%|*}"; BODY="${RES#*|}"
check "HTTP 403 host_mismatch" "$(echo "$RES" | rg -q '^403\|' && echo "$BODY" | rg -q host_mismatch && echo 1 || echo 0)"

echo "== f. pid del propio engine → 403 self_protected =="
EPID=$(cat "$PIDFILE")
RES=$(post_kill "$BASE" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":$EPID,\"process_name\":\"engine\",\"operator\":\"e2e-op\",\"reason\":\"suicidio\"}" 1)
CODE="${RES%%|*}"; BODY="${RES#*|}"
check "HTTP 403 self_protected" "$(echo "$RES" | rg -q '^403\|' && echo "$BODY" | rg -q self_protected && echo 1 || echo 0)"
check "el engine sigue vivo" "$(kill -0 "$EPID" 2>/dev/null && echo 1 || echo 0)"

echo "== g. cooldown → 429 en el 2º kill del mismo pid =="
sleep 300 &
V2=$!
for _ in $(seq 1 50); do [ -d "/proc/$V2" ] && break; sleep 0.1; done
RES=$(post_kill "$BASE" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":$V2,\"process_name\":\"sleep\",\"operator\":\"e2e-op\",\"reason\":\"cooldown test\"}" 1)
wait "$V2" 2>/dev/null
RES2=$(post_kill "$BASE" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":$V2,\"process_name\":\"sleep\",\"operator\":\"e2e-op\",\"reason\":\"cooldown test 2\"}" 1)
CODE2="${RES2%%|*}"; BODY2="${RES2#*|}"
check "HTTP 429 cooldown_active" "$(echo "$RES2" | rg -q '^429\|' && echo "$BODY2" | rg -q cooldown_active && echo 1 || echo 0)"

echo "== h. idempotencia → 409 con clave repetida =="
sleep 300 &
V3=$!
for _ in $(seq 1 50); do [ -d "/proc/$V3" ] && break; sleep 0.1; done
RES=$(post_kill "$BASE" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":$V3,\"process_name\":\"sleep\",\"operator\":\"e2e-op\",\"reason\":\"idem 1\",\"idempotency_key\":\"e2e-key-42\"}" 1)
wait "$V3" 2>/dev/null
sleep 300 &
V4=$!
RES2=$(post_kill "$BASE" "{\"host\":\"$HOSTNAME_E2E\",\"pid\":$V4,\"process_name\":\"sleep\",\"operator\":\"e2e-op\",\"reason\":\"idem 2\",\"idempotency_key\":\"e2e-key-42\"}" 1)
CODE2="${RES2%%|*}"; BODY2="${RES2#*|}"
check "HTTP 409 idempotency_repeated" "$(echo "$RES2" | rg -q '^409\|' && echo "$BODY2" | rg -q idempotency_repeated && echo 1 || echo 0)"
kill "$V4" 2>/dev/null; wait "$V4" 2>/dev/null

echo "== i. audit JSONL: cada línea parsea y las denegaciones están =="
AUDIT_OK=1
if [ ! -s "$AUDIT" ]; then AUDIT_OK=0; fi
python3 - "$AUDIT" <<'PYEOF' || AUDIT_OK=0
import json, sys
lines = [l for l in open(sys.argv[1], encoding="utf-8").read().splitlines() if l.strip()]
assert lines, "audit vacío"
for l in lines:
    r = json.loads(l)
    assert r["decision"] in ("executed", "denied"), r
    assert "source" in r and "ts" in r and "action_id" in r, r
codes = {json.loads(l).get("code") for l in lines}
for expected in ("operator_not_allowed", "host_mismatch", "self_protected",
                 "cooldown_active", "idempotency_repeated"):
    assert expected in codes, f"falta {expected} en el audit: {codes}"
print("audit OK:", len(lines), "líneas")
PYEOF
check "audit JSONL parsea y registra TODAS las denegaciones" "$AUDIT_OK"
check "el 404 del engine desarmado NO escribe audit (no existe la superficie)" \
  "$([ "$(rg -c 'disarmed' "$AUDIT" 2>/dev/null || echo 0)" = "0" ] && echo 1 || echo 0)"

echo
echo "=== e2e_respond_kill: $PASS OK / $FAIL FAIL ==="
[ "$FAIL" = "0" ]

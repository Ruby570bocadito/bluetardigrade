#!/usr/bin/env bash
# e2e_beacon.sh — E2E del detector de beaconing (paquete A3) sobre
# binarios reales, sin mocks. Tres fases:
#
#   A. Config por defecto (beacons.yaml del repo): el suelo
#      min_interval deja fuera un beacon rápido (300ms) — el knob
#      anti-falsos-positivos funciona de verdad.
#   B. Perfil agresivo de prueba: detección exacta (1 alerta),
#      cooldown (2a ráfaga no re-dispara), triage (POST /status
#      sobre la alerta beacon) y paridad stats/metrics.
#   C. Supresión del perfil: el wrapper SetEmit honra el allowlist
#      (perfil + host) igual que reglas y secuencias.
#
# Uso:
#   bash scripts/dev-tests/e2e_beacon.sh
#   SF_E2E_INGEST_PORT=18097 SF_E2E_API_PORT=18098 bash scripts/dev-tests/e2e_beacon.sh
#   SF_E2E_KEEP=1 bash ...            # conserva /tmp artefactos
#   SF_E2E_ENGINE=./bin/engine SF_E2E_DEVSENSOR=./bin/devsensor bash ...  # reusa binarios
#
# Requiere: go (para compilar si no hay SF_E2E_ENGINE), curl, python3.
# Puertos por defecto 18097/18098: fuera del rango de e2e_store_sequences
# (18077/78), store_smoke (17887/88) y smoke_lifecycle (17879).
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
INGEST_PORT="${SF_E2E_INGEST_PORT:-18097}"
API_PORT="${SF_E2E_API_PORT:-18098}"
BASE="http://127.0.0.1:$API_PORT"
EADDR="127.0.0.1:$INGEST_PORT"
PASS=0; FAIL=0
ok()  { echo "  OK  - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL- $1"; FAIL=$((FAIL+1)); }
check() { # check <desc> <"0|1">
  if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi
}

command -v curl >/dev/null    || { echo "FALLO preflight: curl no está en PATH"; exit 1; }
command -v python3 >/dev/null || { echo "FALLO preflight: python3 no está en PATH"; exit 1; }
command -v rg >/dev/null      || { echo "FALLO preflight: rg no está en PATH (require_engine lo usa para detectar el re-bind race); sin rg esa verificación se desactivaría en silencio"; exit 1; }

TMPDIR_E2E=$(mktemp -d /tmp/sf-e2e-beacon.XXXXXX)
LOG="$TMPDIR_E2E/engine.log"
: >"$LOG"

cleanup() {
  [ -n "${EPID:-}" ] && kill "$EPID" 2>/dev/null
  [ -n "${EPID:-}" ] && wait "$EPID" 2>/dev/null
  if [ "${SF_E2E_KEEP:-0}" = "1" ]; then
    echo "[e2e-beacon] KEEP=1: artefactos en $TMPDIR_E2E (log: $LOG)"
  else
    rm -rf "$TMPDIR_E2E"
  fi
}
trap cleanup EXIT

# binarios: reusar si los pasan, si no compilar frescos (un binario
# stale hace fallar los escenarios con síntomas engañosos — lección
# del smoke).
if [ -n "${SF_E2E_ENGINE:-}" ] && [ -n "${SF_E2E_DEVSENSOR:-}" ]; then
  ENGINE="$SF_E2E_ENGINE"; DEVSENSOR="$SF_E2E_DEVSENSOR"
  echo "[e2e-beacon] usando binarios externos: $ENGINE / $DEVSENSOR"
else
  command -v go >/dev/null || {
    echo "FALLO preflight: go no está en PATH y no hay SF_E2E_ENGINE/SF_E2E_DEVSENSOR"
    echo "(exporta el toolchain o pasa binarios ya compilados)"; exit 1
  }
  echo "[e2e-beacon] compilando binarios frescos en $TMPDIR_E2E/bin"
  mkdir -p "$TMPDIR_E2E/bin"
  (cd "$REPO" && go build -o "$TMPDIR_E2E/bin/engine" ./cmd/engine) || { echo "FALLO: build engine"; exit 1; }
  (cd "$REPO" && go build -o "$TMPDIR_E2E/bin/devsensor" ./cmd/devsensor) || { echo "FALLO: build devsensor"; exit 1; }
  ENGINE="$TMPDIR_E2E/bin/engine"; DEVSENSOR="$TMPDIR_E2E/bin/devsensor"
fi

# preflight de puertos: un residual reteniendo el puerto produce
# fallos confusos a mitad de ronda (misma lección del smoke).
python3 - "$INGEST_PORT" "$API_PORT" <<'PY' || { echo "FALLO preflight: puerto ocupado (¿proceso residual?)"; exit 1; }
import socket, sys
for p in sys.argv[1:]:
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", int(p)))
    except OSError:
        sys.exit(1)
    finally:
        s.close()
PY

# perfil agresivo de las fases B/C (min_interval 200ms: el beacon del
# devsensor a 300ms lo cruza; el perfil por defecto del repo, 2s, NO).
cat >"$TMPDIR_E2E/beacons-test.yaml" <<'EOF'
- name: "C2 beacon E2E"
  id: bcn-e2e-01
  description: perfil agresivo solo para pruebas E2E
  severity: high
  window: 5m
  min_count: 8
  max_jitter: 0.3
  min_interval: 200ms
  cooldown: 1h
EOF

# allowlist de la fase C: silencia el perfil en el host del replay.
# IMPORTANTE: el fichero NO puede llamarse suppressions.yaml — el
# fallback de resolveDataFile busca ese nombre EXACTO junto al
# ejecutable ($TMPDIR/bin/../suppressions.yaml) y la fase B cargaría
# la supresión de la fase C silenciosamente (defecto real cazado por
# este E2E en su primera versión).
cat >"$TMPDIR_E2E/suppressions-fixture.yaml" <<'EOF'
- rule_id: bcn-e2e-01
  host: LAB-WKS-01
  reason: "E2E beacon: par aceptado para probar el wrapper de supresion"
EOF

start_engine() { # start_engine <flags extra...>
  ( exec "$ENGINE" -addr "$EADDR" -api "127.0.0.1:$API_PORT" \
      -rules "$REPO/rules" -sequences "$REPO/sequences" \
      -lifecycle "$TMPDIR_E2E/lifecycle.json" "$@" ) >>"$LOG" 2>&1 &
  EPID=$!
}
restart_engine() { # restart_engine <flags extra...> — mata y relanza
  if [ -n "${EPID:-}" ]; then
    kill "$EPID" 2>/dev/null; wait "$EPID" 2>/dev/null
  fi
  # el puerto debe estar LIBRE antes de relanzar: un socket linger del
  # engine anterior hace que el nuevo salga limpio con "another engine
  # instance is already running" y el health probe pasaría
  # silenciosamente contra el engine VIEJO (su config, su estado) —
  # lección de preflight: verificar el recurso, no la respuesta.
  for _ in $(seq 1 50); do
    python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',$INGEST_PORT)); s.close()" 2>/dev/null \
      && python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',$API_PORT)); s.close()" 2>/dev/null && break
    sleep 0.2
  done
  : >"$LOG"
  start_engine "$@"
}
wait_health() {
  for _ in $(seq 1 50); do
    curl -sf "$BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  return 1
}
require_engine() { # health + garanticemos que el NUEVO engine es el que sirve
  wait_health || bail_with_log
  if rg -q "another engine instance" "$LOG" 2>/dev/null; then
    echo "FALLO: el motor salió por puerto ocupado (instancia anterior viva)"
    tail -5 "$LOG"
    exit 1
  fi
}
bail_with_log() {
  echo "FALLO: el motor no arrancó; cola del log ($LOG):"
  tail -20 "$LOG"
  exit 1
}
jqpy() { # jqpy <expr python sobre d>
  python3 -c "import json,sys; d=json.load(sys.stdin); $1"
}
beacon_alerts() { # beacon_alerts -> nº de alertas del perfil E2E
  curl -s "$BASE/api/alerts?limit=200" | jqpy 'print(sum(1 for a in d if a.get("rule_id")=="bcn-e2e-01"))' 2>/dev/null || echo 0
}

echo "[e2e-beacon] FASE A — config por defecto: el suelo min_interval frena un beacon rápido"
restart_engine -beacons "$REPO/beacons.yaml"
require_engine
check "motor arriba con beacons.yaml del repo" 1
BANNER=$(rg -c "beacon profiles loaded" "$LOG" 2>/dev/null || echo 0)
check "banner del detector en el arranque ($BANNER)" "$([ "$BANNER" -ge 1 ] && echo 1 || echo 0)"
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms -beacon 10 -beacon-interval 300ms ) >"$TMPDIR_E2E/sensor-a.log" 2>&1
sleep 1
N=$(beacon_alerts)
check "beacon a 300ms NO dispara con min_interval 2s/500ms (got $N)" "$([ "$N" = "0" ] && echo 1 || echo 0)"

echo "[e2e-beacon] FASE B — perfil agresivo: detección, cooldown, triage, paridad"
restart_engine -beacons "$TMPDIR_E2E/beacons-test.yaml"
require_engine
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms -beacon 12 -beacon-interval 300ms ) >"$TMPDIR_E2E/sensor-b1.log" 2>&1
sleep 1
N=$(beacon_alerts)
check "beacon regular dispara EXACTAMENTE 1 alerta (got $N)" "$([ "$N" = "1" ] && echo 1 || echo 0)"

ALERT=$(curl -s "$BASE/api/alerts?limit=200" | jqpy 'print(json.dumps([a for a in d if a.get("rule_id")=="bcn-e2e-01"][0]))')
SUMMARY=$(printf '%s' "$ALERT" | jqpy 'print(d["summary"])')
SEV=$(printf '%s' "$ALERT" | jqpy 'print(d["severity"])')
check "resumen nombra destino/puerto/cadencia (185.220.101.47:443)" \
  "$(printf '%s' "$SUMMARY" | rg -q 'beacon hacia 185\.220\.101\.47:443' && echo 1 || echo 0)"
check "severidad high del perfil" "$([ "$SEV" = "high" ] && echo 1 || echo 0)"

# cooldown: segunda ráfaga inmediata NO re-dispara (cooldown 1h)
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms -beacon 12 -beacon-interval 300ms ) >"$TMPDIR_E2E/sensor-b2.log" 2>&1
sleep 1
N=$(beacon_alerts)
FIRED=$(curl -s "$BASE/api/stats" | jqpy 'print(int(d["beacons_fired"]))')
check "cooldown: 2a ráfaga no re-dispara (alertas=$N, fired=$FIRED)" \
  "$([ "$N" = "1" ] && [ "$FIRED" = "1" ] && echo 1 || echo 0)"

# paridad stats/metrics (contrato D1 extendido a A3)
STATS=$(curl -s "$BASE/api/stats")
TRACKED=$(printf '%s' "$STATS" | jqpy 'print(int(d["beacons_tracked"]))')
CAP=$(printf '%s' "$STATS" | jqpy 'print(int(d["beacons_cap"]))')
check "stats: beacons_tracked >= 1 (got $TRACKED)" "$([ "$TRACKED" -ge 1 ] && echo 1 || echo 0)"
check "stats: beacons_cap = 8192 (got $CAP)" "$([ "$CAP" = "8192" ] && echo 1 || echo 0)"
MET=$(curl -s "$BASE/metrics")
check "metrics: sf_beacons_fired_total = 1" \
  "$(printf '%s' "$MET" | rg -q '^sf_beacons_fired_total 1$' && echo 1 || echo 0)"
check "metrics: sf_beacon_keys_tracked = $TRACKED" \
  "$(printf '%s' "$MET" | rg -q "^sf_beacon_keys_tracked $TRACKED\$" && echo 1 || echo 0)"

# triage: la alerta beacon participa del ciclo de vida (overlay)
AID=$(printf '%s' "$ALERT" | jqpy 'print(d["id"])')
CODE=$(curl -s -o "$TMPDIR_E2E/triage.json" -w '%{http_code}' -X POST \
  "$BASE/api/alerts/$AID/status" \
  -d '{"status":"acknowledged","note":"C2 confirmado en sandbox","by":"e2e-bcn"}')
check "POST /api/alerts/{id}/status acepta triage (HTTP $CODE)" "$([ "$CODE" = "200" ] && echo 1 || echo 0)"
STATUS=$(curl -s "$BASE/api/alerts?limit=200" | jqpy 'print([a for a in d if a.get("rule_id")=="bcn-e2e-01"][0].get("status",""))')
check "la alerta beacon queda acknowledged" "$([ "$STATUS" = "acknowledged" ] && echo 1 || echo 0)"

echo "[e2e-beacon] FASE C — supresión del perfil (wrapper SetEmit honra el allowlist)"
restart_engine -beacons "$TMPDIR_E2E/beacons-test.yaml" -suppressions "$TMPDIR_E2E/suppressions-fixture.yaml"
require_engine
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms -beacon 12 -beacon-interval 300ms ) >"$TMPDIR_E2E/sensor-c.log" 2>&1
sleep 1
N=$(beacon_alerts)
check "perfil suprimido: 0 alertas beacon (got $N)" "$([ "$N" = "0" ] && echo 1 || echo 0)"
# NOTA de diseño: el wrapper SetEmit del beacon no escribe línea
# [SUPPRESS] — igual que el del correlator (el log [SUPPRESS] es del
# path de reglas en el event loop). La supresión se verifica por el
# silencio de alertas, no por el log.

echo
echo "[e2e-beacon] RESULTADO: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = "0" ]

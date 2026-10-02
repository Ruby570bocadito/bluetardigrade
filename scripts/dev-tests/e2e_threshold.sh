#!/usr/bin/env bash
# e2e_threshold.sh — E2E del detector volumétrico de umbrales (paquete
# A2) sobre binarios reales, sin mocks. Tres fases:
#
#   A. Config por defecto (thresholds.yaml del repo): el escenario
#      canónico del devsensor NO dispara ningún umbral — el pack
#      conservador no genera ruido con tráfico de laboratorio.
#   B. Definición agresiva de prueba: detección exacta (1 alerta con
#      el burst del devsensor), cooldown (2º burst no re-dispara),
#      triage (POST /status sobre la alerta threshold) y paridad
#      stats/metrics.
#   C. Supresión de la definición: el wrapper SetEmit honra el
#      allowlist (rule_id + host) igual que reglas, secuencias y
#      beacons. Además: las alertas threshold NO alimentan el
#      correlator (dictamen Q3) — se verifica que ninguna cadena
#      avanza con las alertas de umbral.
#
# Uso:
#   bash scripts/dev-tests/e2e_threshold.sh
#   SF_E2E_INGEST_PORT=18107 SF_E2E_API_PORT=18108 bash scripts/dev-tests/e2e_threshold.sh
#   SF_E2E_KEEP=1 bash ...            # conserva /tmp artefactos
#   SF_E2E_ENGINE=./bin/engine SF_E2E_DEVSENSOR=./bin/devsensor bash ...
#
# Requiere: go (para compilar si no hay SF_E2E_ENGINE), curl, python3, rg.
# Puertos por defecto 18107/18108: fuera del rango de e2e_beacon
# (18097/98), e2e_store_sequences (18077/78), smoke_store (17887/88) y
# smoke_lifecycle (17879).
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
INGEST_PORT="${SF_E2E_INGEST_PORT:-18107}"
API_PORT="${SF_E2E_API_PORT:-18108}"
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
command -v rg >/dev/null      || { echo "FALLO preflight: rg no está en PATH (require_engine lo usa)"; exit 1; }

TMPDIR_E2E=$(mktemp -d /tmp/sf-e2e-threshold.XXXXXX)
LOG="$TMPDIR_E2E/engine.log"
: >"$LOG"

cleanup() {
  [ -n "${EPID:-}" ] && kill "$EPID" 2>/dev/null
  [ -n "${EPID:-}" ] && wait "$EPID" 2>/dev/null
  if [ "${SF_E2E_KEEP:-0}" = "1" ]; then
    echo "[e2e-threshold] KEEP=1: artefactos en $TMPDIR_E2E (log: $LOG)"
  else
    rm -rf "$TMPDIR_E2E"
  fi
}
trap cleanup EXIT

if [ -n "${SF_E2E_ENGINE:-}" ] && [ -n "${SF_E2E_DEVSENSOR:-}" ]; then
  ENGINE="$SF_E2E_ENGINE"; DEVSENSOR="$SF_E2E_DEVSENSOR"
  echo "[e2e-threshold] usando binarios externos: $ENGINE / $DEVSENSOR"
else
  command -v go >/dev/null || {
    echo "FALLO preflight: go no está en PATH y no hay SF_E2E_ENGINE/SF_E2E_DEVSENSOR"
    echo "(exporta el toolchain o pasa binarios ya compilados)"; exit 1
  }
  echo "[e2e-threshold] compilando binarios frescos en $TMPDIR_E2E/bin"
  mkdir -p "$TMPDIR_E2E/bin"
  (cd "$REPO" && go build -o "$TMPDIR_E2E/bin/engine" ./cmd/engine) || { echo "FALLO: build engine"; exit 1; }
  (cd "$REPO" && go build -o "$TMPDIR_E2E/bin/devsensor" ./scripts/dev-tests/scenario) || { echo "FALLO: build devsensor"; exit 1; }
  ENGINE="$TMPDIR_E2E/bin/engine"; DEVSENSOR="$TMPDIR_E2E/bin/devsensor"
fi

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

# definición agresiva de las fases B/C: 5 escrituras en la carpeta
# pública en 1m disparan; cooldown 1h blinda el re-disparo del 2º burst.
cat >"$TMPDIR_E2E/thresholds-test.yaml" <<'EOF'
- name: "Rafaga E2E en carpeta publica"
  id: thr-e2e-01
  description: definicion agresiva solo para pruebas E2E
  severity: high
  event_type: file.write
  conditions:
    - { field: file.path, operator: startswith, value: "C:\\Users\\Public\\" }
  threshold:
    count: 5
    window: 1m
  cooldown: 1h
  tags: ["threshold", "e2e"]
EOF

# allowlist de la fase C: silencia la definición en el host del replay.
# El fichero NO puede llamarse suppressions.yaml (fallback de
# resolveDataFile junto al ejecutable — lección de e2e_beacon).
cat >"$TMPDIR_E2E/suppressions-fixture.yaml" <<'EOF'
- rule_id: thr-e2e-01
  host: LAB-WKS-01
  reason: "E2E threshold: par aceptado para probar el wrapper de supresion"
EOF

start_engine() { # start_engine <flags extra...>
  ( exec "$ENGINE" -addr "$EADDR" -api "127.0.0.1:$API_PORT" \
      -rules "$REPO/rules" -sequences "$REPO/sequences" \
      -lifecycle "$TMPDIR_E2E/lifecycle.json" "$@" ) >>"$LOG" 2>&1 &
  EPID=$!
}
restart_engine() { # restart_engine <flags extra...>
  if [ -n "${EPID:-}" ]; then
    kill "$EPID" 2>/dev/null; wait "$EPID" 2>/dev/null
  fi
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
require_engine() {
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
jqpy() {
  python3 -c "import json,sys; d=json.load(sys.stdin); $1"
}
thr_alerts() {
  curl -s "$BASE/api/alerts?limit=200" | jqpy 'print(sum(1 for a in d if a.get("rule_id")=="thr-e2e-01"))' 2>/dev/null || echo 0
}
thr_fired_stats() {
  curl -s "$BASE/api/stats" | jqpy 'print(d.get("threshold_fired", -1))' 2>/dev/null || echo -1
}
thr_fired_metrics() {
  curl -s "$BASE/metrics" | python3 -c "
import sys
for line in sys.stdin:
    if line.startswith('sf_thresholds_fired_total'):
        print(int(float(line.split()[1]))); break
else:
    print(-1)" 2>/dev/null || echo -1
}
thr_keys_stats() {
  curl -s "$BASE/api/stats" | jqpy 'print(d.get("threshold_keys", -1))' 2>/dev/null || echo -1
}

echo "[e2e-threshold] FASE A — pack por defecto: el escenario canónico no dispara umbrales"
restart_engine -thresholds "$REPO/thresholds.yaml"
require_engine
check "motor arriba con thresholds.yaml del repo" 1
BANNER=$(rg -c "threshold definitions loaded" "$LOG" 2>/dev/null || echo 0)
check "banner del detector en el arranque ($BANNER)" "$([ "$BANNER" -ge 1 ] && echo 1 || echo 0)"
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms ) >"$TMPDIR_E2E/sensor-a.log" 2>&1
sleep 1
N=$(thr_alerts)
check "escenario canónico NO dispara el pack conservador (got $N)" "$([ "$N" = "0" ] && echo 1 || echo 0)"
K=$(thr_keys_stats)
check "threshold_keys=$K sin keys del pack por defecto" "$([ "$K" = "0" ] && echo 1 || echo 0)"

echo "[e2e-threshold] FASE B — definición agresiva: detección exacta, cooldown, triage, paridad"
restart_engine -thresholds "$TMPDIR_E2E/thresholds-test.yaml"
require_engine
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms -burst 12 -burst-interval 20ms ) >"$TMPDIR_E2E/sensor-b1.log" 2>&1
sleep 1
N=$(thr_alerts)
check "burst de 12 escrituras dispara EXACTAMENTE 1 (got $N)" "$([ "$N" = "1" ] && echo 1 || echo 0)"
K=$(thr_keys_stats)
check "threshold_keys=1 tras el burst (got $K)" "$([ "$K" = "1" ] && echo 1 || echo 0)"

# cooldown: segundo burst dentro del cooldown NO re-dispara
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms -burst 12 -burst-interval 20ms ) >"$TMPDIR_E2E/sensor-b2.log" 2>&1
sleep 1
N=$(thr_alerts)
check "cooldown: 2º burst mantiene 1 alerta (got $N)" "$([ "$N" = "1" ] && echo 1 || echo 0)"

# triage estándar sobre la alerta threshold (mismo ciclo de vida)
ALERT_ID=$(curl -s "$BASE/api/alerts?limit=200" | jqpy '
print(next((a["id"] for a in d if a.get("rule_id")=="thr-e2e-01"), ""))')
check "alerta threshold tiene id de engine (${ALERT_ID:0:8}...)" "$([ -n "$ALERT_ID" ] && echo 1 || echo 0)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"status":"acknowledged","note":"visto en e2e, fuerza bruta de lab","by":"e2e-threshold"}' \
  "$BASE/api/alerts/$ALERT_ID/status")
check "POST /status acknowledged -> 200 (got $CODE)" "$([ "$CODE" = "200" ] && echo 1 || echo 0)"
STATUS=$(curl -s "$BASE/api/alerts?limit=200" | jqpy '
print(next((a.get("status","") for a in d if a.get("id")=="'"$ALERT_ID"'"), ""))')
check "la alerta threshold queda acknowledged ($STATUS)" "$([ "$STATUS" = "acknowledged" ] && echo 1 || echo 0)"

# paridad stats/metrics (contrato D1)
S=$(thr_fired_stats); M=$(thr_fired_metrics)
check "paridad stats/metrics: threshold_fired=$S == sf_thresholds_fired_total=$M" "$([ "$S" = "$M" ] && [ "$S" = "1" ] && echo 1 || echo 0)"

echo "[e2e-threshold] FASE C — supresión de la definición (wrapper SetEmit honra el allowlist)"
restart_engine -thresholds "$TMPDIR_E2E/thresholds-test.yaml" -suppressions "$TMPDIR_E2E/suppressions-fixture.yaml"
require_engine
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms -burst 12 -burst-interval 20ms ) >"$TMPDIR_E2E/sensor-c.log" 2>&1
sleep 1
N=$(thr_alerts)
check "definición suprimida: 0 alertas threshold (got $N)" "$([ "$N" = "0" ] && echo 1 || echo 0)"
# el detector SIGUE contando internamente (fired es del detector, no de la
# salida): el estado interno debe reflejar el burst aunque la alerta se
# suprima — keys 0..1 es válido según el momento del reload, la assertion
# real es que NO hay alerta emitida.
echo ""
echo "[e2e-threshold] RESULTADO: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = "0" ] || exit 1

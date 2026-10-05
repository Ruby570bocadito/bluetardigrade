#!/usr/bin/env bash
# e2e_risk_a1.sh — E2E del KPI de riesgo por host (paquete A1,
# internal/risk) sobre binarios reales, sin mocks. Cinco fases:
#
#   A. Scoring EXACTO con fixture hermético: 3 reglas de prueba
#      (high/medium/low) que matchean exactamente 1 evento canónico del
#      devsensor cada una → 3 alertas en un solo host → score exacto
#      5+2+1 = 8.0, alerts=3, risk_hosts_tracked=1. Hermético a propósito:
#      el E2E original (score 129.79 con el pack del repo)
#      murió con cada regla añadida al pack — la lección de
#      reproducibilidad es que un smoke no
#      puede depender de un pack que evoluciona. El replay del devsensor
#      (mismos PIDs) además NO duplica: el dedup rule|host|pid del motor
#      impide que la segunda pasada toque el score.
#   B. El triaje NO refunda (diseño documentado en internal/risk):
#      cerrar las 3 alertas con nota deja el score idéntico — el score
#      modela lo que el motor VIÓ; el ciclo de vida modela lo que el
#      operador DECIDIÓ. Se verifica primero que el overlay closed llegó
#      a las 3 (la aserción no puede pasar por vacua).
#   C. Paridad stats/metrics (contrato D1) + schema del wire:
#      sf_risk_hosts_tracked == stats.risk_hosts_tracked,
#      sf_host_risk_score{host=...} == hot_hosts[0].score, last_seen
#      parseable RFC 3339, orden por score descendente.
#   D. Señal viva, no historial: tras REINICIAR el motor el score se
#      resetea (tracked=0, hot_hosts=[], serie ausente de /metrics) —
#      el riesgo es un indicador de tiempo real en memoria, y el fichero
#      de lifecycle conserva el registro de triaje (las 3 closed
#      siguen allí): resetear el KPI no es perder la auditoría.
#   E. Pack real del repo, consistencia SIN número exacto: reglas +
#      secuencias del repo sobre el escenario canónico → todos los
#      alertan aterrizan en el host del replay, hot_hosts[0].alerts ==
#      alerts_total y la paridad de métricas se mantiene pase lo que
#      pase con la evolución del pack.
#
# Uso:
#   bash scripts/dev-tests/e2e_risk_a1.sh
#   SF_E2E_INGEST_PORT=18127 SF_E2E_API_PORT=18128 bash scripts/dev-tests/e2e_risk_a1.sh
#   SF_E2E_KEEP=1 bash ...            # conserva /tmp artefactos
#   SF_E2E_ENGINE=./bin/engine SF_E2E_DEVSENSOR=./bin/devsensor bash ...
#
# Requiere: go (para compilar si no hay SF_E2E_ENGINE), curl, python3, rg.
# Puertos por defecto 18127/18128: fuera del rango de e2e_threshold
# (18107/08), e2e_beacon (18097/98), e2e_store_sequences (18077/78),
# smoke_store (17887/88) y smoke_lifecycle (17879).
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
INGEST_PORT="${SF_E2E_INGEST_PORT:-18127}"
API_PORT="${SF_E2E_API_PORT:-18128}"
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

TMPDIR_E2E=$(mktemp -d /tmp/sf-e2e-risk.XXXXXX)
LOG="$TMPDIR_E2E/engine.log"
: >"$LOG"

cleanup() {
  [ -n "${EPID:-}" ] && kill "$EPID" 2>/dev/null
  [ -n "${EPID:-}" ] && wait "$EPID" 2>/dev/null
  if [ "${SF_E2E_KEEP:-0}" = "1" ]; then
    echo "[e2e-risk] KEEP=1: artefactos en $TMPDIR_E2E (log: $LOG)"
  else
    rm -rf "$TMPDIR_E2E"
  fi
}
trap cleanup EXIT

if [ -n "${SF_E2E_ENGINE:-}" ] && [ -n "${SF_E2E_DEVSENSOR:-}" ]; then
  ENGINE="$SF_E2E_ENGINE"; DEVSENSOR="$SF_E2E_DEVSENSOR"
  echo "[e2e-risk] usando binarios externos: $ENGINE / $DEVSENSOR"
else
  command -v go >/dev/null || {
    echo "FALLO preflight: go no está en PATH y no hay SF_E2E_ENGINE/SF_E2E_DEVSENSOR"
    echo "(exporta el toolchain o pasa binarios ya compilados)"; exit 1
  }
  echo "[e2e-risk] compilando binarios frescos en $TMPDIR_E2E/bin"
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

# reglas fixture de la fase A/B/C/D: una por severidad, cada una
# matchea EXACTAMENTE un evento del escenario canónico (MiniDump del
# rundll32, -urlcache del certutil, delete shadows del vssadmin).
# Sin actions: Raise no las exige (Emit de secuencias tampoco las pasa).
mkdir -p "$TMPDIR_E2E/rules-fixture" "$TMPDIR_E2E/seq-vacia"
cat >"$TMPDIR_E2E/rules-fixture/risk-fixture.yaml" <<'EOF'
- name: "E2E risk high - LSASS MiniDump"
  id: risk-e2e-high
  description: fixture E2E risk - una unica alerta high por replay
  severity: high
  event_type: process.create
  conditions:
    - { field: process.command_line, operator: contains, value: "MiniDump" }
  tags: ["e2e", "risk"]
- name: "E2E risk medium - certutil urlcache"
  id: risk-e2e-med
  description: fixture E2E risk - una unica alerta medium por replay
  severity: medium
  event_type: process.create
  conditions:
    - { field: process.command_line, operator: contains, value: "-urlcache" }
  tags: ["e2e", "risk"]
- name: "E2E risk low - vssadmin delete shadows"
  id: risk-e2e-low
  description: fixture E2E risk - una unica alerta low por replay
  severity: low
  event_type: process.create
  conditions:
    - { field: process.command_line, operator: contains, value: "delete shadows" }
  tags: ["e2e", "risk"]
EOF

start_engine() { # start_engine <flags extra...>
  ( exec "$ENGINE" -addr "$EADDR" -api "127.0.0.1:$API_PORT" \
      -sequences "$TMPDIR_E2E/seq-vacia" \
      -beacons "" -thresholds "" -suppressions "" \
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
stats_field() { # stats_field <campo>
  curl -s "$BASE/api/stats" | jqpy "print(d.get(\"$1\", -1))" 2>/dev/null || echo -1
}
hot0() { # hot0 <campo del primer hot_host>
  curl -s "$BASE/api/stats" | jqpy "
hh = (d.get('hot_hosts') or [{}])[0]
print(hh.get('$1', ''))" 2>/dev/null || echo ERR
}
tracked_now() { stats_field risk_hosts_tracked; }
alerts_total() { stats_field alerts_total; }
# Tolerancia del score exacto: el tracker decae CON VIDA MEDIA DE 30 MIN
# (producto documentado), y entre la 1ª alerta del replay y la consulta
# pasan segundos reales: 8.0 → 7.99 → 7.98 en las primeras decenas de
# segundos. La ventana completa del E2E (< 40 s) decae como máximo
# ~0.13 puntos; una alerta entera pesa 1.0 (low), así que una tolerancia
# de 0.15 NO puede tapar ni una pérdida ni una sobra de alerta — solo
# absorbe la física del decay. Comparaciones de igualdad score↔score
# (paridad stats/metrics) usan 0.01: son la MISMA celda redondeada a 2
# decimales leída dos veces, solo separables por el decay entre llamadas.
within8() { # within8 <score observado> → "1" si |v-8.0| <= 0.15
  python3 -c "print(1 if abs(float('$1' or 0)-8.0)<=0.15 else 0)" 2>/dev/null || echo 0
}
score_eq() { # score_eq <a> <b> → "1" si |a-b| <= 0.01
  python3 -c "print(1 if abs(float('$1' or 0)-float('$2' or 0))<=0.01 else 0)" 2>/dev/null || echo 0
}

echo "[e2e-risk] FASE A — scoring exacto con fixture hermético (5+2+1 = 8.0)"
restart_engine -rules "$TMPDIR_E2E/rules-fixture"
require_engine
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms ) >"$TMPDIR_E2E/sensor-a1.log" 2>&1
sleep 2
N=$(alerts_total)
check "replay canónico dispara EXACTAMENTE 3 alertas fixture (got $N)" "$([ "$N" = "3" ] && echo 1 || echo 0)"
T=$(tracked_now)
check "risk_hosts_tracked=1 con un solo host de replay (got $T)" "$([ "$T" = "1" ] && echo 1 || echo 0)"
H=$(hot0 host)
check "hot_hosts[0].host=LAB-WKS-01 (got $H)" "$([ "$H" = "LAB-WKS-01" ] && echo 1 || echo 0)"
SC=$(hot0 score)
check "hot_hosts[0].score=8.0 dentro de la banda de decay (got $SC)" "$(within8 "$SC")"
AC=$(hot0 alerts)
check "hot_hosts[0].alerts=3 (got $AC)" "$([ "$AC" = "3" ] && echo 1 || echo 0)"
LS=$(hot0 last_seen)
check "last_seen parseable RFC 3339 ($LS)" "$(python3 -c "
from datetime import datetime
try:
    datetime.fromisoformat('$LS'.replace('Z','+00:00')); print(1)
except Exception: print(0)" 2>/dev/null || echo 0)"
SHAPE=$(curl -s "$BASE/api/stats" | jqpy "
hh = (d.get('hot_hosts') or [{}])[0]
ks = set(hh.keys())
print(1 if {'host','score','alerts','last_seen'} <= ks else 0)" 2>/dev/null || echo 0)
check "schema del wire: host/score/alerts/last_seen presentes" "$SHAPE"
SET=$(curl -s "$BASE/api/alerts?limit=200" | jqpy "
want = {'risk-e2e-high': 'high', 'risk-e2e-med': 'medium', 'risk-e2e-low': 'low'}
got = {}
for a in d:
    if a.get('rule_id') in want:
        got[a['rule_id']] = a.get('severity')
print(1 if got == want else 0)" 2>/dev/null || echo 0)
check "las 3 alertas fixture existen con su severidad exacta" "$SET"

# replay con los MISMOS pids: el dedup rule|host|pid (TTL 60 s) frena
# la segunda pasada → ni alertas nuevas ni score inflado
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms ) >"$TMPDIR_E2E/sensor-a2.log" 2>&1
sleep 2
N2=$(alerts_total)
SC2=$(hot0 score)
check "replay repetido NO duplica (alerts_total=$N2, score=$SC2)" \
  "$([ "$N2" = "3" ] && within8 "$SC2")"

echo "[e2e-risk] FASE B — el triaje NO refunda (score modela lo que el motor vio)"
IDS=$(curl -s "$BASE/api/alerts?limit=200" | jqpy "
print(' '.join(a['id'] for a in d if a.get('rule_id','').startswith('risk-e2e-')))")
NCLOSED=0
for id in $IDS; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"status":"closed","note":"cerrada en e2e risk (no refunda)","by":"e2e-risk-a1"}' \
    "$BASE/api/alerts/$id/status")
  [ "$CODE" = "200" ] && NCLOSED=$((NCLOSED+1))
done
check "3 closes aceptados por la API de triaje (got $NCLOSED)" "$([ "$NCLOSED" = "3" ] && echo 1 || echo 0)"
OV=$(curl -s "$BASE/api/alerts?limit=200" | jqpy "
print(sum(1 for a in d if a.get('rule_id','').startswith('risk-e2e-') and a.get('status')=='closed'))")
check "overlay aplicado: 3 alertas fixtures leen closed (got $OV)" "$([ "$OV" = "3" ] && echo 1 || echo 0)"
SC3=$(hot0 score)
AC3=$(hot0 alerts)
check "score INTACTO tras cerrar todo (score=$SC3, alerts=$AC3)" \
  "$([ "$AC3" = "3" ] && within8 "$SC3")"

echo "[e2e-risk] FASE C — paridad stats/metrics (contrato D1)"
S=$(tracked_now)
M=$(curl -s "$BASE/metrics" | python3 -c "
import sys
for line in sys.stdin:
    if line.startswith('sf_risk_hosts_tracked'):
        print(int(float(line.split()[1]))); break
else:
    print(-1)" 2>/dev/null || echo -1)
check "paridad: risk_hosts_tracked stats=$S == sf_risk_hosts_tracked=$M" "$([ "$S" = "$M" ] && [ "$S" = "1" ] && echo 1 || echo 0)"
MSCORE=$(curl -s "$BASE/metrics" | python3 -c "
import sys
for line in sys.stdin:
    if line.startswith('sf_host_risk_score{'):
        print(line.split('} ')[1]); break
else:
    print(-1)" 2>/dev/null || echo -1)
check "paridad: sf_host_risk_score=$MSCORE == hot_hosts[0].score ($SC)" \
  "$(score_eq "$MSCORE" "$SC")"

echo "[e2e-risk] FASE D — señal viva: el reinicio resetea el score, no la auditoría"
restart_engine -rules "$TMPDIR_E2E/rules-fixture"
require_engine
T=$(tracked_now)
check "tras reiniciar: risk_hosts_tracked=0 (got $T)" "$([ "$T" = "0" ] && echo 1 || echo 0)"
EMPTY=$(curl -s "$BASE/api/stats" | jqpy "print(1 if d.get('hot_hosts')==[] else 0)" 2>/dev/null || echo 0)
check "tras reiniciar: hot_hosts=[] (got $EMPTY)" "$EMPTY"
SERIE=$(curl -s "$BASE/metrics" | rg -c "^sf_host_risk_score\{" 2>/dev/null || echo 0)
check "serie sf_host_risk_score ABSENTE sin hosts calientes (got $SERIE)" "$([ "$SERIE" = "0" ] && echo 1 || echo 0)"
AUD=$(python3 -c "
import json
d = json.load(open('$TMPDIR_E2E/lifecycle.json'))
e = d.get('entries', [])
print(1 if len(e) == 3 and all(x.get('status') == 'closed' for x in e) else 0)" 2>/dev/null || echo 0)
check "el registro de triaje SOBREVIVE en el fichero lifecycle (3 closed)" "$AUD"
RING=$(curl -s "$BASE/api/alerts?limit=200" | jqpy "print(len(d))" 2>/dev/null || echo -1)
check "modo anillo: las alertas del proceso anterior ya no se sirven (got $RING)" "$([ "$RING" = "0" ] && echo 1 || echo 0)"

echo "[e2e-risk] FASE E — pack real del repo: consistencia sin número exacto"
restart_engine -rules "$REPO/rules" -sequences "$REPO/sequences"
require_engine
( exec "$DEVSENSOR" -addr "$EADDR" -interval 20ms ) >"$TMPDIR_E2E/sensor-e.log" 2>&1
sleep 2
N=$(alerts_total)
check "el pack del repo dispara alertas sobre el replay (got $N)" "$(python3 -c "print(1 if int('$N' or 0) >= 1 else 0)" 2>/dev/null || echo 0)"
H=$(hot0 host)
check "hot_hosts[0].host=LAB-WKS-01 con el pack real (got $H)" "$([ "$H" = "LAB-WKS-01" ] && echo 1 || echo 0)"
CONS=$(curl -s "$BASE/api/stats" | jqpy "
hh = (d.get('hot_hosts') or [{}])[0]
print(1 if hh.get('alerts') == d.get('alerts_total') and hh.get('score', 0) > 0 else 0)" 2>/dev/null || echo 0)
check "consistencia: hot_hosts[0].alerts == alerts_total == $N y score > 0" "$CONS"
T=$(tracked_now)
M=$(curl -s "$BASE/metrics" | python3 -c "
import sys
for line in sys.stdin:
    if line.startswith('sf_risk_hosts_tracked'):
        print(int(float(line.split()[1]))); break
else:
    print(-1)" 2>/dev/null || echo -1)
check "paridad con el pack real: stats=$S/$T == metrics=$M" "$([ "$T" = "$M" ] && [ "$T" = "1" ] && echo 1 || echo 0)"

echo ""
echo "[e2e-risk] RESULTADO: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = "0" ] || exit 1

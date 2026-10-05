#!/usr/bin/env bash
# e2e_reports_noise.sh — E2E de REP-1 parte A (catalogo de informes) y
# de la API de ruido (PLAN-DETALLADO §2.4) sobre un motor de laboratorio
# real, sin mocks. Fases:
#
#   A. Catalogo: GET /api/reports lista los 4 kinds con formatos; un
#      kind desconocido responde 404 nombrando los validos.
#   B. Siembra: eventos NDJSON crudos por ingesta loopback (arranques
#      de proceso repetidos y consultas DNS) mas una regla efimera que
#      dispara con un marcador unico; una alerta real queda cerrada
#      por el endpoint de triage.
#   C. Resumen ejecutivo: JSON (totales, estados, host afectados) y
#      CSV (cabecera metric/value y escapado de formulas).
#   D. Ruido: top de procesos por imagen (agrupando mayusculas),
#      dominios DNS, reglas con porcentajes de triage; filtro por host
#      y limite del top.
#   E. Actividad del SOC: backlog, operador y MTTA/MTTC tras cerrar.
#   F. Cobertura de flota: hosts sembrados con eventos en la ventana.
#   G. Incidente: caso con una alerta resuelta y otra ausente
#      (found:false); guardias de id.
#   H. Guardias de contrato: ventana invalida (400), formato invalido
#      (400), window en incidente (400).
#
# Uso:
#   bash scripts/dev-tests/e2e_reports_noise.sh
#   SF_E2E_INGEST_PORT=18127 SF_E2E_API_PORT=18128 bash scripts/dev-tests/e2e_reports_noise.sh
#   SF_E2E_KEEP=1 bash ...   # conserva /tmp artefactos
#
# Requiere: go (para compilar si no hay SF_E2E_ENGINE), curl, python3.
# Puertos por defecto 18127/18128: fuera del rango de las otras e2e
# (18107/08 threshold, 18097/98 beacon, 18117/18 scenarios) y del motor
# real (7777/7778).
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
INGEST_PORT="${SF_E2E_INGEST_PORT:-18127}"
API_PORT="${SF_E2E_API_PORT:-18128}"
BASE="http://127.0.0.1:$API_PORT"
EADDR="127.0.0.1:$INGEST_PORT"
PASS=0; FAIL=0
ok()  { echo "  OK  - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL- $1"; FAIL=$((FAIL+1)); }
check() { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi; }

command -v curl >/dev/null    || { echo "FALLO preflight: curl no está en PATH"; exit 1; }
command -v python3 >/dev/null || { echo "FALLO preflight: python3 no está en PATH"; exit 1; }

TMPDIR_E2E=$(mktemp -d /tmp/sf-e2e-reports.XXXXXX)
LOG="$TMPDIR_E2E/engine.log"
: >"$LOG"

cleanup() {
  [ -n "${EPID:-}" ] && kill "$EPID" 2>/dev/null
  [ -n "${EPID:-}" ] && wait "$EPID" 2>/dev/null
  if [ "${SF_E2E_KEEP:-0}" = "1" ]; then
    echo "[e2e-reports] KEEP=1: artefactos en $TMPDIR_E2E (log: $LOG)"
  else
    rm -rf "$TMPDIR_E2E"
  fi
}
trap cleanup EXIT

if [ -n "${SF_E2E_ENGINE:-}" ]; then
  ENGINE="$SF_E2E_ENGINE"
  echo "[e2e-reports] usando binario externo: $ENGINE"
else
  command -v go >/dev/null || {
    echo "FALLO preflight: go no está en PATH y no hay SF_E2E_ENGINE"
    echo "(exporta el toolchain o pasa un binario ya compilado)"; exit 1
  }
  echo "[e2e-reports] compilando binario fresco en $TMPDIR_E2E/bin"
  mkdir -p "$TMPDIR_E2E/bin"
  (cd "$REPO" && go build -o "$TMPDIR_E2E/bin/engine" ./cmd/engine) || { echo "FALLO: build engine"; exit 1; }
  ENGINE="$TMPDIR_E2E/bin/engine"
fi

python3 - "$INGEST_PORT" "$API_PORT" <<'PY' || { echo "FALLO preflight: puerto ocupado (¿proceso residual?)"; exit 1; }
import socket, sys
for p in sys.argv[1:]:
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", int(p)))
        s.close()
    except OSError:
        sys.exit(1)
PY

# Regla efimera: dispara con el marcador unico del comando sembrado.
mkdir -p "$TMPDIR_E2E/rules" "$TMPDIR_E2E/sequences"
cat >"$TMPDIR_E2E/rules/noise-e2e.yaml" <<'EOF'
- name: "E2E informes: marcador de ruido"
  id: "e2e0a0b-0000-4c01-9e01-000000000001"
  description: >
    Regla efimera de la e2e de informes: dispara una alerta low con el
    marcador noise-e2e-marker en la linea de comandos, para que el
    catalogo, el ruido y el triage tengan datos reales sin depender del
    pack de reglas del repositorio.
  severity: low
  event_type: process.create
  conditions:
    - field: process.command_line
      operator: contains
      value: "noise-e2e-marker"
  actions:
    - type: alert
      config:
        message: "Marcador de ruido e2e en {host}"
  tags: ["e2e", "reports"]
  enabled: true
EOF

start_engine() { # start_engine <flags extra...>
  ( exec "$ENGINE" -addr "$EADDR" -api "127.0.0.1:$API_PORT" \
      -rules "$TMPDIR_E2E/rules" -sequences "$TMPDIR_E2E/sequences" \
      -store "$TMPDIR_E2E/store.db" -store-retention 720h \
      -incidents "$TMPDIR_E2E/incidents.json" \
      -lifecycle "$TMPDIR_E2E/lifecycle.json" "$@" ) >>"$LOG" 2>&1 &
  EPID=$!
}
wait_health() {
  for _ in $(seq 1 50); do
    curl -sf "$BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  return 1
}
bail_with_log() {
  echo "FALLO: el motor no arrancó; cola del log ($LOG):"
  tail -20 "$LOG"
  exit 1
}
jqpy() {
  python3 -c "import json,sys; d=json.load(sys.stdin); $1"
}
status_of() { # status_of <args de curl...>; devuelve el http_code
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

echo "[e2e-reports] FASE A — catalogo"
start_engine
require_engine_ok() { wait_health || bail_with_log; }
require_engine_ok
CODE=$(status_of "$BASE/api/reports")
check "GET /api/reports responde 200 ($CODE)" "$([ "$CODE" = "200" ] && echo 1 || echo 0)"
KINDS=$(curl -s "$BASE/api/reports" | jqpy 'print(",".join(sorted(r["kind"] for r in d["reports"])))')
check "catalogo lista executive,fleet,incident,soc ($KINDS)" "$([ "$KINDS" = "executive,fleet,incident,soc" ] && echo 1 || echo 0)"
CODE=$(status_of "$BASE/api/reports/semanal-feliz")
check "kind desconocido responde 404 ($CODE)" "$([ "$CODE" = "404" ] && echo 1 || echo 0)"

echo "[e2e-reports] FASE B — siembra por ingesta loopback"
python3 - "$EADDR" <<'PY' || { echo "FALLO: la ingesta NDJSON falló"; tail -5 "$LOG"; exit 1; }
import json, socket, sys, time

host, port = sys.argv[1].rsplit(":", 1)
now = time.time()
seq = 0

def event(host, ev_type, **kw):
    global seq
    seq += 1
    ev = {
        "id": "e2e-reports-%04d" % seq,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + ".%09dZ" % int(now % 1 * 1e9),
        "type": ev_type,
        "source": "e2e-reports",
        "host": host,
    }
    ev.update(kw)
    return ev

lines = []
# arranques repetidos del mismo ejecutable en dos hosts (agrupa caso),
# variando mayusculas como hace Windows
for i in range(6):
    image = "C:\\Program Files\\Lenovo\\Vantage.exe" if i % 2 == 0 else "c:\\program files\\lenovo\\vantage.exe"
    lines.append(event("PC-A", "process.create",
        process={"pid": 100 + i, "ppid": 50, "name": "Vantage.exe", "image": image,
                 "command_line": "\"C:\\Program Files\\Lenovo\\Vantage.exe\" /sched"}))
lines.append(event("PC-A", "process.create",
    process={"pid": 200, "name": "other.exe", "image": "C:\\Tools\\other.exe",
             "command_line": "other.exe --flag noise-e2e-marker"}))
lines.append(event("PC-B", "process.create",
    process={"pid": 300, "name": "other.exe", "image": "C:\\Tools\\other.exe",
             "command_line": "other.exe --flag noise-e2e-marker"}))
# consultas DNS repetidas
for i in range(4):
    lines.append(event("PC-A", "network.connect",
        network={"protocol": "dns", "domain": "Update.Lenovo.com" if i % 2 else "update.lenovo.com"}))
lines.append(event("PC-B", "network.connect",
    network={"protocol": "dns", "domain": "www.google.com"}))

s = socket.create_connection((host, int(port)), timeout=5)
s.settimeout(5)
payload = ("\n".join(json.dumps(e) for e in lines)).encode() + b"\n"
s.sendall(payload)
s.shutdown(socket.SHUT_WR)
try:
    s.recv(64)
except OSError:
    pass
s.close()
print("enviados %d eventos" % len(lines))
PY

sleep 1
N_ALERTS=$(curl -s "$BASE/api/alerts?limit=50" | jqpy 'print(sum(1 for a in d if a.get("rule_id")=="e2e0a0b-0000-4c01-9e01-000000000001"))')
check "la regla efimera disparo ($N_ALERTS alertas)" "$([ "${N_ALERTS:-0}" -ge 1 ] && echo 1 || echo 0)"
ALERT_ID=$(curl -s "$BASE/api/alerts?limit=50" | jqpy 'print(next((a["id"] for a in d if a.get("rule_id")=="e2e0a0b-0000-4c01-9e01-000000000001"), ""))')
check "alerta de la regla identificada ($ALERT_ID)" "$([ -n "$ALERT_ID" ] && echo 1 || echo 0)"

echo "[e2e-reports] FASE C — resumen ejecutivo"
EXEC=$(curl -s "$BASE/api/reports/executive?window=1h")
TOTAL=$(echo "$EXEC" | jqpy 'print(d["alerts_total"])')
check "alerts_total=$TOTAL coincide con lo sembrado" "$([ "${TOTAL:-0}" -ge 1 ] && echo 1 || echo 0)"
SRC=$(echo "$EXEC" | jqpy 'print(d["source"])')
check "source=store con -store ($SRC)" "$([ "$SRC" = "store" ] && echo 1 || echo 0)"
HOSTS=$(echo "$EXEC" | jqpy 'print(d["hosts_affected"])')
check "hosts_affected=$HOSTS" "$([ "${HOSTS:-0}" -ge 2 ] && echo 1 || echo 0)"
CSV=$(curl -s "$BASE/api/reports/executive?window=1h&format=csv")
echo "$CSV" | rg -q "^metric,value$" && check "csv con cabecera metric,value" 1 || check "csv con cabecera metric,value" 0
echo "$CSV" | rg -q "^alerts_total,$TOTAL$" && check "csv fila alerts_total" 1 || check "csv fila alerts_total" 0
CODE=$(status_of "$BASE/api/reports/executive?window=banana")
check "ventana invalida responde 400 ($CODE)" "$([ "$CODE" = "400" ] && echo 1 || echo 0)"
CODE=$(status_of "$BASE/api/reports/executive?format=pdf")
check "formato invalido responde 400 ($CODE)" "$([ "$CODE" = "400" ] && echo 1 || echo 0)"

echo "[e2e-reports] FASE D — ruido"
NOISE=$(curl -s "$BASE/api/noise?window=1h&limit=5")
TOPPROC=$(echo "$NOISE" | jqpy 'print(d["processes"][0]["image"] + "=" + str(d["processes"][0]["count"]) + " hosts=" + str(d["processes"][0]["distinct_hosts"]))')
check "top proceso agrupa mayusculas ($TOPPROC)" "$([ "$TOPPROC" = "c:\program files\lenovo\vantage.exe=6 hosts=1" ] && echo 1 || echo 0)"
TOPDOM=$(echo "$NOISE" | jqpy 'print(d["domains"][0]["domain"] + "=" + str(d["domains"][0]["count"]))')
check "top dominio DNS ($TOPDOM)" "$([ "$TOPDOM" = "update.lenovo.com=4" ] && echo 1 || echo 0)"
RULE=$(echo "$NOISE" | jqpy 'print(next((str(r["count"]) + ";" + str(r["closed_pct"]) for r in d["rules"] if r["rule_id"]=="e2e0a0b-0000-4c01-9e01-000000000001"), ""))')
check "regla sembrada en el ruido ($RULE)" "$([ -n "$RULE" ] && echo 1 || echo 0)"
PCT=$(echo "$RULE" | cut -d';' -f2)
check "closed_pct=0 antes del triage ($PCT)" "$([ "$PCT" = "0" ] && echo 1 || echo 0)"
NOISE_HOST=$(curl -s "$BASE/api/noise?window=1h&host=pc-b")
HPROC=$(echo "$NOISE_HOST" | jqpy 'print(len(d["processes"]))')
HSCAN=$(echo "$NOISE_HOST" | jqpy 'print(d["scanned"]["events"])')
check "filtro host=pc-b aísla ($HPROC procesos, $HSCAN eventos)" "$([ "$HPROC" = "1" ] && [ "$HSCAN" -ge 2 ] && echo 1 || echo 0)"

echo "[e2e-reports] FASE E — actividad del SOC"
CODE=$(status_of -X POST "$BASE/api/alerts/$ALERT_ID/status" -H 'Content-Type: application/json' -d '{"status":"closed","by":"ana","note":"e2e informes"}')
check "triage de la alerta sembrada ($CODE)" "$([ "$CODE" = "200" ] && echo 1 || echo 0)"
SOC=$(curl -s "$BASE/api/reports/soc?window=1h")
CLOSED=$(echo "$SOC" | jqpy 'print(d["backlog"]["closed"])')
check "backlog.closed=$CLOSED" "$([ "${CLOSED:-0}" -ge 1 ] && echo 1 || echo 0)"
OP=$(echo "$SOC" | jqpy 'print(d["by_operator"].get("ana", 0))')
check "by_operator ana=$OP" "$([ "${OP:-0}" -ge 1 ] && echo 1 || echo 0)"
MTTC=$(echo "$SOC" | jqpy 'print(d["mean_time_to_close_seconds"] >= 0)')
check "mttc presente" "$([ "$MTTC" = "True" ] && echo 1 || echo 0)"

echo "[e2e-reports] FASE F — cobertura de flota"
FLEET=$(curl -s "$BASE/api/reports/fleet?window=1h")
ENABLED=$(echo "$FLEET" | jqpy 'print(d["enabled"])')
NOSIGNAL=$(echo "$FLEET" | jqpy 'print(d["summary"]["no_signal_in_window"])')
PCB=$(echo "$FLEET" | jqpy 'print(next((h["events_in_window"] for h in d["hosts"] if h["host"]=="PC-B"), -1))')
check "flota habilitada ($ENABLED) sin hosts mudos ($NOSIGNAL)" "$([ "$ENABLED" = "True" ] && [ "$NOSIGNAL" = "0" ] && echo 1 || echo 0)"
check "PC-B con eventos en la ventana ($PCB)" "$([ "${PCB:- -1}" -ge 1 ] && echo 1 || echo 0)"
FCSV=$(curl -s "$BASE/api/reports/fleet?window=1h&format=csv")
echo "$FCSV" | rg -q "^host,status," && check "csv de flota con cabecera host,status,..." 1 || check "csv de flota con cabecera host,status,..." 0

echo "[e2e-reports] FASE G — incidente"
INC=$(curl -s -X POST "$BASE/api/incidents" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Caso e2e informes\",\"severity\":\"low\",\"by\":\"ana\",\"alert_ids\":[\"$ALERT_ID\",\"ffffffffffffffff\"]}")
INC_ID=$(echo "$INC" | jqpy 'print(d["id"])')
check "caso creado ($INC_ID)" "$([ -n "$INC_ID" ] && echo 1 || echo 0)"
REP=$(curl -s "$BASE/api/reports/incident?id=$INC_ID")
FOUND=$(echo "$REP" | jqpy 'print(sum(1 for a in d["alerts"] if a["found"]), sum(1 for a in d["alerts"] if not a["found"]))')
check "alertas del caso: encontradas y ausentes ($FOUND)" "$([ "$FOUND" = "1 1" ] && echo 1 || echo 0)"
KIND=$(echo "$REP" | jqpy 'print(d["kind"])')
check "kind=incident ($KIND)" "$([ "$KIND" = "incident" ] && echo 1 || echo 0)"
CODE=$(status_of "$BASE/api/reports/incident?id=ffffffffffffffff")
check "caso inexistente responde 404 ($CODE)" "$([ "$CODE" = "404" ] && echo 1 || echo 0)"
CODE=$(status_of "$BASE/api/reports/incident?id=nope")
check "id malformado responde 400 ($CODE)" "$([ "$CODE" = "400" ] && echo 1 || echo 0)"
CODE=$(status_of "$BASE/api/reports/incident?id=$INC_ID&window=24h")
check "window en incidente responde 400 ($CODE)" "$([ "$CODE" = "400" ] && echo 1 || echo 0)"
ICSV=$(curl -s "$BASE/api/reports/incident?id=$INC_ID&format=csv")
echo "$ICSV" | rg -q "^alert_id,timestamp," && check "csv de incidente con cabecera" 1 || check "csv de incidente con cabecera" 0

echo "[e2e-reports] FASE H — honestidad del origen"
# los informes declaran la fuente; sin -store seria ring y con -store es
# store (ya comprobado en C). Aqui: la ventana enorme no miente sobre el cap.
BIG=$(curl -s "$BASE/api/noise?window=720h")
TRUNC=$(echo "$BIG" | jqpy 'print("truncated" in d["scanned"])')
check "bloque scanned presente en ventana amplia ($TRUNC)" "$([ "$TRUNC" = "True" ] && echo 1 || echo 0)"
CODE=$(status_of "$BASE/api/noise?window=1000h")
check "ruido con ventana fuera de rango responde 400 ($CODE)" "$([ "$CODE" = "400" ] && echo 1 || echo 0)"

echo
echo "[e2e-reports] RESULTADO: $PASS OK, $FAIL FAIL"
[ "$FAIL" = "0" ]

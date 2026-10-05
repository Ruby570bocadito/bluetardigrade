#!/usr/bin/env bash
# e2e_scenarios.sh — E2E de la validacion de detecciones (SIM-1/SIM-2)
# sobre binarios reales, sin mocks. Fases:
#
#   A. 'engine scenarios list' carga la biblioteca del repositorio y
#      la presenta (127 escenarios: uno por regla y por cadena).
#   B. 'engine scenarios replay' contra un motor de laboratorio real
#      (loopback): un subconjunto representativo (reglas de proceso,
#      registro, fichero, red e integraciones, mas una cadena de
#      kill-chains) dispara TODAS sus expectativas; las alertas leidas
#      por la API llevan la etiqueta "simulation" y hosts LAB-SIM-*.
#   C. La bateria completa (SF_E2E_FULL=1): los 127 escenarios.
#   D. Guardias: destino no loopback rechazado antes de tocar nada;
#      -only con id inexistente falla; una expectativa que el motor no
#      conoce (FALTA-CATALOGO) falla sin esperar timeouts.
#   E. SIM-4 parte A: el motor rearranca armado con -scenarios y la
#      bateria se lanza por la API (GET /api/scenarios, POST
#      /api/scenarios/run, historial y errores de contrato); se
#      comprueba que la ejecucion aislada no anade alertas al motor.
#
# Uso:
#   bash scripts/dev-tests/e2e_scenarios.sh
#   SF_E2E_INGEST_PORT=18117 SF_E2E_API_PORT=18118 bash scripts/dev-tests/e2e_scenarios.sh
#   SF_E2E_FULL=1 bash scripts/dev-tests/e2e_scenarios.sh   # bateria completa
#   SF_E2E_KEEP=1 bash ...            # conserva /tmp artefactos
#   SF_E2E_ENGINE=./bin/engine bash ...
#
# Requiere: go (para compilar si no hay SF_E2E_ENGINE), curl, python3, rg.
# Puertos por defecto 18117/18118: fuera del rango de e2e_threshold
# (18107/08), e2e_beacon (18097/98) y del motor real (7777/7778).
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
INGEST_PORT="${SF_E2E_INGEST_PORT:-18117}"
API_PORT="${SF_E2E_API_PORT:-18118}"
BASE="http://127.0.0.1:$API_PORT"
EADDR="127.0.0.1:$INGEST_PORT"
PASS=0; FAIL=0
ok()  { echo "  OK  - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL- $1"; FAIL=$((FAIL+1)); }
check() { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi; }

command -v curl >/dev/null    || { echo "FALLO preflight: curl no está en PATH"; exit 1; }
command -v python3 >/dev/null || { echo "FALLO preflight: python3 no está en PATH"; exit 1; }
command -v rg >/dev/null      || { echo "FALLO preflight: rg no está en PATH"; exit 1; }

TMPDIR_E2E=$(mktemp -d /tmp/sf-e2e-scenarios.XXXXXX)
LOG="$TMPDIR_E2E/engine.log"
: >"$LOG"

cleanup() {
  [ -n "${EPID:-}" ] && kill "$EPID" 2>/dev/null
  [ -n "${EPID:-}" ] && wait "$EPID" 2>/dev/null
  if [ "${SF_E2E_KEEP:-0}" = "1" ]; then
    echo "[e2e-scenarios] KEEP=1: artefactos en $TMPDIR_E2E (log: $LOG)"
  else
    rm -rf "$TMPDIR_E2E"
  fi
}
trap cleanup EXIT

if [ -n "${SF_E2E_ENGINE:-}" ]; then
  ENGINE="$SF_E2E_ENGINE"
  echo "[e2e-scenarios] usando binario externo: $ENGINE"
else
  command -v go >/dev/null || {
    echo "FALLO preflight: go no está en PATH y no hay SF_E2E_ENGINE"
    echo "(exporta el toolchain o pasa un binario ya compilado)"; exit 1
  }
  echo "[e2e-scenarios] compilando binario fresco en $TMPDIR_E2E/bin"
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
    except OSError:
        sys.exit(1)
    finally:
        s.close()
PY

# ------------------------------------------------------------------ motor lab
"$ENGINE" -addr "$EADDR" -api "127.0.0.1:$API_PORT" \
  -rules "$REPO/rules" -sequences "$REPO/sequences" \
  >>"$LOG" 2>&1 &
EPID=$!

for i in $(seq 1 50); do
  curl -s "$BASE/api/health" | rg -q '"ok"' && break
  sleep 0.2
done
curl -s "$BASE/api/health" | rg -q '"ok"' \
  || { echo "FALLO: el motor de laboratorio no levanta (log: $LOG)"; exit 1; }

# --------------------------------------------------------------------- fase A
echo "Fase A: engine scenarios list"
LIST_OUT="$("$ENGINE" scenarios list -dir "$REPO/scenarios" 2>"$TMPDIR_E2E/list.err")"
RC=$?
check "'scenarios list' sale 0" "$([ $RC -eq 0 ] && echo 1 || echo 0)"
N_SCEN=$(echo "$LIST_OUT" | rg -c '^sim-' || true)
check "la biblioteca lista 127 escenarios (una por regla y cadena)" \
  "$([ "${N_SCEN:-0}" -eq 127 ] && echo 1 || echo 0)"
echo "$LIST_OUT" | rg -q '^sim-lsass-comsvcs' \
  && ok "list incluye sim-lsass-comsvcs" || bad "list no incluye sim-lsass-comsvcs"

# --------------------------------------------------------------------- fase B
echo "Fase B: replay de un subconjunto representativo"
ONLY="sim-lsass-comsvcs,sim-run-key-registry,sim-office-payload-drop,sim-dga-dns,sim-ids-priority-high,sim-chain-cf86-be62"
"$ENGINE" scenarios replay -dir "$REPO/scenarios" \
  -ingest "$EADDR" -api "$BASE" -only "$ONLY" \
  -host-suffix "-e2eb" >"$TMPDIR_E2E/replay-b.txt" 2>&1
RC=$?
check "replay del subconjunto sale 0" "$([ $RC -eq 0 ] && echo 1 || echo 0)"
rg -q 'REPLAY completo' "$TMPDIR_E2E/replay-b.txt" \
  && ok "informe 'REPLAY completo'" || bad "sin 'REPLAY completo' en el informe"

# La etiqueta simulation viaja hasta la API del motor: TODA alerta del
# replay lleva la etiqueta y un host LAB-SIM-*.
SIM_STATS=$(curl -s "$BASE/api/alerts?limit=500" | python3 -c '
import json,sys
rows = json.load(sys.stdin)
sim = [r for r in rows if "simulation" in (r.get("tags") or [])]
lab = [r for r in rows if (r.get("host") or "").startswith("LAB-SIM-")]
print(f"{len(sim)} {len(rows)} {len(lab)}")
')
read -r N_SIM N_TOTAL N_LAB <<<"$SIM_STATS"
echo "  (alertas etiquetadas=$N_SIM / total=$N_TOTAL / hosts LAB-SIM=$N_LAB)"
check "hay alertas del replay en el motor" "$([ "${N_TOTAL:-0}" -gt 0 ] && echo 1 || echo 0)"
check "todas las alertas llevan la etiqueta simulation" \
  "$([ "${N_SIM:-0}" -eq "${N_TOTAL:-1}" ] && echo 1 || echo 0)"
check "todas las alertas son de hosts LAB-SIM-*" \
  "$([ "${N_LAB:-0}" -eq "${N_TOTAL:-1}" ] && echo 1 || echo 0)"

# --------------------------------------------------------------------- fase C
if [ "${SF_E2E_FULL:-0}" = "1" ]; then
  echo "Fase C: bateria completa (127 escenarios) contra el motor de laboratorio"
  "$ENGINE" scenarios replay -dir "$REPO/scenarios" -ingest "$EADDR" -api "$BASE" \
    -host-suffix "-e2ec" >"$TMPDIR_E2E/full-replay.txt" 2>&1
  RC=$?
  check "replay completo sale 0" "$([ $RC -eq 0 ] && echo 1 || echo 0)"
  rg -q 'REPLAY completo' "$TMPDIR_E2E/full-replay.txt" \
    && ok "bateria completa: informe final" || bad "bateria completa sin informe final"
else
  echo "Fase C: saltada (SF_E2E_FULL=1 para la bateria completa de 127 escenarios)"
fi

# --------------------------------------------------------------------- fase D
echo "Fase D: guardias del reproductor"
"$ENGINE" scenarios replay -dir "$REPO/scenarios" -ingest "10.9.8.7:7777" \
  -api "$BASE" >/dev/null 2>&1
check "ingesta NO loopback rechazada antes de nada" "$([ $? -ne 0 ] && echo 1 || echo 0)"
"$ENGINE" scenarios replay -dir "$REPO/scenarios" -ingest "$EADDR" -api "$BASE" \
  -only "sim-no-existe" >/dev/null 2>&1
check "-only con id inexistente falla" "$([ $? -ne 0 ] && echo 1 || echo 0)"

# Expectativa que el motor no conoce: FALTA-CATALOGO sin esperar timeout.
mkdir -p "$TMPDIR_E2E/escenarios-rotos"
cat >"$TMPDIR_E2E/escenarios-rotos/rotos.yaml" <<'EOF'
- name: "Expectativa inexistente"
  id: "sim-rotos-catalogo"
  description: "escenario de prueba con una regla que el motor no carga"
  host: "LAB-SIM-ROTA"
  user: "CORP\\sim"
  expected:
    - rule: "00000000-0000-0000-0000-000000000000"
  events:
    - type: process.create
      process:
        pid: 1
        name: "reg.exe"
        command_line: "reg.exe save HKLM\\SAM C:\\Users\\Public\\sam.hiv"
EOF
"$ENGINE" scenarios replay -dir "$TMPDIR_E2E/escenarios-rotos" \
  -ingest "$EADDR" -api "$BASE" >"$TMPDIR_E2E/broken.txt" 2>&1
check "expectativa desconocida por el motor falla" "$([ $? -ne 0 ] && echo 1 || echo 0)"
rg -q 'FALTA-CATALOGO' "$TMPDIR_E2E/broken.txt" \
  && ok "informe FALTA-CATALOGO sin esperar timeouts" || bad "sin FALTA-CATALOGO en el informe"

# --------------------------------------------------------------------- fase E
# La superficie API de SIM-4 (parte A): el motor rearranca armado con
# -scenarios y la bateria se lanza por HTTP. La ejecucion es el runner
# aislado en proceso (internal/scenario): nada de lo que eleva llega a
# los anillos reales del motor, y esa insolacion se comprueba aqui con
# el conteo de alertas etiquetadas antes y despues.
echo "Fase E: bateria bajo demanda por la API (motor armado con -scenarios)"
kill "$EPID" 2>/dev/null; wait "$EPID" 2>/dev/null
"$ENGINE" -addr "$EADDR" -api "127.0.0.1:$API_PORT" \
  -rules "$REPO/rules" -sequences "$REPO/sequences" \
  -scenarios "$REPO/scenarios" \
  >>"$LOG" 2>&1 &
EPID=$!
for i in $(seq 1 50); do
  curl -s "$BASE/api/health" | rg -q '"ok"' && break
  sleep 0.2
done
curl -s "$BASE/api/health" | rg -q '"ok"' \
  || { echo "FALLO: el motor armado no levanta (log: $LOG)"; exit 1; }

# El anillo de alertas arranca VACIO tras el rearranque: el conteo
# "antes" es la linea base contra la que se prueba la insolacion.
BEFORE=$(curl -s "$BASE/api/alerts?limit=500" | python3 -c '
import json,sys
rows = json.load(sys.stdin)
print(len([r for r in rows if "simulation" in (r.get("tags") or [])]))
')
echo "  (linea base de alertas etiquetadas tras el rearranque: $BEFORE)"

# Desarmado no existe aqui (este motor va armado); el 501 lo cubren los
# tests de unidad. Biblioteca por la API:
LIB=$(curl -s "$BASE/api/scenarios")
echo "$LIB" | python3 -c '
import json,sys
lib = json.load(sys.stdin)
assert lib["armed"] is True, lib
assert lib["count"] == 127, lib["count"]
assert len(lib["scenarios"]) == 127
ids = [s["id"] for s in lib["scenarios"]]
assert ids == sorted(ids)
assert any(s["id"] == "sim-lsass-comsvcs" for s in lib["scenarios"])
' && ok "GET /api/scenarios sirve la biblioteca (127, ordenada)" \
  || bad "GET /api/scenarios: biblioteca incorrecta"

# Lanzo la bateria (subconjunto o completa) y espero el resultado.
if [ "${SF_E2E_FULL:-0}" = "1" ]; then
  RUN_BODY=""
  N_EXPECT=127
else
  RUN_BODY='{"only":["sim-lsass-comsvcs","sim-run-key-registry","sim-office-payload-drop","sim-dga-dns","sim-ids-priority-high","sim-chain-cf86-be62"],"timeout_ms":15000}'
  N_EXPECT=6
fi
RUN=$(curl -s -X POST "$BASE/api/scenarios/run" -d "$RUN_BODY")
RUN_ID=$(echo "$RUN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["run_id"])' 2>/dev/null)
check "POST /api/scenarios/run acepta la bateria (202)" \
  "$([ -n "${RUN_ID:-}" ] && echo 1 || echo 0)"

DONE=""
for i in $(seq 1 600); do
  DONE=$(curl -s "$BASE/api/scenarios/runs/$RUN_ID")
  echo "$DONE" | rg -q '"status":"completed"' && break
  sleep 0.1
done
echo "$DONE" | python3 -c "
import json,sys
run = json.load(sys.stdin)
assert run['status'] == 'completed', run['status']
assert run['total'] == $N_EXPECT, run['total']
assert run['detected'] == $N_EXPECT, run
assert run['pass_rate'] == 1.0, run['pass_rate']
assert len(run['results']) == $N_EXPECT
for r in run['results']:
    assert r['status'] == 'detected', r
    assert r['duration_ms'] >= 0
" && ok "la bateria por API detecta todo el subconjunto ($N_EXPECT/$N_EXPECT)" \
  || bad "la bateria por API no completa como se espera"

# Insolacion: el conteo de alertas etiquetadas del motor NO cambia por
# la bateria (el runner aislado no publica en el motor real).
AFTER=$(curl -s "$BASE/api/alerts?limit=500" | python3 -c '
import json,sys
rows = json.load(sys.stdin)
print(len([r for r in rows if "simulation" in (r.get("tags") or [])]))
')
check "la bateria por API no anade alertas al motor (aislamiento)" \
  "$([ "${BEFORE:-0}" -eq "${AFTER:--1}" ] && echo 1 || echo 0)"

# Historial: el listado incluye la ejecucion, sin resultados.
curl -s "$BASE/api/scenarios/runs?limit=10" | python3 -c "
import json,sys
hist = json.load(sys.stdin)['runs']
assert any(r['run_id'] == '$RUN_ID' for r in hist), hist
assert all(r.get('results') is None for r in hist), hist
assert hist[0]['run_id'] == '$RUN_ID'
" && ok "GET /api/scenarios/runs lista la ejecucion (sin resultados)" \
  || bad "historial incorrecto"

# Errores de contrato:
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/scenarios/run" \
  -d '{"only":["sim-no-existe"]}')
check "POST con id desconocido responde 400" "$([ "$CODE" = "400" ] && echo 1 || echo 0)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/scenarios/runs/run-0123456789abcdef")
check "detalle de run inexistente responde 404" "$([ "$CODE" = "404" ] && echo 1 || echo 0)"

# -------------------------------------------------------------------- resumen
echo
echo "Resultado: $PASS OK, $FAIL FAIL"
[ "$FAIL" -eq 0 ]

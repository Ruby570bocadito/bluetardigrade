#!/usr/bin/env bash
# E2E con binarios reales: GET /api/sequences (ruta 10) + store SQLite opt-in.
#
# Tres fases sobre el mismo fichero de store:
#   A. live      — secuencias servidas con schema completo, stats con
#                  store_enabled/store_events y observabilidad del correlator.
#   B. reinicio  — el motor se mata y rearranca sobre el mismo fichero:
#                  store_events re-sembrado N->N, events_total in-proceso a 0,
#                  historial completo servido desde el store, q= operativo.
#   C. retención — reinicio con -store-retention 1s: la primera poda es
#                  síncrona en el arranque (antes de servir la API), así que
#                  el estado observable es store_events=0 y lista vacía; el
#                  log "[ENGINE] store pruned ..." es la segunda vía.
#
# Origen: E2E de la ronda 9 de Pulimiento (scripts del workspace) + la cola de
# la paralela (informe 21h42: "versionar el store-smoke parametrizado").
# Las aserciones son de consistencia interna (N es lo que sea que se siembre);
# los números canónicos del devsensor demo son 19 eventos / 18 alertas /
# q=lsass 2 (replicados por tres agentes independientes).
#
# Uso:
#   bash scripts/dev-tests/e2e_store_sequences.sh
#   SF_E2E_INGEST_PORT=18177 SF_E2E_API_PORT=18178 bash scripts/dev-tests/e2e_store_sequences.sh
#   SF_E2E_KEEP=1 bash ...            # conserva /tmp artefactos (log, db, binarios)
#   SF_E2E_ENGINE=./bin/engine SF_E2E_DEVSENSOR=./bin/devsensor bash ...  # reusa binarios
#
# Requiere: go (para compilar si no hay SF_E2E_ENGINE), curl, python3.
# Puertos por defecto 18077/18078: fuera del rango de smoke_auth.sh (17877+40).
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
INGEST_PORT="${SF_E2E_INGEST_PORT:-18077}"
API_PORT="${SF_E2E_API_PORT:-18078}"
BASE="http://127.0.0.1:$API_PORT"
EADDR="127.0.0.1:$INGEST_PORT"
SEQDIR="${SF_E2E_SEQUENCES_DIR:-$REPO/sequences}"
PASS=0; FAIL=0
ok()  { echo "  OK  - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL- $1"; FAIL=$((FAIL+1)); }
check() { # check <desc> <"0|1">
  if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi
}

command -v curl >/dev/null    || { echo "FALLO preflight: curl no está en PATH"; exit 1; }
command -v python3 >/dev/null || { echo "FALLO preflight: python3 no está en PATH"; exit 1; }

TMPDIR_E2E=$(mktemp -d /tmp/sf-e2e-store.XXXXXX)
DB="$TMPDIR_E2E/store.db"
LOG="$TMPDIR_E2E/engine.log"
: >"$LOG"

cleanup() {
  [ -n "${EPID:-}" ] && kill "$EPID" 2>/dev/null
  [ -n "${EPID:-}" ] && wait "$EPID" 2>/dev/null
  if [ "${SF_E2E_KEEP:-0}" = "1" ]; then
    echo "[e2e-store] KEEP=1: artefactos en $TMPDIR_E2E (log: $LOG)"
  else
    rm -rf "$TMPDIR_E2E"
  fi
}
trap cleanup EXIT

# binarios: reusar si los pasan, si no compilar frescos (un binario stale
# hace fallar los escenarios con síntomas engañosos — lección del smoke).
if [ -n "${SF_E2E_ENGINE:-}" ] && [ -n "${SF_E2E_DEVSENSOR:-}" ]; then
  ENGINE="$SF_E2E_ENGINE"; DEVSENSOR="$SF_E2E_DEVSENSOR"
  echo "[e2e-store] usando binarios externos: $ENGINE / $DEVSENSOR"
else
  command -v go >/dev/null || {
    echo "FALLO preflight: go no está en PATH y no hay SF_E2E_ENGINE/SF_E2E_DEVSENSOR"
    echo "(exporta el toolchain o pasa binarios ya compilados)"; exit 1
  }
  echo "[e2e-store] compilando binarios frescos en $TMPDIR_E2E/bin"
  mkdir -p "$TMPDIR_E2E/bin"
  (cd "$REPO" && go build -o "$TMPDIR_E2E/bin/engine" ./cmd/engine) || { echo "FALLO: build engine"; exit 1; }
  (cd "$REPO" && go build -o "$TMPDIR_E2E/bin/devsensor" ./scripts/dev-tests/scenario) || { echo "FALLO: build devsensor"; exit 1; }
  ENGINE="$TMPDIR_E2E/bin/engine"; DEVSENSOR="$TMPDIR_E2E/bin/devsensor"
fi

[ -d "$SEQDIR" ] || { echo "FALLO preflight: no existe el directorio de secuencias $SEQDIR"; exit 1; }

# preflight de puertos: un residual reteniendo el puerto produce fallos
# confusos a mitad de ronda (misma lección del smoke).
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

start_engine() { # start_engine <flags extra...>
  ( exec "$ENGINE" -addr "$EADDR" -api "127.0.0.1:$API_PORT" -store "$DB" -sequences "$SEQDIR" "$@" ) >>"$LOG" 2>&1 &
  EPID=$!
}
wait_health() { # wait_health -> 0/1
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
jqpy() { # jqpy <expr python sobre d> <json por stdin implícito>
  python3 -c "import json,sys; d=json.load(sys.stdin); $1"
}

echo "[e2e-store] FASE A — arranque live con -store + secuencias"
start_engine
wait_health || bail_with_log
check "motor arriba (health 200)" 1

echo "[e2e-store] alimentando telemetría (devsensor, ~5s)"
( exec "$DEVSENSOR" -addr "$EADDR" -interval 30ms ) >/dev/null 2>&1 &
DPID=$!
sleep 5
kill "$DPID" 2>/dev/null; wait "$DPID" 2>/dev/null

SEQ_JSON=$(curl -s "$BASE/api/sequences")
NSEQ=$(printf '%s' "$SEQ_JSON" | jqpy 'print(len(d))' 2>/dev/null || echo 0)
check "/api/sequences (ruta 10) sirve 11 secuencias (got $NSEQ)" "$([ "$NSEQ" = "11" ] && echo 1 || echo 0)"
SCHEMA_OK=$(printf '%s' "$SEQ_JSON" | jqpy 'need={"id","name","description","severity","window_seconds","tags","steps"}; print(1 if d and all(need <= set(s) for s in d) else 0)' 2>/dev/null || echo 0)
check "cada secuencia lleva id/name/description/severity/window_seconds/tags/steps" "$SCHEMA_OK"

ST=$(curl -s "$BASE/api/stats")
SE_EN=$(printf '%s' "$ST" | jqpy 'print(1 if d.get("store_enabled") is True else 0)' 2>/dev/null || echo 0)
check "stats.store_enabled == true" "$SE_EN"
N=$(printf '%s' "$ST" | jqpy 'print(d.get("store_events", -1))' 2>/dev/null || echo -1)
check "stats.store_events > 0 tras el feed (got $N; canónico del devsensor: 19)" "$([ "$N" -gt 0 ] 2>/dev/null && echo 1 || echo 0)"
CORR=$(printf '%s' "$ST" | jqpy 'print(1 if d.get("correlator_sequences")==11 and d.get("correlator_cap")==8192 else 0)' 2>/dev/null || echo 0)
check "stats correlator_sequences=11, correlator_cap=8192" "$CORR"
LIST_A=$(curl -s "$BASE/api/events?limit=1000" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
check "lista /api/events coherente con el contador del store ($LIST_A >= $N)" "$([ "$LIST_A" -ge "$N" ] 2>/dev/null && echo 1 || echo 0)"

echo "[e2e-store] FASE B — reinicio real sobre el MISMO fichero de store"
kill "$EPID" 2>/dev/null; wait "$EPID" 2>/dev/null; EPID=""
start_engine
wait_health || bail_with_log
check "motor rearrancado" 1
SEED=$(printf '%s' "$(curl -s "$BASE/api/stats")" | jqpy 'print(d.get("store_events", -1))' 2>/dev/null || echo -1)
check "store_events re-sembrado del disco N->N ($N -> $SEED)" "$([ "$SEED" = "$N" ] && echo 1 || echo 0)"
PROC=$(printf '%s' "$(curl -s "$BASE/api/stats")" | jqpy 'print(d.get("events_total", -1))' 2>/dev/null || echo -1)
check "events_total in-proceso arranca a 0 con el store lleno (got $PROC)" "$([ "$PROC" = "0" ] && echo 1 || echo 0)"
HIST=$(curl -s "$BASE/api/events?limit=1000" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
check "la API sirve el historial completo desde el store ($HIST == $N)" "$([ "$HIST" = "$N" ] && echo 1 || echo 0)"
QHIT=$(curl -s "$BASE/api/events?q=lsass&limit=1000" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
check "q=lsass opera contra el store (got $QHIT; canónico: 2)" "$([ "$QHIT" -ge 1 ] 2>/dev/null && echo 1 || echo 0)"

echo "[e2e-store] FASE C — reinicio con -store-retention 1s (primera poda síncrona)"
kill "$EPID" 2>/dev/null; wait "$EPID" 2>/dev/null; EPID=""
start_engine -store-retention 1s
wait_health || bail_with_log
check "motor rearrancado con retención 1s" 1
# grep -c ya imprime 0 sin match (y sale 1): || true, nunca || echo 0
# (el eco extra producía "0\n0" y reventaba el -ge siguiente)
PRUNED_LOG=$(grep -c "store pruned .* events / .* alerts older than 1s" "$LOG" 2>/dev/null || true)
check "log de poda presente: 'store pruned ... older than 1s' ($PRUNED_LOG línea)" "$([ "$PRUNED_LOG" -ge 1 ] && echo 1 || echo 0)"
STC=$(curl -s "$BASE/api/stats")
SEV=$(printf '%s' "$STC" | jqpy 'print(d.get("store_events", -1))' 2>/dev/null || echo -1)
SAL=$(printf '%s' "$STC" | jqpy 'print(d.get("store_alerts", -1))' 2>/dev/null || echo -1)
check "store_events podado a 0 (got $SEV)" "$([ "$SEV" = "0" ] && echo 1 || echo 0)"
check "store_alerts podado a 0 (got $SAL)" "$([ "$SAL" = "0" ] && echo 1 || echo 0)"
LIST_C=$(curl -s "$BASE/api/events?limit=1000" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo -1)
check "lista /api/events vacía tras la poda (got $LIST_C)" "$([ "$LIST_C" = "0" ] && echo 1 || echo 0)"

echo "[e2e-store] RESULTADO: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]

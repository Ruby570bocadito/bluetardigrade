#!/usr/bin/env bash
# e2e_siem.sh — E2E de los conectores SIEM (Elasticsearch + Splunk HEC)
# sobre binarios reales, sin mocks en el camino de producción. Tres fases:
#
#   A. Motor con -elastic y -splunk apuntando a los receptores de
#      laboratorio (siem_receiver.py): cada alerta del replay canónico
#      llega a AMBOS sinks exactamente una vez, con la forma de protocolo
#      correcta (NDJSON meta/doc con _index sf-alerts-YYYY.MM.DD y _id
#      estable en Elastic; evento HEC con time/sourcetype/host y campos
#      indexados en Splunk), credenciales correctas y paridad stats/
#      metrics (/api/stats vs /metrics vs recibido por el receptor).
#   B. Control negativo: motor SIN sinks — las stats quedan a cero y los
#      receptores no reciben ni una petición (nadie entrega por accidente).
#   C. Credenciales: los receptores exigen el esquema de autenticación
#      real (ApiKey en Elastic, Splunk token en HEC) — una credencial
#      errónea en el motor se traduce en entregas fallidas visibles en
#      /api/stats (elastic_failed/splunk_failed), nunca en éxitos silenciosos.
#
# Uso:
#   bash scripts/dev-tests/e2e_siem.sh
#   SF_E2E_INGEST_PORT=18147 SF_E2E_API_PORT=18148 \
#   SF_E2E_ELASTIC_PORT=18149 SF_E2E_SPLUNK_PORT=18150 bash scripts/dev-tests/e2e_siem.sh
#   SF_E2E_KEEP=1 bash ...            # conserva /tmp artefactos
#   SF_E2E_ENGINE=./bin/engine SF_E2E_DEVSENSOR=./bin/devsensor bash ...  # reusa binarios
#
# Requiere: go (para compilar si no hay SF_E2E_ENGINE), curl, python3.
# Puertos por defecto 18147-18150: fuera de e2e_beacon (18097/98),
# e2e_threshold (18107/08), e2e_risk_a1 (18127-30), e2e_store_sequences
# (18177/78) y los smokes (17877+).
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
INGEST_PORT="${SF_E2E_INGEST_PORT:-18147}"
API_PORT="${SF_E2E_API_PORT:-18148}"
ELASTIC_PORT="${SF_E2E_ELASTIC_PORT:-18149}"
SPLUNK_PORT="${SF_E2E_SPLUNK_PORT:-18150}"
BASE="http://127.0.0.1:$API_PORT"
APIADDR="127.0.0.1:$API_PORT"
EADDR="127.0.0.1:$INGEST_PORT"
PASS=0; FAIL=0
ok()  { echo "  OK  - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL- $1"; FAIL=$((FAIL+1)); }
check() { # check <desc> <"0|1">
  if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi
}

command -v curl >/dev/null    || { echo "FALLO preflight: curl no está en PATH"; exit 1; }
command -v python3 >/dev/null || { echo "FALLO preflight: python3 no está en PATH"; exit 1; }
command -v rg >/dev/null      || { echo "FALLO preflight: rg no está en PATH"; exit 1; }

TMPDIR_E2E=$(mktemp -d /tmp/sf-e2e-siem.XXXXXX)
LOG="$TMPDIR_E2E/engine.log"
ELASTIC_LOG="$TMPDIR_E2E/elastic.log"
SPLUNK_LOG="$TMPDIR_E2E/splunk.log"
ELASTIC_JSON="$TMPDIR_E2E/elastic.json"
SPLUNK_JSON="$TMPDIR_E2E/splunk.json"
: >"$LOG"; : >"$ELASTIC_LOG"; : >"$SPLUNK_LOG"

cleanup() {
  [ -n "${EPID:-}" ]    && kill "$EPID" 2>/dev/null
  [ -n "${EPID:-}" ]    && wait "$EPID" 2>/dev/null
  [ -n "${ELPID:-}" ]   && kill "$ELPID" 2>/dev/null
  [ -n "${SPPID:-}" ]   && kill "$SPPID" 2>/dev/null
  [ -n "${DVPID:-}" ]   && kill "$DVPID" 2>/dev/null
  if [ "${SF_E2E_KEEP:-0}" = "1" ]; then
    echo "[e2e-siem] KEEP=1: artefactos en $TMPDIR_E2E (log: $LOG)"
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
else
  command -v go >/dev/null || {
    echo "FALLO preflight: go no está en PATH y no hay SF_E2E_ENGINE/SF_E2E_DEVSENSOR"
    echo "(exporta el toolchain o pasa binarios ya compilados)"; exit 1
  }
  echo "[e2e-siem] compilando binarios frescos..."
  (cd "$REPO" && go build -o "$TMPDIR_E2E/engine" ./cmd/engine &&
   go build -o "$TMPDIR_E2E/devsensor" ./scripts/dev-tests/scenario) || { echo "FALLO: go build"; exit 1; }
  ENGINE="$TMPDIR_E2E/engine"; DEVSENSOR="$TMPDIR_E2E/devsensor"
fi

stats_field() { # stats_field <campo>
  curl -s "$BASE/api/stats" | python3 -c "import json,sys; print(json.load(sys.stdin).get('$1', 'MISSING'))" 2>/dev/null
}
metric_value() { # metric_value <nombre>
  curl -s "$BASE/metrics" | rg "^$1 " | awk '{print $2}' | head -1
}

wait_health() {
  for _ in $(seq 1 50); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" = "200" ] && return 0
    sleep 0.2
  done
  return 1
}

wait_settled() { # espera a que alerts_total y ambos sent se estabilicen
  local prev="-1" stable=0
  for _ in $(seq 1 150); do
    local at es ss
    at=$(stats_field alerts_total); es=$(stats_field elastic_sent); ss=$(stats_field splunk_sent)
    if [ "$at" = "$es" ] && [ "$at" = "$ss" ] && [ "$at" = "$prev" ]; then
      stable=$((stable+1))
      [ "$stable" -ge 3 ] && return 0
    else
      stable=0
    fi
    prev="$at"
    sleep 0.2
  done
  return 1
}

stop_receivers() { # los receptores vuelcan stats en vivo: basta con matarlos
  [ -n "${ELPID:-}" ] && kill -9 "${ELPID}" 2>/dev/null
  [ -n "${SPPID:-}" ] && kill -9 "${SPPID}" 2>/dev/null
  wait "${ELPID:-}" "${SPPID:-}" 2>/dev/null
  ELPID=""; SPPID=""
}

json_field() { # json_field <fichero> <clave>
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$1" "$2" 2>/dev/null || echo -1
}

# ------------------------------------------------- FASE 0: guard de esquema
# O1 del dictamen #32: un sink con esquema distinto de http/https debe
# matar el arranque con mensaje accionable (fail-loud), no quemar
# reintentos en silencio por cada entrega.
echo "== Fase 0: guard de esquema del sink (fail-loud) =="
GD_LOG="$TMPDIR_E2E/guard.log"
"$ENGINE" -api "$APIADDR" -elastic "ftp://127.0.0.1:1" -elastic-index sf-alerts >"$GD_LOG" 2>&1
GD_RC=$?
if [ "$GD_RC" = "1" ] && rg -q 'esquema "ftp" invalido' "$GD_LOG"; then
  ok "engine rechaza -elastic ftp:// en el arranque (exit 1, mensaje accionable)"
else
  bad "guard de esquema: exit=$GD_RC (esperaba 1) o mensaje ausente"
fi

# ------------------------------------------------------------- FASE A
echo "== Fase A: entrega real a ambos sinks =="
python3 "$REPO/scripts/dev-tests/siem_receiver.py" --protocol elastic \
  --port "$ELASTIC_PORT" --secret e2e-api-key --stats-file "$ELASTIC_JSON" >"$ELASTIC_LOG" 2>&1 &
ELPID=$!
python3 "$REPO/scripts/dev-tests/siem_receiver.py" --protocol splunk \
  --port "$SPLUNK_PORT" --secret e2e-hec-token --stats-file "$SPLUNK_JSON" >"$SPLUNK_LOG" 2>&1 &
SPPID=$!
sleep 0.5

"$ENGINE" -addr "$EADDR" -api "$APIADDR" \
  -elastic "http://127.0.0.1:$ELASTIC_PORT" -elastic-index "sf-alerts" \
  -elastic-api-key "e2e-api-key" \
  -splunk "http://127.0.0.1:$SPLUNK_PORT" \
  -splunk-token "e2e-hec-token" >"$LOG" 2>&1 &
EPID=$!
wait_health || { echo "FALLO: el motor no levantó"; exit 1; }

"$DEVSENSOR" -addr "$EADDR" -interval 30ms >"$TMPDIR_E2E/devsensor.log" 2>&1 &
DVPID=$!

if wait_settled; then
  check "el replay canónico genera alertas (alerts_total=$(stats_field alerts_total))" "1"
else
  check "entrega establecida (alerts_total/sent estables en 30s)" "0"
fi
kill "$DVPID" 2>/dev/null; wait "$DVPID" 2>/dev/null; DVPID=""

N=$(stats_field alerts_total)
ES=$(stats_field elastic_sent)
SS=$(stats_field splunk_sent)
check "elastic_sent == alerts_total ($ES == $N)" "$([ "$ES" = "$N" ] && echo 1 || echo 0)"
check "splunk_sent == alerts_total ($SS == $N)" "$([ "$SS" = "$N" ] && echo 1 || echo 0)"

# paridad /metrics contra /api/stats (contrato D1 aplicado a los sinks,
# consultada con el motor vivo)
M1=$(metric_value sf_elastic_sent_total); M2=$(metric_value sf_splunk_sent_total)
check "paridad métricas: sf_elastic_sent_total == elastic_sent ($M1 == $ES)" "$([ "$M1" = "$ES" ] && echo 1 || echo 0)"
check "paridad métricas: sf_splunk_sent_total == splunk_sent ($M2 == $SS)" "$([ "$M2" = "$SS" ] && echo 1 || echo 0)"

# parada ordenada del motor: el drain final no debe perder ni duplicar
kill -TERM "$EPID" 2>/dev/null; wait "$EPID" 2>/dev/null; EPID=""
stop_receivers

# los ficheros de stats del receptor son la verdad del receptor
EL_RECV=$(json_field "$ELASTIC_JSON" received)
SP_RECV=$(json_field "$SPLUNK_JSON" received)
check "el receptor elastic recibió las $N alertas ($EL_RECV)" "$([ "$EL_RECV" = "$N" ] && echo 1 || echo 0)"
check "el receptor splunk recibió los $N eventos ($SP_RECV)" "$([ "$SP_RECV" = "$N" ] && echo 1 || echo 0)"
check "cero frames malformados en elastic" "$( [ "$(json_field "$ELASTIC_JSON" bad_frames)" = "0" ] && echo 1 || echo 0)"
check "cero frames malformados en splunk" "$( [ "$(json_field "$SPLUNK_JSON" bad_frames)" = "0" ] && echo 1 || echo 0)"
check "autorización ApiKey presente en todos los bulks" "$( [ "$(json_field "$ELASTIC_JSON" with_auth)" = "$N" ] && echo 1 || echo 0)"
check "autorización Splunk presente en todos los eventos" "$( [ "$(json_field "$SPLUNK_JSON" with_auth)" = "$N" ] && echo 1 || echo 0)"
check "índices con sufijo diario sf-alerts-YYYY.MM.DD" "$(python3 -c "
import json
idx = set(json.load(open('$ELASTIC_JSON'))['indexes'])
print(1 if idx and all(i.startswith('sf-alerts-') and len(i) == len('sf-alerts-2006.01.02') for i in idx) else 0)" 2>/dev/null || echo 0)"

# ------------------------------------------------------------- FASE B
echo "== Fase B: control negativo (motor sin sinks) =="
rm -f "$ELASTIC_JSON" "$SPLUNK_JSON"
python3 "$REPO/scripts/dev-tests/siem_receiver.py" --protocol elastic \
  --port "$ELASTIC_PORT" --stats-file "$ELASTIC_JSON" >"$ELASTIC_LOG" 2>&1 &
ELPID=$!
python3 "$REPO/scripts/dev-tests/siem_receiver.py" --protocol splunk \
  --port "$SPLUNK_PORT" --stats-file "$SPLUNK_JSON" >"$SPLUNK_LOG" 2>&1 &
SPPID=$!
sleep 0.5

"$ENGINE" -addr "$EADDR" -api "$APIADDR" >"$LOG" 2>&1 &
EPID=$!
wait_health || { echo "FALLO: el motor (B) no levantó"; exit 1; }
"$DEVSENSOR" -addr "$EADDR" -interval 30ms >"$TMPDIR_E2E/devsensor-b.log" 2>&1 &
DVPID=$!
sleep 4
kill "$DVPID" 2>/dev/null; wait "$DVPID" 2>/dev/null; DVPID=""

Z1=$(stats_field elastic_sent); Z2=$(stats_field elastic_failed); Z3=$(stats_field elastic_dropped)
Z4=$(stats_field splunk_sent); Z5=$(stats_field splunk_failed); Z6=$(stats_field splunk_dropped)
check "stats de sinks a cero sin -elastic/-splunk ($Z1/$Z2/$Z3 $Z4/$Z5/$Z6)" \
  "$([ "$Z1$Z2$Z3$Z4$Z5$Z6" = "000000" ] && echo 1 || echo 0)"
kill -TERM "$EPID" 2>/dev/null; wait "$EPID" 2>/dev/null; EPID=""
stop_receivers
EL_RECV=$(json_field "$ELASTIC_JSON" received)
check "ninguna entrega accidental al receptor ($EL_RECV == 0)" "$([ "$EL_RECV" = "0" ] && echo 1 || echo 0)"

# ------------------------------------------------------------- FASE C
echo "== Fase C: credencial errónea = falla visible, no éxito silencioso =="
rm -f "$ELASTIC_JSON" "$SPLUNK_JSON"
python3 "$REPO/scripts/dev-tests/siem_receiver.py" --protocol elastic \
  --port "$ELASTIC_PORT" --secret LA-CLAVE-BUENA --stats-file "$ELASTIC_JSON" >"$ELASTIC_LOG" 2>&1 &
ELPID=$!
python3 "$REPO/scripts/dev-tests/siem_receiver.py" --protocol splunk \
  --port "$SPLUNK_PORT" --secret EL-TOKEN-BUENO --stats-file "$SPLUNK_JSON" >"$SPLUNK_LOG" 2>&1 &
SPPID=$!
sleep 0.5

"$ENGINE" -addr "$EADDR" -api "$APIADDR" \
  -elastic "http://127.0.0.1:$ELASTIC_PORT" -elastic-api-key "clave-incorrecta" \
  -splunk "http://127.0.0.1:$SPLUNK_PORT" -splunk-token "token-incorrecto" \
  >"$LOG" 2>&1 &
EPID=$!
wait_health || { echo "FALLO: el motor (C) no levantó"; exit 1; }
"$DEVSENSOR" -addr "$EADDR" -interval 30ms >"$TMPDIR_E2E/devsensor-c.log" 2>&1 &
DVPID=$!

# los reintentos agotan (3 intentos con backoff): dar margen
SETTLED=0
for _ in $(seq 1 150); do
  AT=$(stats_field alerts_total); EF=$(stats_field elastic_failed); SF=$(stats_field splunk_failed)
  if [ "$AT" != "0" ] && [ "$EF" -ge "$AT" ] && [ "$SF" -ge "$AT" ] 2>/dev/null; then SETTLED=1; break; fi
  sleep 0.2
done
kill "$DVPID" 2>/dev/null; wait "$DVPID" 2>/dev/null; DVPID=""
AT=$(stats_field alerts_total); EF=$(stats_field elastic_failed); SF=$(stats_field splunk_failed)
check "fallos visibles en stats: elastic_failed ($EF) >= alerts_total ($AT)" "$([ "$SETTLED" = "1" ] && echo 1 || echo 0)"
check "fallos visibles en stats: splunk_failed ($SF) >= alerts_total ($AT)" "$([ "$SETTLED" = "1" ] && echo 1 || echo 0)"
kill -TERM "$EPID" 2>/dev/null; wait "$EPID" 2>/dev/null; EPID=""
stop_receivers
ES_RECV=$(json_field "$ELASTIC_JSON" received)
SP_RECV=$(json_field "$SPLUNK_JSON" received)
check "el receptor con credencial buena NO aceptó nada ($ES_RECV == 0)" "$([ "$ES_RECV" = "0" ] && echo 1 || echo 0)"
check "el receptor HEC con token bueno NO aceptó nada ($SP_RECV == 0)" "$([ "$SP_RECV" = "0" ] && echo 1 || echo 0)"

echo
echo "RESULTADO: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = "0" ] || exit 1

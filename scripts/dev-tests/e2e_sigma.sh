#!/usr/bin/env bash
# End-to-end verification of the Sigma converter (A4): a committed
# Sigma fixture corpus is converted by the REAL engine binary, the
# output loads into the engine, and converted rules DETECT real
# telemetry end to end through the TCP feed and the local API.
#
# Scenarios (exit 0 only if all pass):
#   1. engine sigma converts the 6-fixture corpus: 4 converted, 2
#      skipped with reasons (out-of-scope product, unsupported modifier)
#   2. output is deterministic (two runs byte-identical)
#   3. the emitted YAML loads in `engine validate` (4 rules, 0 errors)
#   4. converted PowerShell rule fires on a real process.create event
#   5. converted C2 network rule fires on a real network.connect event
#   6. converted registry rule fires on a real registry.set event
#   7. a benign event raises NOTHING (alert count unchanged)
#   8. -strict fails (exit 1) when there are skips
#
# Usage: scripts/dev-tests/e2e_sigma.sh [engine-binary]
# The engine is built automatically when missing (go >= 1.22 in PATH).

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURES="$ROOT/scripts/dev-tests/sigma_fixtures"
API="${SIGMA_E2E_API_PORT:-17889}"
INGEST="${SIGMA_E2E_INGEST_PORT:-17887}"
WORK="$(mktemp -d)"
ENGINE="${1:-$WORK/sf-engine}"
ENGINE_PID=""
PASS=0
FAIL=0

cleanup() { kill "$ENGINE_PID" 2>/dev/null; wait "$ENGINE_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
ok()  { PASS=$((PASS+1)); say "  ok: $*"; }
bad() { FAIL=$((FAIL+1)); say "  FAIL: $*"; }

api() { curl -s -m 5 "http://127.0.0.1:${API}$1"; }

# send_event posts one NDJSON event straight into the ingest port.
send_event() {
  printf '%s\n' "$1" | timeout 3 python3 -c "
import socket,sys
s=socket.create_connection(('127.0.0.1',$INGEST),timeout=2)
s.sendall(sys.stdin.buffer.read()); s.close()"
}

alerts_for() { # rule_id -> number of alerts carrying it
  api "/api/alerts?limit=100" | python3 -c "
import json,sys
data=json.load(sys.stdin)
print(sum(1 for a in data if a.get('rule_id')=='$1'))"
}

start_engine() {
  "$ENGINE" -api "127.0.0.1:${API}" -addr "127.0.0.1:${INGEST}" \
    -rules "$WORK/out" -sequences "$WORK/no-sequences" -suppressions "" \
    > "$WORK/engine.log" 2>&1 &
  ENGINE_PID=$!
  for _ in $(seq 1 50); do
    if api /api/health | grep -q '"ok"'; then return 0; fi
    sleep 0.2
  done
  say "engine did not become healthy:"; cat "$WORK/engine.log"; exit 1
}

say "== e2e_sigma: Sigma corpus -> native rules -> real detections =="

if [ ! -x "$ENGINE" ]; then
  (cd "$ROOT" && go build -o "$ENGINE" ./cmd/engine) || { say "build failed"; exit 1; }
fi
mkdir -p "$WORK/no-sequences"

say "-- scenario 1: conversion of the committed fixture corpus"
"$ENGINE" sigma -dir "$FIXTURES" -out "$WORK/out.yaml" > "$WORK/report1.txt" 2>&1
grep -q 'ficheros: 6 | convertidas: 4 | omitidas: 2' "$WORK/report1.txt" \
  && ok "informe: 6 ficheros, 4 convertidas, 2 omitidas" \
  || { bad "informe inesperado"; cat "$WORK/report1.txt"; exit 1; }
grep -q 'producto fuera de alcance\|product "linux"' "$WORK/report1.txt" \
  && ok "skip de linux documentado con motivo" \
  || bad "skip de linux sin motivo claro"
grep -q 'base64offset' "$WORK/report1.txt" \
  && ok "skip de base64offset documentado con motivo" \
  || bad "skip de base64offset sin motivo claro"

say "-- scenario 2: deterministic output"
"$ENGINE" sigma -dir "$FIXTURES" -out "$WORK/out2.yaml" > /dev/null 2>&1
cmp -s "$WORK/out.yaml" "$WORK/out2.yaml" \
  && ok "dos conversiones -> bytes identicos" || bad "salida no determinista"

say "-- scenario 3: the emitted YAML loads in engine validate"
mkdir -p "$WORK/out"
cp "$WORK/out.yaml" "$WORK/out/convertidas.yaml"
if "$ENGINE" validate -rules "$WORK/out" -sequences "$WORK/no-sequences" \
    2>&1 | sed 's/\x1b\[[0-9;]*m//g' > "$WORK/validate.txt"; then
  grep -q "4 cargadas" "$WORK/validate.txt" \
    && ok "validate: 4 reglas convertidas cargan sin errores" \
    || { bad "validate no reporta 4 reglas"; cat "$WORK/validate.txt"; exit 1; }
else
  bad "validate salio con error"; cat "$WORK/validate.txt"; exit 1
fi

say "-- scenario 4-6: converted rules detect real telemetry"
start_engine

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
send_event "{\"id\":\"sig-e2e-1\",\"timestamp\":\"$TS\",\"type\":\"process.create\",\"source\":\"e2e\",\"host\":\"LAB-SIGMA\",\"user\":\"analista\",\"process\":{\"pid\":3131,\"name\":\"powershell.exe\",\"image\":\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\",\"command_line\":\"powershell.exe -nop -w hidden -enc SQBFAFgA\"}}"
send_event "{\"id\":\"sig-e2e-2\",\"timestamp\":\"$TS\",\"type\":\"network.connect\",\"source\":\"e2e\",\"host\":\"LAB-SIGMA\",\"network\":{\"protocol\":\"tcp\",\"destination_ip\":\"203.0.113.66\",\"destination_port\":8443}}"
send_event "{\"id\":\"sig-e2e-3\",\"timestamp\":\"$TS\",\"type\":\"registry.set\",\"source\":\"e2e\",\"host\":\"LAB-SIGMA\",\"registry\":{\"operation\":\"SetValue\",\"key\":\"HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run\\\\OneDriveUpdate\"}}"
sleep 0.6

for rid in \
  "11111111-aaaa-4e18-8a02-3b9c6d1e7f40" \
  "44444444-dddd-4444-8a02-3b9c6d1e7f40" \
  "33333333-cccc-4444-8a02-3b9c6d1e7f40"; do
  N=$(alerts_for "$rid")
  [ "$N" -ge 1 ] && ok "regla convertida $rid dispara ($N alerta(s))" \
    || { bad "regla $rid no disparo"; cat "$WORK/engine.log"; }
done

say "-- scenario 7: a benign event raises nothing"
BEFORE=$(alerts_for "11111111-aaaa-4e18-8a02-3b9c6d1e7f40")
send_event "{\"id\":\"sig-e2e-4\",\"timestamp\":\"$TS\",\"type\":\"process.create\",\"source\":\"e2e\",\"host\":\"LAB-SIGMA\",\"process\":{\"pid\":3132,\"name\":\"powershell.exe\",\"image\":\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\",\"command_line\":\"powershell.exe -Command Get-Date\"}}"
sleep 0.6
AFTER=$(alerts_for "11111111-aaaa-4e18-8a02-3b9c6d1e7f40")
[ "$BEFORE" = "$AFTER" ] && ok "evento benigno -> 0 alertas nuevas" \
  || bad "falso positivo benigno: $BEFORE -> $AFTER"

say "-- scenario 8: -strict fails when there are skips"
if "$ENGINE" sigma -dir "$FIXTURES" -out "$WORK/strict.yaml" -strict > /dev/null 2>&1; then
  bad "-strict deberia salir 1 con 2 omitidas"
else
  CODE=$?
  [ "$CODE" = "1" ] && ok "-strict exit 1 con omitidas (codigo $CODE)" \
    || bad "-strict exit $CODE, want 1"
fi

say ""
say "resultado: $PASS ok, $FAIL FAIL"
[ "$FAIL" = "0" ] || exit 1

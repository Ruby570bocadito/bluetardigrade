#!/usr/bin/env bash
# End-to-end smoke of the native TLS transport on the NDJSON ingest,
# using the real engine and devsensor. Complements the unit tests in
# internal/ingest/ingest_tls_test.go with deployment-facing scenarios:
#
#   1. engine with TLS + sensor with -tls -ca  -> handshake ok, events flow,
#                                                startup banner names TLS
#   2. engine with TLS + PLAIN sensor          -> sensor fails loudly, engine
#                                                ingests nothing
#   3. engine with TLS + sensor with a WRONG CA -> handshake rejected, engine
#                                                ingests nothing
#   4. TLS composes with the AUTH token        -> encrypted AND authenticated
#   5. engine with only -ingest-cert           -> refuses to start (fail-loud
#                                                before the bind)
#   6. engine with a MISSING cert file         -> refuses to start, error
#                                                names the file
#
# Certificates are generated with openssl (self-signed, IP SAN 127.0.0.1,
# CA:true so the leaf is its own trust anchor — the same shape the unit
# tests build with crypto/x509).
#
# Usage: scripts/dev-tests/smoke_ingest_tls.sh [engine-binary] [devsensor-binary]
# Missing binaries are built automatically (requires go >= 1.22 in PATH).
# Exit 0 only if all six scenarios behave as documented in README.md
# ("Ingest TLS (encryption in transit)").

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${SMOKE_TLS_PORT:-17977}"
API="${SMOKE_TLS_API_PORT:-17978}"
WORK="$(mktemp -d)"
[ "${SMOKE_KEEP:-0}" = "1" ] || RM_WORK=1
ENGINE="${1:-$WORK/engine}"
DEVSENSOR="${2:-$WORK/devsensor}"
FAILED=0
PIDS=()

log()  { printf '[smoke_tls] %s\n' "$*"; }
fail() { printf '[smoke_tls] FAIL: %s\n' "$*" >&2; FAILED=1; }

bail_with_log() { # $1 = message, $2 = log file whose tail explains the failure
  fail "$1"
  echo "[smoke_tls] ---- tail of $2 ----" >&2
  tail -5 "$2" 2>/dev/null >&2
  exit 1
}

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; done
  [ "${RM_WORK:-0}" = "1" ] && rm -rf "$WORK"
  [ "${RM_WORK:-0}" != "1" ] && echo "[smoke_tls] artifacts kept in $WORK"
  return 0
}
trap cleanup EXIT

port_busy() { # $1 = port; returns 0 (busy) if something already listens
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}
for p in "$PORT" "$API" "$((PORT+10))" "$((API+10))" "$((PORT+20))" "$((API+20))" \
         "$((PORT+30))" "$((API+30))" "$((PORT+40))" "$((API+40))"; do
  if port_busy "$p"; then
    fail "port $p is already in use (leftover engine? set SMOKE_TLS_PORT/SMOKE_TLS_API_PORT)"; exit 1
  fi
done

# --- preflights (house pattern: fail with the escape route, not a raw error)
command -v go >/dev/null || { fail "FALLO preflight: go no está en PATH (exporta el toolchain para compilar los binarios)"; exit 1; }
command -v openssl >/dev/null || { fail "FALLO preflight: openssl no está en PATH (instálalo o genera los certs con crypto/x509 por tu cuenta)"; exit 1; }

# --- build binaries if not supplied
if [ ! -x "$ENGINE" ] || [ ! -x "$DEVSENSOR" ]; then
  log "building engine and devsensor with go..."
  (cd "$ROOT" && go build -o "$WORK/engine" ./cmd/engine && go build -o "$WORK/devsensor" ./cmd/devsensor) || {
    fail "go build failed"; exit 1; }
fi

# --- lab PKI: self-signed leaf that is its own CA, IP SAN = 127.0.0.1,
#     plus a second unrelated one for the wrong-CA rejection
gen_cert() { # $1 = cert out, $2 = key out, $3 = CN
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout "$2" -out "$1" -days 2 -nodes -subj "/CN=$3" \
    -addext "subjectAltName=IP:127.0.0.1" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,digitalSignature,keyCertSign" \
    -addext "extendedKeyUsage=serverAuth" 2>/dev/null
}
gen_cert "$WORK/cert.pem" "$WORK/key.pem" "ingest-lab" \
  || { fail "openssl could not generate the lab certificate"; exit 1; }
gen_cert "$WORK/other-ca.pem" "$WORK/other-key.pem" "unrelated-ca" \
  || { fail "openssl could not generate the wrong-CA certificate"; exit 1; }
[ -s "$WORK/cert.pem" ] && [ -s "$WORK/key.pem" ] \
  || { fail "lab certificate files are empty"; exit 1; }

# exec so the subshell PID ($!) IS the engine process and `kill $!` reaches it
start_engine() { # $1 = bind addr, $2 = api port, $3 = log file, $4+ = extra flags
  local addr="$1" apiport="$2" logf="$3"
  shift 3
  (cd "$WORK" && exec "$ENGINE" -addr "$addr" -api "127.0.0.1:$apiport" \
      -rules "$ROOT/rules" -sequences "$ROOT/sequences" -reload-every 0 "$@" \
      >"$logf" 2>&1) &
  PIDS+=($!)
}

stats_on() { curl -sf "http://127.0.0.1:$1/api/stats" 2>/dev/null; }
wait_api_on() { # $1 = api port; wait until that engine's HTTP API answers
  for _ in $(seq 1 50); do stats_on "$1" >/dev/null && return 0; sleep 0.2; done
  return 1
}
events_of() { stats_on "$1" | grep -o '"events_total":[0-9]*' | cut -d: -f2; }

# --- scenario 1: TLS handshake + round trip + startup banner
log "scenario 1: engine TLS + sensor -tls -ca (matching trust)"
start_engine "127.0.0.1:$PORT" "$API" "$WORK/s1.log" \
    -ingest-cert "$WORK/cert.pem" -ingest-key "$WORK/key.pem"
wait_api_on "$API" || bail_with_log "engine API did not come up (binary stale? TLS cert rejected?)" "$WORK/s1.log"
grep -q "ingest TLS: ENABLED" "$WORK/s1.log" \
  || fail "scenario 1: startup banner lacks 'ingest TLS: ENABLED' (see $WORK/s1.log)"
timeout 10 "$DEVSENSOR" -addr "127.0.0.1:$PORT" -tls -ca "$WORK/cert.pem" \
    -interval 100ms >"$WORK/s1.sensor.log" 2>&1
RC=$?
[ $RC -eq 0 ] || [ $RC -eq 124 ] || fail "scenario 1: devsensor failed over TLS (exit $RC, see $WORK/s1.sensor.log)"
sleep 1
TOTAL=$(events_of "$API")
[ "${TOTAL:-0}" -gt 0 ] || fail "scenario 1: events_total=$TOTAL over TLS, expected > 0"
log "  events_total=$TOTAL (TLS round trip ok)"

# --- scenario 2: a PLAIN sensor against the TLS port must fail visibly
log "scenario 2: plain sensor against the TLS port"
BEFORE=$TOTAL
timeout 15 "$DEVSENSOR" -addr "127.0.0.1:$PORT" -interval 20ms \
    >"$WORK/s2.sensor.log" 2>&1
RC=$?
[ $RC -ne 0 ] || fail "scenario 2: plain devsensor exited 0 against a TLS port"
sleep 1
AFTER=$(events_of "$API")
[ "$AFTER" -eq "$BEFORE" ] || fail "scenario 2: events_total moved ($BEFORE -> $AFTER): clear-text bytes were ingested!"
log "  sensor_exit=$RC events_total=$AFTER (unchanged)"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null

# --- scenario 3: sensor with the WRONG CA must be rejected at the handshake
log "scenario 3: sensor with an unrelated CA"
start_engine "127.0.0.1:$((PORT+10))" "$((API+10))" "$WORK/s3.log" \
    -ingest-cert "$WORK/cert.pem" -ingest-key "$WORK/key.pem"
wait_api_on "$((API+10))" || bail_with_log "scenario 3: TLS engine did not come up" "$WORK/s3.log"
timeout 15 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+10))" -tls -ca "$WORK/other-ca.pem" \
    >"$WORK/s3.sensor.log" 2>&1
RC=$?
[ $RC -ne 0 ] || fail "scenario 3: devsensor with the WRONG CA exited 0"
sleep 1
AFTER=$(events_of "$((API+10))")
[ "${AFTER:-0}" -eq 0 ] || fail "scenario 3: events_total=$AFTER after a wrong-CA handshake, expected 0"
log "  sensor_exit=$RC events_total=$AFTER"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null

# --- scenario 4: TLS composes with the shared-token AUTH handshake
log "scenario 4: TLS + token (encryption AND authentication)"
TOKEN="tls-smoke-$$"
start_engine "127.0.0.1:$((PORT+20))" "$((API+20))" "$WORK/s4.log" \
    -ingest-cert "$WORK/cert.pem" -ingest-key "$WORK/key.pem" -token "$TOKEN"
wait_api_on "$((API+20))" || bail_with_log "scenario 4: TLS+token engine did not come up" "$WORK/s4.log"
timeout 10 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+20))" -tls -ca "$WORK/cert.pem" \
    -token "$TOKEN" -interval 100ms >"$WORK/s4.sensor.log" 2>&1
RC=$?
[ $RC -eq 0 ] || [ $RC -eq 124 ] || fail "scenario 4: devsensor failed with TLS+token (exit $RC, see $WORK/s4.sensor.log)"
grep -q "ingest auth accepted" "$WORK/s4.sensor.log" \
  || fail "scenario 4: sensor log lacks the AUTH acceptance over TLS (see $WORK/s4.sensor.log)"
sleep 1
T4=$(events_of "$((API+20))")
[ "${T4:-0}" -gt 0 ] || fail "scenario 4: events_total=$T4 with TLS+token, expected > 0"
# an intruder with the WRONG token still fails over the encrypted channel
timeout 15 "$DEVSENSOR" -addr "127.0.0.1:$((PORT+20))" -tls -ca "$WORK/cert.pem" \
    -token "INTRUDER-$$" >"$WORK/s4.intruder.log" 2>&1
RC=$?
[ $RC -ne 0 ] || fail "scenario 4: intruder token ACCEPTED over TLS"
log "  events_total=$T4 intruder_rejected=yes"
kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null

# --- scenario 5: half-set flags (-ingest-cert without -ingest-key) refuse to start
log "scenario 5: only -ingest-cert -> fail-loud before the bind"
"$ENGINE" -addr "127.0.0.1:$((PORT+30))" -api "127.0.0.1:$((API+30))" \
    -rules "$ROOT/rules" -ingest-cert "$WORK/cert.pem" \
    >"$WORK/s5.log" 2>&1
RC=$?
[ $RC -ne 0 ] || fail "scenario 5: engine started with only -ingest-cert (expected refusal)"
grep -q "requires -ingest-key" "$WORK/s5.log" \
  || fail "scenario 5: refusal message lacks the -ingest-key hint (see $WORK/s5.log)"
port_busy "$((PORT+30))" \
  && fail "scenario 5: something still listens on $((PORT+30)) — the bind must not happen on a half-set TLS config"
log "  refusal_exit=$RC message=ok bind=never"

# --- scenario 6: a missing cert file names the problem at startup
log "scenario 6: missing cert file -> fail-loud with the path"
"$ENGINE" -addr "127.0.0.1:$((PORT+40))" -api "127.0.0.1:$((API+40))" \
    -rules "$ROOT/rules" -ingest-cert "$WORK/does-not-exist.pem" -ingest-key "$WORK/key.pem" \
    >"$WORK/s6.log" 2>&1
RC=$?
[ $RC -ne 0 ] || fail "scenario 6: engine started with a missing cert file"
grep -q "does-not-exist.pem" "$WORK/s6.log" \
  || fail "scenario 6: startup error does not name the missing file (see $WORK/s6.log)"
log "  refusal_exit=$RC path_named=ok"

if [ $FAILED -eq 0 ]; then
  log "ALL 6 SCENARIOS OK"
else
  log "FAILURES DETECTED (see lines above)"
fi
exit $FAILED

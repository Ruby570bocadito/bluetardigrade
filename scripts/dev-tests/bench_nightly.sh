#!/usr/bin/env bash
# Nightly pipeline bench (Director decision 6.2 — ADVISORY, never a gate).
#
# Runs the REAL pipeline end to end over loopback with the documented
# baseline parameters: a freshly built engine, then cmd/bench streams
# 2000 events at a 1000 ev/s cap and measures every alert on the SSE
# stream (ingest parse -> rules -> alert -> broadcast -> SSE hop).
# Same parameters as the recorded local baseline (p99 319-434 µs,
# README "Measured performance", commit b69053a era hardware).
#
# Exit semantics (the advisory contract of decision 6.2):
#   - pipeline COMPLETENESS failure (bench exits non-zero: alerts lost,
#     warmup delivery broken, engine unreachable) -> exit 1. Losing
#     alerts is a functional defect, not a perf one: the nightly run
#     goes red and deserves the acta.
#   - performance is ADVISORY: p99 at or above the README phase-1
#     contract (< 10 ms) prints a ::warning:: annotation (visible on
#     the run) and an advisory verdict row in the step summary, but the
#     job stays green — a perf regression informs the next acta, it
#     does not revert a landing.
#
# Locally: bash scripts/dev-tests/bench_nightly.sh   (ports 7777/7778 free)
# In CI:   .github/workflows/bench-nightly.yml runs exactly this script.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

N=2000
RATE=1000
# README phase-1 contract, in microseconds: p99 < 10 ms.
CONTRACT_US=10000

TMP="$(mktemp -d)"
trap 'kill "${ENGINE_PID:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

echo "[bench-nightly] building engine and bench harness..."
go build -o "$TMP/engine" ./cmd/engine
go build -o "$TMP/bench" ./cmd/bench

echo "[bench-nightly] starting engine (loopback defaults, pidfile)..."
"$TMP/engine" run -pidfile "$TMP/engine.pid" >"$TMP/engine.log" 2>&1 &
ENGINE_PID=$!

ready=""
for _ in $(seq 1 60); do
    if curl -sf http://127.0.0.1:7778/api/health >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 0.25
done
if [ -z "$ready" ]; then
    echo "[bench-nightly] engine never became healthy; last log lines:" >&2
    tail -20 "$TMP/engine.log" >&2
    exit 1
fi

echo "[bench-nightly] running bench (-n $N -rate $RATE)..."
set +e
"$TMP/bench" -n "$N" -rate "$RATE" 2>&1 | tee "$TMP/bench-output.txt"
BENCH_RC=${PIPESTATUS[0]}
set -e

echo "[bench-nightly] stopping engine (SIGTERM, wait for clean shutdown)..."
if [ -f "$TMP/engine.pid" ]; then
    kill -TERM "$(cat "$TMP/engine.pid")" 2>/dev/null || true
fi
for _ in $(seq 1 40); do
    kill -0 "$ENGINE_PID" 2>/dev/null || break
    sleep 0.25
done
kill -9 "$ENGINE_PID" 2>/dev/null || true

# ---- parse the bench report -------------------------------------------
p99_raw="$(sed -n 's/^latency p99[ :]*//p' "$TMP/bench-output.txt" | head -1)"
samples="$(sed -n 's/^latency samples[ :]*//p' "$TMP/bench-output.txt" | head -1)"
result="$(sed -n 's/^RESULT[ :]*//p' "$TMP/bench-output.txt" | head -1)"

# Go durations ("434µs", "1.234ms", "2s", "800ns") -> integer microseconds.
# The µs PAIR is normalized to ASCII "us" first (replacing the bare µ
# would yield "434uss" and break the suffix logic) so the case patterns
# never depend on locale byte handling.
to_us() {
    v="$(printf '%s' "$1" | sed 's/µs/us/')"
    case "$v" in
        *ns) awk "BEGIN{printf \"%d\", int(${v%ns}/1000)}" ;;
        *us) awk "BEGIN{printf \"%d\", ${v%us}}" ;;
        *ms) awk "BEGIN{printf \"%d\", ${v%ms}*1000}" ;;
        *s)  awk "BEGIN{printf \"%d\", ${v%s}*1000000}" ;;
        *)   printf '' ;;
    esac
}
p99_us=""
if [ -n "$p99_raw" ]; then
    p99_us="$(to_us "$p99_raw")"
fi

# ---- summary (step summary on CI, stdout locally) ----------------------
SUMMARY="$TMP/summary.md"
{
    echo "## Nightly bench (decision 6.2, advisory)"
    echo
    echo "| metric | value |"
    echo "|---|---|"
    echo "| events | $N @ ${RATE} ev/s |"
    echo "| latency samples | ${samples:-0} |"
    echo "| p99 | ${p99_raw:-n/a} |"
    echo "| completeness | ${result:-missing} |"
    echo "| local baseline | p99 319-434 µs (same parameters, loopback) |"
    echo "| README contract | p99 < 10 ms |"
} > "$SUMMARY"

verdict="OK (within contract)"
if [ -z "$p99_us" ]; then
    verdict="NO SAMPLES"
elif [ "$p99_us" -ge "$CONTRACT_US" ]; then
    verdict="ADVISORY REGRESSION (>= 10 ms)"
fi
echo "| verdict | $verdict |" >> "$SUMMARY"

echo
cat "$SUMMARY"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"
fi

# Advisory annotation: visible on the run, job stays green.
if [ -n "$p99_us" ] && [ "$p99_us" -ge "$CONTRACT_US" ]; then
    echo "::warning::nightly bench p99 ${p99_raw} exceeds the README phase-1 contract (< 10 ms). Advisory per decision 6.2 — raise it in the next acta, do not revert the landing."
fi

# Completeness is the functional half: bench exits non-zero when the
# pipeline loses alerts (produced != sent) or cannot run at all.
if [ "$BENCH_RC" -ne 0 ]; then
    echo "[bench-nightly] FAIL: pipeline completeness (bench exit $BENCH_RC)" >&2
    tail -30 "$TMP/bench-output.txt" >&2 || true
    exit 1
fi
if [ -z "$p99_us" ]; then
    echo "::warning::bench completed but produced no latency samples (SSE fan-out misses?) — inspect the report above."
fi

echo "[bench-nightly] OK (advisory bench recorded)"

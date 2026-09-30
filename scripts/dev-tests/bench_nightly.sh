#!/usr/bin/env bash
# Nightly pipeline bench (Director decision 6.2 — ADVISORY, never a gate).
#
# Runs the REAL pipeline end to end over loopback TWICE with the
# documented baseline parameters: a freshly built engine, then cmd/bench
# streams 2000 events at a 1000 ev/s cap and measures every alert on the
# SSE stream (ingest parse -> rules -> alert -> broadcast -> SSE hop).
#
#   - Pass 1 "rings":   default engine, no persistence. Same parameters
#     as the recorded local baseline (p99 319-434 µs, README "Measured
#     performance", commit b69053a era hardware) — the continuity row.
#   - Pass 2 "sqlite":  same bench with -store on a fresh SQLite file
#     (the debt of acta 08h40, "bench comparativo con/sin -store").
#     Every event and alert pays a write-through INSERT on the hot path,
#     so the delta quantifies what the opt-in persistence costs; the
#     store itself keeps its functional coverage in store_smoke.sh and
#     e2e_store_sequences.sh.
#
# Exit semantics (the advisory contract of decision 6.2):
#   - pipeline COMPLETENESS failure (bench exits non-zero: alerts lost,
#     warmup delivery broken, engine unreachable) -> exit 1, on EITHER
#     pass. Losing alerts is a functional defect, not a perf one: the
#     nightly run goes red and deserves the acta.
#   - performance is ADVISORY: p99 at or above the README phase-1
#     contract (< 10 ms) prints a ::warning:: annotation (visible on
#     the run) and an advisory verdict row in the step summary, but the
#     job stays green — a perf regression informs the next acta, it
#     does not revert a landing. Each pass is judged independently;
#     the delta row is informational and gates nothing.
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
# kill 0 signals the WHOLE process group (this script's siblings and,
# without job control, its ancestors' group too). ENGINE_PID is only
# ever set after the engine starts, so guard on presence instead of
# defaulting to 0: a build failure must exit cleanly, not signal.
trap '[ -n "${ENGINE_PID:-}" ] && { kill "$ENGINE_PID" 2>/dev/null || true; }; rm -rf "$TMP"' EXIT

# Pre-flight: the health wait below would happily answer if a PREVIOUS
# engine (a dev stack left running, yesterday's binary) already owns
# 7778 — the bench would then measure the WRONG engine and attribute
# its numbers to this build. The port must be silent before we start.
if curl -sf http://127.0.0.1:7778/api/health >/dev/null 2>&1; then
    echo "[bench-nightly] FAIL: port 7778 already serving /api/health — another engine is listening. Stop the running stack first: measuring the wrong binary would fake the numbers." >&2
    exit 1
fi

echo "[bench-nightly] building engine and bench harness..."
go build -o "$TMP/engine" ./cmd/engine
go build -o "$TMP/bench" ./cmd/bench

# run_pass <label> [extra engine flags...]
# Starts the engine with the extra flags, streams the bench, stops the
# engine cleanly, and fills the R_* globals with this pass's report.
run_pass() {
    local label="$1"; shift

    # Same attribution guard the script-head pre-flight runs before
    # pass 1, repeated before EVERY pass: the pass-to-pass gap (stop
    # of the previous engine, start of this one) is a second window
    # where a leftover engine could own the port and fake this
    # pass's numbers (agent-04 round over 1a13f15).
    if curl -sf http://127.0.0.1:7778/api/health >/dev/null 2>&1; then
        echo "[bench-nightly] FAIL [$label]: port 7778 already serving /api/health before this pass started — a previous engine is still listening; measuring it would fake this pass." >&2
        exit 1
    fi

    echo "[bench-nightly] starting engine [$label] (loopback defaults, pidfile)..."
    "$TMP/engine" run -pidfile "$TMP/engine.pid" "$@" >"$TMP/engine-$label.log" 2>&1 &
    ENGINE_PID=$!

    local ready=""
    for _ in $(seq 1 60); do
        if curl -sf http://127.0.0.1:7778/api/health >/dev/null 2>&1; then
            ready=1
            break
        fi
        sleep 0.25
    done
    if [ -z "$ready" ]; then
        echo "[bench-nightly] engine [$label] never became healthy; last log lines:" >&2
        tail -20 "$TMP/engine-$label.log" >&2
        exit 1
    fi
    # Ownership proof: a health answer is only THIS pass's number
    # when THIS pass's engine is the process alive to serve it. If
    # ours died (bind conflict with a leftover engine that survived
    # the previous pass), whatever answered is not ours — on the
    # sqlite pass it would measure an engine WITHOUT -store and
    # fabricate a negative overhead delta. Same anti re-bind pattern
    # e2e_beacon/e2e_risk_a1 run via their log check; here liveness
    # of the known PID is the stronger, log-free equivalent.
    #
    # Live-fire mapped semantics (agent-04 round over 1491f88): a
    # foreign stack on BOTH ports makes OUR engine exit 0 cleanly
    # during the health wait ("another engine instance is already
    # running", the ingest.New branch of run.go) — the foreign answers
    # health and THIS check fires. A foreign stack on the API port
    # ONLY leaves our engine alive but API-less ("api disabled",
    # hub=nil): liveness passes and the warmup SSE delivery failure
    # turns the run red instead. Defense in depth: no path measures a
    # foreign engine.
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
        echo "[bench-nightly] FAIL [$label]: /api/health answered but THIS pass's engine process is gone (bind conflict with a leftover engine?) — refusing to measure a foreign engine. Last log lines:" >&2
        tail -20 "$TMP/engine-$label.log" >&2
        exit 1
    fi

    echo "[bench-nightly] running bench [$label] (-n $N -rate $RATE)..."
    set +e
    "$TMP/bench" -n "$N" -rate "$RATE" 2>&1 | tee "$TMP/bench-output-$label.txt"
    R_RC=${PIPESTATUS[0]}
    set -e

    echo "[bench-nightly] stopping engine [$label] (SIGTERM, wait for clean shutdown)..."
    if [ -f "$TMP/engine.pid" ]; then
        kill -TERM "$(cat "$TMP/engine.pid")" 2>/dev/null || true
    fi
    for _ in $(seq 1 40); do
        kill -0 "$ENGINE_PID" 2>/dev/null || break
        sleep 0.25
    done
    kill -9 "$ENGINE_PID" 2>/dev/null || true
    ENGINE_PID=""

    # ---- parse the pass report ----------------------------------------
    R_P99_RAW="$(sed -n 's/^latency p99[ :]*//p' "$TMP/bench-output-$label.txt" | head -1)"
    R_SAMPLES="$(sed -n 's/^latency samples[ :]*//p' "$TMP/bench-output-$label.txt" | head -1)"
    R_RESULT="$(sed -n 's/^RESULT[ :]*//p' "$TMP/bench-output-$label.txt" | head -1)"
    R_P99_US=""
    [ -n "$R_P99_RAW" ] && R_P99_US="$(to_us "$R_P99_RAW")"
}

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

# Runner-class probe (agent-04 round over 1491f88, serving acta 13h05):
# the SAME two-pass bench measured sqlite p99 ~0.9 ms on fsync-fast
# containers and 15.8 ms on a stalls-class one — the persistence tail
# is dominated by the medium, not the build, so the nightly records
# WHICH class of medium produced its numbers (dato, no veredicto,
# extended to the environment row). Probed on the same $TMP filesystem
# the sqlite pass wrote to, AFTER both passes: it can neither perturb
# the measurement nor be confounded with it. Failure degrades to n/a —
# an advisory row must never be able to redden the run. The 5 ms
# boundary sits an order of magnitude above the fast-fsync tail
# (~0.9 ms) and far below the observed stalls class (15.8 ms).
fsync_class() {
    FSYNC_ROW="n/a (probe failed)"
    local samples med class
    samples="$(
        for _ in 1 2 3 4 5; do
            t0="$(date +%s%N)"
            dd if=/dev/zero of="$TMP/fsync-probe.bin" bs=4096 count=1 \
                conv=fsync oflag=dsync status=none || break
            t1="$(date +%s%N)"
            echo $((t1 - t0))
        done | sort -n | sed -n '3p'
    )" || true
    [ -n "$samples" ] || return 0
    med="$(awk "BEGIN{printf \"%.2f\", $samples/1000000}")"
    if [ "$(awk "BEGIN{print ($samples < 5000000) ? 1 : 0}")" = "1" ]; then
        class="fast-fsync"
    else
        class="sync-stalls"
    fi
    FSYNC_ROW="$med ms (median of 5, $class)"
}

run_pass rings
RINGS_P99_RAW="$R_P99_RAW"; RINGS_SAMPLES="$R_SAMPLES"; RINGS_RESULT="$R_RESULT"
RINGS_P99_US="$R_P99_US";   RINGS_RC="$R_RC"

run_pass sqlite -store "$TMP/bench-store.db"
SQL_P99_RAW="$R_P99_RAW"; SQL_SAMPLES="$R_SAMPLES"; SQL_RESULT="$R_RESULT"
SQL_P99_US="$R_P99_US";   SQL_RC="$R_RC"

echo "[bench-nightly] probing runner class (fsync 4k dsync on the sqlite pass medium)..."
FSYNC_ROW="n/a"
fsync_class

# Delta sqlite - rings, in µs and %, informational only. With either
# p99 unparseable there is no delta to report (the no-samples gate
# below already turns the run red for the affected pass).
DELTA_US=""; DELTA_PCT=""
if [ -n "$RINGS_P99_US" ] && [ -n "$SQL_P99_US" ]; then
    DELTA_US="$(awk "BEGIN{printf \"%+d\", $SQL_P99_US - $RINGS_P99_US}")"
    if [ "$RINGS_P99_US" -gt 0 ]; then
        DELTA_PCT="$(awk "BEGIN{printf \"%+.1f%%\", ($SQL_P99_US - $RINGS_P99_US) * 100.0 / $RINGS_P99_US}")"
    fi
fi

verdict_for() { # verdict_for <p99_us>
    if [ -z "$1" ]; then
        echo "NO SAMPLES"
    elif [ "$1" -ge "$CONTRACT_US" ]; then
        echo "ADVISORY REGRESSION (>= 10 ms)"
    else
        echo "OK (within contract)"
    fi
}

# ---- summary (step summary on CI, stdout locally) ----------------------
SUMMARY="$TMP/summary.md"
{
    echo "## Nightly bench (decision 6.2, advisory)"
    echo
    echo "| metric | rings (baseline) | sqlite (-store) |"
    echo "|---|---|---|"
    echo "| events | $N @ ${RATE} ev/s | $N @ ${RATE} ev/s |"
    echo "| latency samples | ${RINGS_SAMPLES:-0} | ${SQL_SAMPLES:-0} |"
    echo "| p99 | ${RINGS_P99_RAW:-n/a} | ${SQL_P99_RAW:-n/a} |"
    echo "| verdict | $(verdict_for "$RINGS_P99_US") | $(verdict_for "$SQL_P99_US") |"
    echo "| completeness | ${RINGS_RESULT:-missing} | ${SQL_RESULT:-missing} |"
    echo "| store overhead | — | delta p99 ${DELTA_US:-n/a} µs (${DELTA_PCT:-n/a}) |"
    echo
    echo "| reference | value |"
    echo "|---|---|"
    echo "| local baseline | p99 319-434 µs (rings, same parameters, loopback) |"
    echo "| README contract | p99 < 10 ms (each pass, independently) |"
    echo "| runner | ${RUNNER_NAME:-$(uname -n)} ($(uname -sr)) |"
    echo "| fsync 4k dsync (sqlite pass medium) | $FSYNC_ROW |"
} > "$SUMMARY"

echo
cat "$SUMMARY"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"
fi

# Advisory annotations: visible on the run, job stays green. Each pass
# is annotated with its label so the warning names the configuration
# that regressed, not just the fact.
for pair in "rings:$RINGS_P99_US:$RINGS_P99_RAW" "sqlite:$SQL_P99_US:$SQL_P99_RAW"; do
    lbl="${pair%%:*}"; rest="${pair#*:}"
    us="${rest%%:*}"; raw="${rest#*:}"
    if [ -n "$us" ] && [ "$us" -ge "$CONTRACT_US" ]; then
        echo "::warning::nightly bench [$lbl] p99 ${raw} exceeds the README phase-1 contract (< 10 ms). Advisory per decision 6.2 — raise it in the next acta, do not revert the landing."
    fi
done

# Completeness is the functional half: bench exits non-zero when the
# pipeline loses alerts (produced != sent) or cannot run at all — on
# EITHER pass.
if [ "$RINGS_RC" -ne 0 ]; then
    echo "[bench-nightly] FAIL: pipeline completeness [rings] (bench exit $RINGS_RC)" >&2
    tail -30 "$TMP/bench-output-rings.txt" >&2 || true
    exit 1
fi
if [ "$SQL_RC" -ne 0 ]; then
    echo "[bench-nightly] FAIL: pipeline completeness [sqlite] (bench exit $SQL_RC)" >&2
    tail -30 "$TMP/bench-output-sqlite.txt" >&2 || true
    exit 1
fi
for pair in "rings:$RINGS_P99_US" "sqlite:$SQL_P99_US"; do
    lbl="${pair%%:*}"; us="${pair#*:}"
    if [ -z "$us" ]; then
        # A bench that exits 0 but yields no parseable latency is an
        # instrumentation/completeness defect of the measurement itself
        # (report format drift, broken SSE fan-out): numbers silently
        # disappearing must turn the run red, like lost alerts do —
        # never a green run with a "recorded" verdict it did not measure.
        echo "[bench-nightly] FAIL: bench [$lbl] exited 0 but no latency samples were parsed from the report (format drift? SSE fan-out?) — report above." >&2
        exit 1
    fi
done

echo "[bench-nightly] OK (advisory bench recorded, both passes)"

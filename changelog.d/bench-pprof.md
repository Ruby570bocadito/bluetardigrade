The nightly bench now captures pprof profiles of the hot path. The
engine gained an opt-in `-pprof-dir` flag (a CPU profile spanning the
whole run plus heap and goroutine snapshots at clean shutdown; off by
default and unchanged without it), and `bench_nightly.sh` profiles
both passes — rings and sqlite —, verifies the files are there and
uploads them as the `bench-pprof` workflow artifact (14-day retention;
locally, `BENCH_PPROF_DIR` keeps a copy). A profiled run that produces
no profiles fails the nightly like a lost-alert run does.

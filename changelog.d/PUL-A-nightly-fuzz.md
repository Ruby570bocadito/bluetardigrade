### Nightly fuzzing (Pulimiento A, round 6)

- `bench-nightly.yml` gains an advisory `fuzz` job next to the
  existing pipeline bench: one step per Go fuzz target, `-fuzztime
  5m` each, `-run '^$'` so the fuzz round owns the whole time
  budget. It covers every fuzz target that lives on `main` today
  (`FuzzFieldMapParity` in `pkg/model`), and new targets are one
  line each — the ones from the SEC-A fuzzing round (mail parser,
  reputation indicators, API query filters) land there as their
  branches merge.
- Like the bench, the workflow never runs on push or pull_request,
  so a fuzzing crash informs the next acta but cannot gate a
  landing; a failing input is preserved in the package's
  `testdata/fuzz/` corpus for the fixing lane.
- Verified locally with the same invocation (`-fuzztime 10s`):
  24k execs, PASS.

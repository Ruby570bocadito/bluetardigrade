### Correlator split by responsibility (Pulimiento A, round 7)

- `internal/correlate/correlate.go` (790 lines, the largest engine
  file not owned by an active lane plan) is divided into five files
  within the same package, one responsibility each: `sequence.go`
  (YAML model, load-time hardening caps, loader and compiler),
  `state.go` (in-flight chain state, its key and the reclamation
  policy), `observe.go` (the per-rule-hit hot path, account scoping
  and alert building), `inspect.go` (the read-only views the API
  serves) and `correlate.go` (the Manager, its lifecycle and wiring).
- A pure move, no behavior change: every declaration, comment and
  signature is byte-identical; the only addition is a file-layout
  paragraph in the package doc. Verified mechanically — `go doc -all`
  before and after differs by exactly that paragraph — plus the full
  battery: gofmt, build, vet, both staticcheck passes (2026.2.1, the
  version CI installs) and `go test -race -count=1 ./...` green.
- The other POL-1 targets stay queued on purpose: `internal/api` is
  hot (the implementation lane's SIM-4 follow-ups) and
  `sensor/src/collector.rs` needs a Rust toolchain this environment
  does not have.

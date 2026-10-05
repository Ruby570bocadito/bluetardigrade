### Contribution process (Pulimiento A, round 7)

- New `CONTRIBUTING.md`: development setup with the exact toolchain
  versions CI installs (Go 1.26+, staticcheck 2026.2.1, bun, rustup,
  python3+PyYAML), the `make ci` gate, a repository map, PR
  expectations (behavior changes carry tests, API changes update
  OpenAPI in the same PR, detection content documents its inert
  evidence, docs travel with code, every PR leaves a `changelog.d/`
  fragment) and the project's ground rules stated as merge
  blockers: observe-only console/engine, read-only AD, synthetic
  telemetry for validation, no automatic downloads, personal data
  for security only.
- New GitHub templates: bug report and feature request issue forms
  (blank issues disabled, with a contact link routing vulnerabilities
  to the private Security Advisory channel instead of public issues)
  and a pull-request template with the documentation/content
  checklist and an explicit "do not claim unexecuted checks" rule.
- English throughout, matching the contributor-facing docs
  (README, OPERATIONS, ARCHITECTURE); SECURITY.md stays the operator
  -facing Spanish policy it already is and keeps owning disclosure.

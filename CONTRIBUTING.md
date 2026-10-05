# Contributing to bluetardigrade

Thanks for your interest in the project. bluetardigrade is a defensive
SOC tool: a Go detection engine, a Rust ETW sensor for Windows, a Next.js
console and the PowerShell installer around them. This document covers
how to set up a development environment, the project's ground rules, and
what a pull request is expected to carry. Security vulnerabilities are
**not** reported through issues or PRs — see
[SECURITY.md](SECURITY.md) for the private coordinated-disclosure
channel.

## Ground rules (read before writing code)

These are product limits, not style preferences — a change that crosses
them will not be merged regardless of quality:

- **The console and the engine observe.** Neither executes commands on,
  nor pushes anything to, monitored hosts or the domain. Response
  actions are a product decision gated on the maintainer's explicit
  approval; do not extend `internal/respond` on your own.
- **Active Directory is read-only** (LDAPS with an unprivileged
  account). Nothing creates, deletes or modifies domain objects.
- **Detection validation uses synthetic, inert telemetry** — JSON
  events under `scenarios/`, never real attack tooling, exploits or
  network scans. Detection PRs carry their evidence in that currency.
- **Nothing in the product downloads automatically from the
  internet.** Threat intel is file-based (local `intel/` directory).
- **Personal data is for security only**, with configurable retention
  and role-gated access. No employee-productivity metrics.

## Development setup

Prerequisites:

- **Go 1.26+** (`go version` must match the `go` directive in `go.mod`)
- **staticcheck** — the exact version CI installs:
  `go install honnef.co/go/tools/cmd/staticcheck@2026.2.1`
- **Python 3** with PyYAML (the OpenAPI and rule-inventory guards)
- **bun** (console and hub), **Node 20+** (console DOM/browser checks)
- **Rust via rustup** — only needed for the sensor (`sensor/`)
- **PowerShell 7 (pwsh)** — optional locally; CI always runs the
  PowerShell syntax guard

Then:

```sh
make build          # engine + collector binaries
make test           # go test -count=1 ./...
make ci             # the same suite CI runs on every push (see below)
```

`make ci` is the gate: gofmt, build, vet, the two staticcheck passes,
`go test -race -count=1 ./...`, the file-forensics and SOC-pipeline
smokes, the Windows cross-builds, the OpenAPI guard + self-test, the
rule-inventory guard, the console battery (bun test, tsc, build, DOM
and browser checks) and a cargo check of the sensor. Run it before
pushing; CI runs it anyway.

For the console alone: `cd web/console && bun install --frozen-lockfile
&& bun test && bunx tsc --noEmit && bun run build`. For the sensor:
`cargo test --locked --manifest-path sensor/Cargo.toml` and
`cargo clippy --locked --all-targets --manifest-path sensor/Cargo.toml
-- -D warnings`.

Test against **laboratory targets only**: loopback ports (the repo's
own smokes use 17777/17778), scratch directories, inert fixtures.
Never point a build at a production engine or a real directory.

## How the repo is organized

| Path | What lives there |
|---|---|
| `cmd/engine`, `cmd/collector` | Engine and SOC-collector entrypoints |
| `internal/` | Engine packages (rules, correlate, api, store, ingest, ...) |
| `pkg/` | Shared libraries (event model) |
| `rules/`, `sequences/`, `beacons.yaml`, `thresholds.yaml`, `intel/` | Detection content (YAML, reviewed like code) |
| `sensor/` | Rust ETW sensor for Windows |
| `web/console`, `web/console-service` | Next.js console and its proxy service |
| `scripts/`, `install.ps1` | Windows installer and dev-test guards |
| `docs/` | Operator and architecture documentation |

## Pull requests

1. Branch from `main` with a descriptive name (`feat/...`, `fix/...`).
2. Keep the change scoped: a PR that mixes a functional change with
   unrelated reformatting will be asked to split.
3. **Behavior changes carry tests.** The existing suite must pass
   untouched; new behavior adds its own coverage.
4. **API changes update `docs/api/openapi.yaml` in the same PR** —
   `python3 scripts/dev-tests/check_openapi.py` enforces spec/code
   parity and CI runs it.
5. **Detection content changes (rules, sequences, beacon profiles,
   thresholds) document their evidence**: the inert scenarios or
   fixtures that show the detection firing and the benign cases that
   must stay quiet. See [docs/DETECCION-Y-EVIDENCIA.md]
   (docs/DETECCION-Y-EVIDENCIA.md).
6. Every PR leaves a changelog fragment in `changelog.d/`
   (`<area>-<topic>.md`, one paragraph, English, Keep-a-Changelog
   style) — the release notes are assembled from those fragments.
7. Docs travel with code: if your change adds a flag, an endpoint or a
   behavior an operator can observe, the corresponding section of
   [docs/OPERATIONS.md](docs/OPERATIONS.md) changes in the same PR.
8. User-facing console text is Spanish (the console's language); code,
   comments and technical documentation are English.

**Commit style:** short imperative subject (`engine: bound the notify
queue`), body only when the why is not obvious. Keep authorship
metadata honest and human.

**CI must be green on its own**: if a check needs a runner capability
your machine lacks, say so in the PR description rather than skipping
it silently — never claim a check passed without running it.

## Issue reporting

- **Functional bugs** → GitHub issue, with the exact commit
  (`git rev-parse HEAD`), platform, minimal reproduction and expected
  vs actual behavior.
- **Vulnerabilities** → never in issues. Private GitHub Security
  Advisory per [SECURITY.md](SECURITY.md), which also defines the
  supported versions and the response SLA.
- **Feature ideas** → GitHub issue with the operational problem first
  and the proposed behavior second; features that violate the ground
  rules above will be closed, not discussed.

## License

By contributing you agree that your contributions are licensed under
the [Apache-2.0 license](LICENSE) that covers the project.

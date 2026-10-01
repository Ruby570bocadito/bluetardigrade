# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
while the project is pre-1.0, minor versions may carry breaking changes to the
event schema or the HTTP API (the schema contract itself is documented in the
OpenAPI spec and guarded in CI). The version reported by `engine version` is
injected at link time from the release tag — see `.github/workflows/release.yml`
and the `make dist` target.

## [Unreleased]

### Added — command palette and browser regressions

- Searchable console commands on desktop and mobile; Ctrl+K / Meta+K,
  arrow selection, keyboard help and shared engine refresh.
- Chromium regression checks of the production console with isolated
  REST/SSE fixtures, keyboard/focus coverage and desktop/mobile captures.

### Fixed — keyboard and modal focus

- Native modal dialogs keep background controls inert, restore focus,
  support Escape/backdrop close and release page scroll on cleanup.
- Navigation ignores consumed events, repeats, composition, editable
  ancestors and composite controls; changing focus clears the g prefix.
- Choosing the current view no longer creates duplicate history entries.
- The animated view title keeps identical server/client markup; reduced
  motion is applied in CSS without a React hydration error.

### Added — historical alert investigations

- Live/history switch in the alert queue, lifecycle filters and shareable
  source/state lenses; 25-row pages with previous, next and refresh.
- Read-only `GET /api/alerts/search` with SQLite/memory source metadata,
  pinned insertion-sequence cursors, bounded lifecycle scans and cancellation.
- Historical triage updates through both SSE and successful POST responses;
  superseded queries are canceled and older engines show a capability error.

### Added — alert handoff

- Alert ids join the free-text search surface on both backends (ring and
  store haystack mirrors): pasting an id from a handoff link finds its
  record whether it lives in the live ring, the memory page or SQLite.
- `?view=alertas&alert=<id>` pins the queue detail panel to a row, like
  `?regla=` does for rules. If the alert already rotated out of the shown
  window, the queue says so and offers the history search instead of
  rendering a ghost panel.

### Fixed — alert investigation state

- Informational severity no longer renders as low or disappears from filters/KPIs.
- The alert list shows offline state instead of an endless loading skeleton.
- Legacy alert selection uses timestamp, event and rule identity consistently.
- Delayed lifecycle frames cannot undo newer close/reopen decisions.
- Export tooltips state the default limits and their independence from view filters.


### Added

- Interactive alert and rule workspaces with search, severity filters,
  stable historical selection, details, pause and contextual help.
- Dashboard operation summary with pending critical triage, delivery
  issues, detector saturation, refresh and live-channel status.
- Regression coverage for terminal display, request boundaries, rolling
  activity, alert replay and operation summaries; Spanish start guide.

### Fixed

- Console deep links and browser back/forward restore the requested view.
- Activity ages out during sensor inactivity; an empty sample peaks at zero.
- Offline KPIs no longer display fabricated zeroes; reconnect snapshots
  merge concurrent frames and SSE replay preserves triage decisions.
- Rules refresh with the poller; real 404s clear optional response state.
- Terminal control characters are neutralized only in human output;
  webhook banners redact credentials and structured evidence is preserved.
- IPv6 loopback proxy hosts work; invalid authorities fail closed and
  triage bodies are bounded before forwarding.
- Routed CLI commands reject ignored arguments and respect output writers.
- Sensor Makefile targets resolve their Cargo manifest from the repo root.

### Added

**Sensors and telemetry**

- The Rust ETW sensor can encrypt the engine connection: `--tls-ca <ca.pem>`
  (or `SF_INGEST_CA`) upgrades every (re)connection to TLS with the engine's
  certificate verified against the given CA bundle — pinned CA only, no
  skip-verification mode. TLS sits below the AUTH handshake, so the wire
  protocol is unchanged; the handshake phase is bounded by the same 10 s
  deadline as AUTH. Completes transit encryption end to end with the engine's
  `-ingest-cert`/`-ingest-key` listener.

## [v0.1.0] - 2026-09-30

First tagged release of the framework as it exists in the tree today. Every
capability listed below is implemented and verified (CI: Go fmt/build/vet/test
with `-race`, console tests + typecheck + build, sensor `cargo check --locked`
on two targets, OpenAPI drift guard, and a behavioral Windows smoke of the
active-response handle path with real process kills).

### Added

**Sensors and telemetry**

- Windows-first ETW sensor in Rust (Sysmon-class telemetry: process create /
  terminate, process access, file write, network connect, image load, registry
  set) plus `sf-devsensor`, a deterministic simulated-TTP scenario generator so
  the full pipeline can be exercised on any platform without ETW.

**Detection engine (Go)**

- NDJSON-over-TCP ingest with 1 MiB per-line cap, identity-field truncation
  (host/user/id/network destination), field-separator stripping at the
  boundary, and shared-token authentication with constant-time comparison and
  a zero-downtime rotation window (`-token-previous`).
- Enrichment pipeline (user domain split, image origin system/userland,
  engine uptime) that never mutates raw evidence fields.
- YAML detection rules with hot reload, Sigma rule import (`engine sigma`,
  strict mode optional), and kill-chain sequence correlation with a tracked
  state cap.
- Risk scoring per host with decay, beaconing detector over `network.connect`
  (A3) with per-key state caps, and volumetric thresholds (A2: brute force,
  mass deletion, sprays) with per-key quotas.
- Alert lifecycle (acknowledged/closed + notes) persisted across restarts,
  and operator suppressions (rule/host pairs with expiry) hot-reloaded from
  YAML.
- Active response `kill_process` under layered authorization (R1-R8): bearer
  token mandatory even on loopback, operators allowlist, protected process
  defaults, host-pinning, PID/name match, per-PID cooldown, idempotency keys,
  synchronous result, and an append-only JSONL forensic audit (one line per
  attempt, denials included, fsync per line, 64 MiB rotation ceiling,
  `resolved_name` recorded).
- SQLite persistence (opt-in) for events and alerts beyond the in-memory
  rings, with retention sweeps.

**Interfaces**

- Local HTTP API (read-only by default) with bearer-token auth, RFC 7235
  challenges, SSE streams, bulk exports, Prometheus `/metrics`, and an
  OpenAPI specification with a CI drift guard (spec <-> code).
- SIEM delivery: Elasticsearch bulk indexing (daily indices, deterministic
  per-alert `_id` so retries never duplicate) and Splunk HEC, both with
  optional API-key/token headers; plus generic webhook (optional Bearer
  token) and external notifications (Slack, Telegram, email).
- Web console (Next.js) with real-time triage, rule/sequence/suppression
  management views, read-only active-response view, and the analyst AI view;
  fed by `sf-console-service`, the realtime telemetry hub.
- Dockerfile and installer scripts (PowerShell) for engine/sensor
  deployment, including firewall opt-in.

**Engineering**

- Continuous integration covering all three build surfaces (engine, console,
  sensor), the OpenAPI guard, a `-race` engine run, and a behavioral
  Windows smoke that executes real kills against its own disposable
  processes with a bounded single retry.
- Local verification battery: `make ci`, per-surface smokes
  (`scripts/dev-tests/`), and the agent verification guide
  (`docs/agentes/GUIA-VERIFICACION.md`).

[Unreleased]: https://github.com/Ruby570bocadito/security-framework/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/Ruby570bocadito/security-framework/releases/tag/v0.1.0

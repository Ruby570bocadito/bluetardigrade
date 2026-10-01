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

### Added

- Six `file.write` alarms in `rules/windows/file-staging.yaml`: Office
  payloads, script-written DLLs, downloaded/extracted DLL candidates,
  PowerShell profiles, Office startup content and LSASS dump artifacts.
  The pack now contains 55 enabled rules; medium signals document their
  legitimate uses and require investigation rather than automatic response.
- Full forensic snapshot downloads in JSON and versioned JSONL, retaining
  the alert, metadata, raw event fields, hashes and enrichment.
- A generated full-ID rule inventory with a CI/`make ci` drift check.
  Regenerate with `python3 scripts/dev-tests/check_rule_inventory.py --write`.
- An authenticated loopback smoke validates the real ingest → alarm →
  frozen-evidence path with inert fixtures, including the capture threshold
  and read authorization; no attack commands or active response are run.

### Fixed

- YAML graph validation detects cyclic aliases, bounds expansion before
  arithmetic can overflow, and checks composed flow depth even when quoted
  closers offset the raw pre-scan. The graph walk no longer recurses.
- Partial process telemetry preserves known identity. Parent lookup checks
  TTL immediately, engine-derived keys are recomputed, and dated events from
  an older PID incarnation cannot replace/terminate a newer tracked process.
- Startup detection uses the canonical filename when optional extension
  metadata is absent or inconsistent; its ATT&CK tag is now T1547.001.
- Forensic captures exclude unrelated future-dated events, retain an observed
  triggering event when truncating, and serialize empty timelines as arrays.
  The default evidence directory is excluded from Git.
- The forensic panel retries failed queries, validates returned evidence and
  alert identity, accepts older null collections, and resets on alert change.
  DOM and Chromium checks cover retries, stale responses and real downloads.
- Installation docs now require Go 1.26; rule counts and the roadmap reflect
  the delivered artifact detections and evidence export.

## [v0.2.0] — 2026-10-01 — the bluetardigrade round

A hardening, cleanup and rebranding release: every open finding from the
full external review of v0.1.0 landed, the repository lost ~19 MB of process
artifacts, and the project is now **bluetardigrade** (renamed from
`security-framework`; GitHub redirects old URLs, Windows shims keep their
`sf-*` names for upgrade compatibility).

### Added

- **Native TLS for the HTTP API** (`-api-cert` / `-api-key`): hot-rotated on
  file mtime change through the same reloader contract the ingest listener
  has had all along (reloader promoted to the shared `internal/tlsutil`).
- **YAML alias-bomb guard** (`internal/yamlcheck`): every loader now rejects
  reference bombs (billion laughs) and deep flow nesting before a typed
  decode can expand them — one guard for all nine YAML surfaces.
- **Ingest connection cap** (512): a pre-auth connection flood can no longer
  exhaust FD/RAM; rejections are counted in the existing `rejected` counter.
- **401 brute-force throttle** per remote address (30/min window, then 429)
  and an **SSE subscriber cap** (64) on the stream route.
- **Console-service rate limiter**: 10 analyst requests per rolling minute
  per connection, on top of the existing concurrency slots — sequential
  paid calls on the operator's API key are bounded now.
- `cargo` ecosystem in dependabot (the Rust sensor finally tracked).
- New live capture set (`console-live.gif` + six views) taken from a real
  engine session feeding the production console build.

### Changed

- **Renamed to bluetardigrade**: README, website (new animated landing with
  React Bits components, blue identity, tardigrade logo), console branding,
  installer defaults (`%LOCALAPPDATA%\bluetardigrade`, repo URL), docs.
- **CI unblocked**: staticcheck pinned to 2026.2.1 (2024.1.1 did not support
  the Go 1.26 line dependabot bumps to), Go module dependencies and base
  images absorbed from the pending dependabot PRs.
- **SQLite pool of 2 connections** with per-connection pragmas in the DSN:
  history scans no longer stall the detection loop's synchronous inserts.
- **install.ps1**: sha256 verification is fail-closed (an unreachable
  checksum source aborts instead of downloading blind), `-WebhookUrl` /
  `-WebhookToken` get the same strict charset whitelist as `-IngestToken`,
  and the banner is new (figlet + colors, still pure ASCII).
- **Windows one-command install** documented in the README and the website:
  `irm .../install.ps1 | iex`.

### Fixed

- **`sf-sensor` (Sysmon) auth**: the real sensor now sends the `AUTH <token>`
  handshake and exits loudly on rejection instead of silently looping forever
  — the "connected but zero events" failure mode.
- **Reconnection continuity for `sf-sensor`**: a record-id bookmark replays
  events emitted during a cut (armed watcher + backlog drain + monotonic
  dedupe), persisted every 16 events.
- **Prompt-injection containment in the AI analyst**: telemetry is fenced in
  delimiters, truncated (4 KiB events / 1 KiB rule conditions), declared
  untrusted in the system prompt, and the operator question is labeled as
  human-origin.
- CSP + security headers on both Next.js apps; the engine proxy no longer
  follows redirects (`redirect: 'manual'`).
- Alert manager `prepare` field race (captured under the mutex), `log.Fatalf`
  removed from `internal/siem` constructors (errors returned to the caller),
  lifecycle tmp file collisions (unique temp + rename), devsensor UUID
  entropy failure (fail loud), pidfile mode 0600, webhook dispatcher no
  longer follows cross-host redirects.
- Rule `powershell-encoded` no longer false-positives on `-Encoding` (regex
  with word boundary, case-insensitive); PsExec header comment corrected to
  T1021.002; thresholds doc says 17 operators; ARCHITECTURE.md synced to
  v0.11 / 17-36-86 guard numbers.
- Docker image: writable `WORKDIR`, `HEALTHCHECK` against `/api/health`, and
  tokens documented through `SF_API_TOKEN` / `SF_INGEST_TOKEN` env.

### Removed

- **Repository slimmed by ~19 MB**: the agent round records (`docs/agentes/`,
  249 files), eleven historical architecture PDFs (v0.1–v0.10, kept in
  GitHub Releases), the process reports and gap-analysis documents, the
  skills lock manifest, and ~700 lines of dead toast/notification code
  duplicated across both Next.js apps.

### Added — the detection & forensics round (v0.2.0, same release)

- **Forensic evidence layer** (`internal/forensic`): a per-host flight
  recorder plus evidence bundles frozen at detection time — every
  `high`/`critical` alert writes an atomic JSON bundle (the alert, the
  host's 5-minute event timeline, a counted summary) under
  `<forensics>/`, disk-capped at 256 bundles with oldest-first
  eviction. Served back via `GET /api/alerts/{id}/forensics` (distinct
  200/400/401/404/500/501 states) and rendered in the console's alert
  detail as an expandable "Línea de tiempo forense" panel. `-forensic`
  / `-forensic-dir` flags; off is off.
- **Parent-process tracking** (`internal/enrich`): the enricher keeps a
  bounded pid->identity map per host (LRU hosts, ring per host, TTL
  sweep, terminate-evicts) and annotates `parent_name` /
  `parent_image`, enabling EDR-style parent/child anomaly rules.
- **Attacker-tooling pack** (`rules/windows/hacktools.yaml`, 10 rules):
  Mimikatz family (incl. Invoke-Mimikatz markers), LaZagne,
  Pwdump/QuarksPwDump, Rubeus (kerberoast/asktgt), SharpHound,
  AdFind-with-AD-filters, CrackMapExec/NetExec/Impacket/Evil-WinRM,
  Meterpreter stagers, silent AnyDesk installs, and classic
  net/nltest domain recon.
- **LOLBAS pack** (`rules/windows/lolbas.yaml`, 8 rules): mshta remote
  or inline script, rundll32 `javascript:`, InstallUtil bypass flags,
  forfiles as an interpreter launcher, **Office editors spawning
  interpreters** (the macro-phishing signature, via parent tracking),
  script interpreters running from user staging paths, PowerShell
  download cradles, and **browsers spawning interpreters** (drive-by).
- **Anti-forensics pack** (`rules/windows/anti-forensics.yaml`, 8
  rules): PowerShell Clear-EventLog, wmic shadowcopy deletion, VSS
  storage shrinking (Resize-ShadowStorage/MaxSpace with an MB budget —
  UNBOUNDED stays out on purpose: it is the benign direction),
  bcdedit recovery sabotage, fsutil USN journal deletion, ntdsutil IFM
  domain-database dumps, timestamp forgery, and targeted deletion of
  Windows forensic artifacts. These are also the highest-value incident
  markers for the forensic timeline.
- 49 rules loaded total (23 seeded + 26 new), each with positive
  and negative tests pinned in `rules_packs_test.go` (benign twins must
  stay silent: `-Encoding UTF8`, `bcdedit /enum`, `fsutil usn
  queryjournal`, `net use`, UNBOUNDED resize...).

### Added & Fixed — the interface wave (PR #4 + PR #6, first shipped in v0.2.0)

#### Added — investigation shortcuts

- Dashboard shortcuts open critical alerts that remain open, or new,
  acknowledged and closed live alerts, directly from the operation summary.
- Interactive CLI searches accept terms across multiple fields and include
  alert IDs, event IDs and event types, with case-insensitive matching.
- Browser coverage of fresh triage lenses and history restoration; DOM
  checks of dashboard actions and offline disabled states.

#### Fixed — investigation context

- Dashboard triage shortcuts clear stale alert search, severity, history
  and selected-alert lenses while retaining feed, rule and audit context.
- Whitespace-only terminal searches no longer hide all rows; all query
  terms must match, and the severity filter remains an intersection.

#### Added — command palette and browser regressions
#### Added — command palette and browser regressions

- Searchable console commands on desktop and mobile; Ctrl+K / Meta+K,
  arrow selection, keyboard help and shared engine refresh.
- Chromium regression checks of the production console with isolated
  REST/SSE fixtures, keyboard/focus coverage and desktop/mobile captures.

#### Fixed — keyboard and modal focus

- Native modal dialogs keep background controls inert, restore focus,
  support Escape/backdrop close and release page scroll on cleanup.
- Navigation ignores consumed events, repeats, composition, editable
  ancestors and composite controls; changing focus clears the g prefix.
- Choosing the current view no longer creates duplicate history entries.
- The animated view title keeps identical server/client markup; reduced
  motion is applied in CSS without a React hydration error.

#### Added — historical alert investigations

- Live/history switch in the alert queue, lifecycle filters and shareable
  source/state lenses; 25-row pages with previous, next and refresh.
- Read-only `GET /api/alerts/search` with SQLite/memory source metadata,
  pinned insertion-sequence cursors, bounded lifecycle scans and cancellation.
- Historical triage updates through both SSE and successful POST responses;
  superseded queries are canceled and older engines show a capability error.

#### Added — alert handoff

- Alert ids join the free-text search surface on both backends (ring and
  store haystack mirrors): pasting an id from a handoff link finds its
  record whether it lives in the live ring, the memory page or SQLite.
- `?view=alertas&alert=<id>` pins the queue detail panel to a row, like
  `?regla=` does for rules. If the alert already rotated out of the shown
  window, the queue says so and offers the history search instead of
  rendering a ghost panel.

#### Fixed — alert investigation state

- Informational severity no longer renders as low or disappears from filters/KPIs.
- The alert list shows offline state instead of an endless loading skeleton.
- Legacy alert selection uses timestamp, event and rule identity consistently.
- Delayed lifecycle frames cannot undo newer close/reopen decisions.
- Export tooltips state the default limits and their independence from view filters.


#### Added

- Interactive alert and rule workspaces with search, severity filters,
  stable historical selection, details, pause and contextual help.
- Dashboard operation summary with pending critical triage, delivery
  issues, detector saturation, refresh and live-channel status.
- Regression coverage for terminal display, request boundaries, rolling
  activity, alert replay and operation summaries; Spanish start guide.

#### Fixed

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

#### Added

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

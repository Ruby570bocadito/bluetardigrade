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

### Security, detection correctness and throughput review (2026-10-02)

Breaking for exposed consoles: a console allowed on non-loopback hosts
now needs `CONSOLE_ACCESS_TOKEN` (or `CONSOLE_ALLOW_UNAUTHENTICATED=1`),
and an analyst hub bound beyond loopback needs `HUB_ACCESS_TOKEN` (or
`HUB_ALLOW_UNAUTHENTICATED=1`). Loopback deployments are unchanged.

Security

- Stored evidence is append-only: an event id already stored with a
  different payload keeps the first copy (it was replaced, so one
  sensor could rewrite another host's evidence). Conflicts are counted
  (`store_id_conflicts`, `sf_store_id_conflicts_total`, console issue).
- Per-sensor ingest identities (`-ingest-identities`, `engine
  ingest-identity`): own token per sensor, bound to its hosts; events
  for other hosts are refused and counted
  (`ingest_identity_violations`); accepted events carry
  `attributes.ingest_identity`.
- Ingest: the first line is capped at 4 KiB while AUTH is pending (512
  unauthenticated connections could pin ~512 MiB); credentials are set
  before the listener starts serving (startup race).
- Console: `bun run dev/start` bind 127.0.0.1; `CONSOLE_ACCESS_TOKEN`
  gates every page, asset and API call with HTTP Basic auth. Host
  pinning alone did not stop `curl -H 'Host: localhost'` from the LAN
  reading the engine with the operator's token.
- Analyst hub: `HUB_ACCESS_TOKEN` authenticates every socket (the
  Origin allowlist only binds browsers); the console fetches it from
  the authenticated `/api/hub-token` route. The analyst analyzes the
  hub's own copy of an alert instead of the client payload.
- Active response: operators file version 2 with a credential per
  operator (`X-SF-Operator-Token`, `engine operator-credential`);
  version 1 still works with a startup warning.
- Sensor TLS trusts only the `--tls-ca` bundle (native-tls also trusted
  the system roots).
- API server: idle timeout, header cap, bounded 401 throttle map.
- Releases carry a Sigstore-signed SLSA build provenance attestation.

Detection correctness

- Kill chains: each step keeps the event time of its latest hit and the
  chain fires when max-min fits the window. A stale early hit no longer
  anchors the window (A, B, C within 2 minutes now fire a 5m chain) and
  an out-of-order event no longer stitches steps days apart. Dead
  chains are reclaimed, so a long uptime cannot fill the 8192-state
  cap and stop correlation for new hosts.
- Beaconing and thresholds run on event time (future timestamps clamped
  at +5 min): imported logs no longer fake bursts or hide beacons, and
  batching sensors no longer blur jitter. Clock steps back restart the
  affected key.

Performance

- Alert dedup expires keys through a FIFO queue: ~1.9 ms per alert with
  60k live keys before, constant now.
- `FieldMap` without the JSON round trip: 8.0 to 1.7 us per event, exact
  parity pinned by randomized and fuzz tests.
- With `-store`, drained event batches are persisted in one transaction
  before publication: ~8.3k to ~23.6k events/s on the same machine.
- Sensor: delivery moved off the ETW thread to a bounded queue with an
  optional on-disk spool (`--queue`, `--spool`, `--spool-max-mb`).

Also: tests for `internal/tlsutil`, 28 ATT&CK context notes for the
analyst, and cosmetic leftovers of the old product name replaced
(Splunk source, notification subject, Message-ID and ETW session name
kept on purpose).

### Deployment diagnostics, phishing and SOC reliability

- Add `engine doctor` with JSON/exit status, bounded authenticated probes,
  verified TLS, local rule validation, Sysmon checks and console/hub checks.
  Generated `bench` telemetry is labelled alongside scenario data.
- Expand offline EML inspection with six explainable phishing indicators
  and shipped rules (75 enabled rules total); do not visit URLs or execute attachments.
- Change console brand/navigation/chart accents to blue and make empty
  activity intervals actually empty.
- Add Windows Server boot tasks with protected installation files, shared
  credentials, SQLite and foreground process recovery; document unsigned
  build limitations under Smart App Control and provide a package signing tool.
- Expose failed SQLite writes through stats, Prometheus, doctor and the
  dashboard so retained evidence loss is visible to SOC operators.
- Reject native API writes from foreign browser origins while preserving
  originless CLI clients. Rebuild legacy SQLite search indexes transactionally
  once so retained alerts/events remain searchable by their complete identity.

### Installer and product telemetry

- Fix PowerShell collection/version parsing, validate reusable portable tools,
  require Node 20.9+, use baseline Bun and frozen console lockfiles.
- Preserve operator data in staged ZIP updates and use git fast-forwards
  with explicit refusal of local changes/divergence.
- Correct uninstall location and bin PATH cleanup, reject dangerous roots
  and detect same-path installer self-replacement.
- Honor NoConsole without Node/Bun provisioning; report console failures as
  incomplete and do not enable failed console autostart.
- Remove shipped demo generators/launchers/release binaries; install the
  observed-log collector. Scenario/bench helpers are tests-only, restricted
  to literal loopback targets. Keep historical evidence labels.
- Add Windows PowerShell 5.1 behavioral installer/update checks, including
  real engine/collector compilation in a temporary install.

### Added

- Six explicit SOC import formats in the operational Go `collector`: Suricata
  EVE, Zeek JSON conn, individual osquery differential rows, Cowrie JSONL,
  Windows Firewall W3C logs and offline EML. Verified remote TLS/auth,
  bounded records, explicit source timezone and no uncertain-write replay.
- Fourteen source-gated SOC rules (69 enabled total) and two volumetric
  thresholds for Cowrie logins and inbound firewall drops (four total).
  osquery readonly schedule in `configs/osquery-soc.conf`.
- `engine report` interactive/strict-notes workflow with exact API alert lookup,
  frozen evidence, human classification and exclusive Markdown/JSON output.
- Ten browser-local investigation reports with explicit save, detected stale
  revision protection, Markdown/JSON downloads and a saved snapshot catalog.
  Reports remain accessible after alert retention and do not change triage.
- Authenticated real collector/engine smoke plus parser, rule, TLS, report,
  DOM and Chromium regressions; test inputs remain labelled inert fixtures.

- A PowerShell syntax guard (`scripts/dev-tests/check_powershell_syntax.ps1`)
  parses every `.ps1` in the tree with the real PowerShell AST parser. It
  runs in CI twice — pwsh on Ubuntu and Windows PowerShell 5.1 on the
  Windows job, the parser that actually executes `irm | iex` on a stock
  box — and in `make ci` when pwsh is available.
- Browser-local saved searches in Alertas and Flujo: 20 bounded, validated
  filter presets with apply/update/delete, cross-tab updates, reload and
  browser Back support. Only filters are saved, including the query text.
- A whole-window source summary and persistent demo indicator when
  simulated events are mixed with Sysmon/ETW records; sources are declared
  by the sender, not attested. Added regressions and desktop/mobile captures.
- Six `file.write` alarms in `rules/windows/file-staging.yaml`: Office
  payloads, script-written DLLs, downloaded/extracted DLL candidates,
  PowerShell profiles, Office startup content and LSASS dump artifacts.
  That increment brought the pack to 55 enabled rules; medium signals document their
  legitimate uses and require investigation rather than automatic response.
- Full forensic snapshot downloads in JSON and versioned JSONL, retaining
  the alert, metadata, raw event fields, hashes and enrichment.
- A generated full-ID rule inventory with a CI/`make ci` drift check.
  Regenerate with `python3 scripts/dev-tests/check_rule_inventory.py --write`.
- An authenticated loopback smoke validates the real ingest → alarm →
  frozen-evidence path with inert fixtures, including the capture threshold
  and read authorization; no attack commands or active response are run.

### Fixed

- Direct and hub alert mappings retain source, observation attributes and
  network context; the hub preserves `info` severity. Ring and SQLite searches
  share source/attribute/flow fields. Distinct imported mail records no longer
  collapse into one observer/PID-zero dedup key.
- Bridge stop during probe/snapshot no longer opens a late stream; polling and
  header timers are released on failures, stream readers cancel on shutdown,
  and SSE frames/incomplete buffers are bounded.
- Source declaration summaries identify all six imported formats while
  retaining the demo label for mixed windows; source remains unattested.
- CLI stale rule counts and Makefile Go/staticcheck prerequisites corrected;
  collector included in future Linux/Windows release builds.

- The installer no longer dies on git's own progress banner: `git clone`
  always writes "Cloning into ..." to stderr, and under
  `$ErrorActionPreference='Stop'` Windows PowerShell 5.1 turns the first
  REDIRECTED stderr line into a terminating `NativeCommandError` — the
  `2>&1`/`2>$null` redirects materialize the ErrorRecord before
  discarding it. Every native call (git, go builds, reg, netsh, tool
  version probes) now goes through `Invoke-Native`, which runs with
  `EAP=Continue`, echoes progress, keeps the text for diagnostics and
  throws with the real exit code and detail. `go build` failures now
  surface the compiler error in the throw. A CI/`make ci` lint
  (`check_installer_native_stderr.py`, with `--self-test` fixtures from
  the original crash) keeps the pattern from returning. The system-Go
  probe also moved 1.22 → 1.26 to match `go.mod`.
- The Windows installer was un-runnable: `"cannot verify $Url: …"` in
  `Invoke-Download` is a PowerShell parse error
  (`InvalidVariableReferenceWithDrive` — `:` after a variable is read as
  a drive/scope qualifier), so `irm | iex` aborted before any step. Now
  `${Url}`. The Go toolchain pin also moved 1.22.10 → 1.26.8: `go.mod`
  requires 1.26.0 and the installer sets `GOTOOLCHAIN=local`, so a green
  parse still ended in a refused build.
- CSV escaping now covers every event/alert text column, including IDs,
  sources, rules, tags, destinations and registry keys. LF, fullwidth formula
  prefixes and leading whitespace are handled; JSONL and stored data remain
  exact. Numeric PID/port columns are preserved.
- Analyst progress no longer adds cosmetic delays or simulates token
  streaming after receiving a completed response. Steps describe local
  preparation/context lookup and the actual configured-provider request.
- All analyst alert/rule metadata is bounded inside JSON evidence blocks;
  an unbounded duplicate of process fields outside the prompt fences was
  removed. Provider failures produce no invented analysis.
- Feed typing now uses the same 120-character limit as the URL, avoiding
  changed results after reload. README/web copy distinguishes the real
  engine session from its demo records and collector verification limits.
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

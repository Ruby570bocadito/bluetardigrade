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

### Remote fleet: machine inventory, sensor heartbeats and silent-sensor alerts (2026-10-04)

- `internal/fleet` keeps one record per reporting host: first and last
  seen, recent rate, sources, connection addresses, ingest identity and
  the sensor's last health report. Bounded, in memory, retires hosts
  after seven days.
- Sensors send `sensor.heartbeat` every 60 s: the Rust sensor (with the
  Windows version) and `sf-sensor`. The ingest consumes it into the
  inventory and never forwards it to rules, rings or storage.
- A sensor that stops its heartbeats past 3 x its interval (at least
  3 min) raises one `fleet-sensor-silent` alert per outage (high,
  T1562.001), through the suppression gate.
- `GET /api/fleet` (OpenAPI documented).
- **Equipos** becomes the fleet manager:
  - status counters and an online / silent / idle filter;
  - a status pill per machine;
  - a sensor card on the host page (sensor, OS, capture, last heartbeat,
    uptime, IPs, identity, spool/drops) with a warning when silent;
  - a sidebar badge counting silent sensors;
  - an enrollment assistant that writes the commands for a new machine.
  
  The console never connects to the machines.
- Windows launcher: the ingest listens beyond loopback only when
  `tools\config\ingest-identities.yaml` exists, with ingest TLS when a
  certificate pair sits next to it.
- `sf-sensor` (Sysmon) fix: its live loop called
  `EventLogWatcher.WaitForNextEvent()`, which .NET does not have, so every
  pass threw and reconnected. It now reads new records by EventRecordID
  every second.
- New docs:
  - `docs/FLOTA-REMOTA.md`: enrollment, identities, TLS certificate,
    firewall, boot task, maintenance;
  - `docs/PRUEBAS-PENDIENTES.md`: checklist for the real Windows host.

### Rust sensor: network connections and registry writes (2026-10-04)

- A second real-time ETW session adds two event types:
  - `network.connect` from Microsoft-Windows-Kernel-Network: TCP
    connection attempts, IPv4 and IPv6, with ports decoded from network
    byte order. Loopback is skipped.
  - `registry.set` from Microsoft-Windows-Kernel-Registry: value writes
    to the keys detections read.
- Event ids are filtered in the kernel and registry keys by a curated
  list. Paths and values follow Sysmon's format, so the existing rules
  fire on either sensor. This was verified with the rule tester on Run,
  ms-settings UAC bypass, RDP, IFEO and C2-port events.
- A PID -> name table, fed by process starts and the start-up rundown,
  names the process behind network and registry events.
- New flags: `--no-network`, `--no-registry`, `--registry-all`. When the
  extra session cannot start the sensor warns and keeps process events.
  Ctrl+C stops both sessions.

### Console: incidents, hosts, alert actions and NOC mode (2026-10-04)

- **Detección:** one section with tabs for Reglas, Cadenas, Supresiones
  and Probador. The old view ids and deep links keep working.
- **Probador:** paste an event (or pick an example) and see which live
  rules match and on which fields, with no alert and nothing stored.
- **Incidentes:** case list and detail.
  - Status, severity, owner and summary.
  - Affected hosts and the alerts of the case.
  - An incident graph and a timeline with notes.
- **Equipos:** one page per host, opening the riskiest one by default.
  - Risk and stat tiles.
  - Live process tree, entity graph and timeline.
  - Network destinations, and an "open incident with its alerts" action.
- **Alertas:**
  - Checkbox selection with select-all.
  - An action bar for the selection:
    - acknowledge, close or reopen with one note;
    - add to a new or existing incident;
    - suppress each rule on its host (reason and expiry required);
    - export JSONL or CSV;
    - send the most severe alert to the analyst.
  - Quick actions in the detail:
    - open the host page;
    - add to an incident;
    - suppress on this host;
    - contain the process (operator name and credential; the engine
      verifies and audits it);
    - on-demand IP reputation when a provider key is set.
- **Critical alert notifications:** a bell in the header turns on browser
  notifications and an optional tone for new open critical alerts.
  - Off by default and stored per browser.
  - The backlog is never replayed on open or on reconnect.
- **Modo NOC:** full-screen rotation for a wall monitor.
  - Three screens: situation, investigation graph, and coverage and hosts.
  - Arrows switch, Space pauses, Escape or leaving full screen exits.
  - Shell shortcuts are paused while it is open.
- The command palette ranks matches in a command's name first ("noc"
  finds Modo NOC before a description that contains the word).

### Windows launcher: token, writes and history (2026-10-04)

- `sf-console` and `sf-sensor` now start the engine with a bearer token
  on every install (generated once into `tools\config\api.token`, read
  by the engine, console, hub and `doctor`), `-api-write` so the console
  can create suppressions, and SQLite history in `data\sf-store.db`.
- Active response is armed only when `tools\config\respond-operators.yaml`
  exists (per-operator credentials from `sf-engine operator-credential`);
  the audit goes to `data\respond-audit.jsonl`.

### Incidents, rule tester and reputation lookups (2026-10-04)

- Incidents (`internal/incident`, `-incidents ./incidents.json`): cases
  grouping alerts with status, severity, owner, hosts and a timeline that
  records every change. REST under `/api/incidents` and an `incident` SSE
  frame per change; atomic JSON persistence, fatal on a malformed file,
  bounded store and fields.
- `POST /api/rules/test`: dry-run one event against the live rules and
  get the matches and matched fields, with no side effects.
- `GET /api/reputation`: opt-in, on-demand VirusTotal / AbuseIPDB
  lookups (`SF_VT_API_KEY`, `SF_ABUSEIPDB_API_KEY`). Private addresses
  refused, six-hour cache, per-provider rate limits, nothing looked up
  unless an analyst asks.
- OpenAPI documents the eight new operations (drift guard in sync).

### Detection coverage pack (2026-10-04)

- 39 new rules (75 -> 114) so 13 of the 14 ATT&CK tactics have
  detections:
  - initial access: webshells and xp_cmdshell, payloads run from mail
    attachments or archive caches, Equation Editor, unusual formats
    from Downloads;
  - privilege escalation: fodhelper/eventvwr/sdclt UAC bypasses, IFEO
    debuggers, accessibility binary replacement, Potato/PrintSpoofer,
    services in user-writable paths;
  - collection and exfiltration: password-protected archives, screen and
    clipboard capture, browser credential stores, PST/OST copies,
    rclone, curl/PowerShell/BITS uploads, scripted FTP;
  - discovery, lateral movement and C2: recon spawned by documents or
    script hosts, antivirus inventory, setspn, network scanners, remote
    sc services, WinRM, RDP enabled by registry, tunnels, interpreters
    on classic C2 ports, remote access tools;
  - evasion and impact: AMSI bypass, WMI subscriptions, PowerShell
    history and script block logging tampering, password hunting,
    backup/security services stopped, cipher /w, ransom notes;
  - reconnaissance: IDS active scanning, honeypot fingerprinting.
- 7 new kill chains (4 -> 11) in `sequences/campaigns.yaml`: data theft
  (archive + upload, archive + rclone), ransomware preparation, webshell
  with internal recon, credential theft then lateral movement, UAC
  bypass then LSASS dump, malicious document then download.
- Every new rule has an attack case and benign twins in
  `internal/rules/attack_coverage_test.go`; the scenario feed and the
  store/sequences E2E keep their canonical counts.
- `suppressions.example.yaml` documents host-scoped exceptions for the
  rules that legitimately fire in some organisations.

### Professional SOC console, README and brand (2026-10-03)

The previous console is preserved at the `console-v1` tag.

Console

- Every view redesigned on the neutral zinc design system of the first
  console, refined: glass panels with hairline borders, one blue accent,
  the original tardigrade mark in the sidebar (its halo breathes while the
  engine is live), view descriptions and a UTC clock in the header.
- React Bits motion, all frozen under `prefers-reduced-motion`:
  - CountUp on stat tiles, a rolling Counter on the critical hero;
  - AnimatedContent cascade when a view mounts, GlareHover on tiles;
  - plus the existing SpotlightCard, AnimatedList, DotGrid, BlurText,
    ShinyText, DecryptedText and StarBorder.
- Graphs:
  - investigation graph of the window (hosts, users, processes,
    detections, network destinations), with a deterministic force layout,
    neighbourhood highlight, flowing edges for open critical detections and
    observed connections, and click-through to the alert queue;
  - per-alert graph (radial: detection, host, user, process and parent,
    destination) in the alert detail;
  - process tree built from the forensic bundle, with the process that
    fired highlighted;
  - kill chains drawn as flows: steps, live connectors and a campaign node.
- Charts (dependency-free SVG kit in `src/components/charts`):
  - area with crosshair and an alert marker rail;
  - stacked columns, bar lists, part-to-whole bar, meters, sparklines;
  - ATT&CK tactic strip and a host x tactic heatmap.
  - Every chart has a table view or is a table, tooltips never gate a
    value, keyboard focus with arrow keys, honest unavailable states.
- Palettes validated with the dataviz six-checks script on the panel
  surface:
  - severity is a five-step status scale, always with an icon and a label;
  - categorical series use the validated adjacent order.
- Panel: triage hero, lifecycle split, stat tiles with sparklines from the
  polled `/api/stats` history, sensor activity, alerts by severity,
  investigation graph, hot hosts, top rules, detections of the last hour,
  telemetry mix, ATT&CK coverage, host x tactic heatmap and a pipeline
  health strip. Charts open the alert queue with the matching lens.
- Flujo en vivo: ingest rate, event-type mix and network destinations;
  the bars filter or search the feed.
- Alertas: severity strip that also filters the queue; fixed column layout
  so the alert name keeps room next to the detail panel.
- Reglas: coverage by ATT&CK tactic, severity and event type, each a filter.
- Supresiones: scope and expiry summary plus a proper table.
- Respuesta activa: audit decisions, denial codes and attempts per operator.
- Analista IA: panel headers, channel state, conversation bubbles.
- `src/lib/soc-metrics.ts` and `src/lib/entity-graph.ts` hold the pure
  aggregations and layouts, with tests.

Repository

- New README body (validated Windows quickstart, features, security
  model, architecture) under the original header and logo.
  `install.ps1` prints an ASCII tardigrade.
- Retired `docs/arquitectura-tecnica-v0.11.pdf` and its `scripts/arq_v04`
  generator: the PDF no longer matched the code.
- Console captures regenerated from a loopback lab engine with
  `docs/assets/src/capture_console.mjs`. The animated GIFs and the
  superseded captures were removed.

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

Rust ETW sensor fixes found on a real Windows host

- Every event inside a ~7 minute bucket carried the same timestamp:
  ferrisetw 1.2.0 rebuilds the FILETIME from the high dword twice. The
  sensor now decodes the raw record time itself.
- The sensor never reported command lines or parent PIDs: the
  Microsoft-Windows-Kernel-Process ProcessStart event has no
  CommandLine and names the parent ParentProcessID, so all 46 rule
  conditions on `process.command_line` were blind to it. It now reads
  the kernel Process/Start event (named system-logger session), which
  carries both; names truncated by the kernel are recovered from the
  command line, and `user` is the new process owner's SID instead of
  the account running the sensor. `process.image` is no longer
  reported (the kernel event has no full path).
- "Access denied" now says to run the sensor elevated.
- Ctrl+C (or closing the console) stops the kernel session; a session
  left by a killed run is stopped and the start retried, instead of
  failing with AlreadyExist.
- Ctrl+C no longer loses what the sensor holds in memory: the line it
  was sending and the queued ones get one delivery attempt each and
  otherwise go to the spool (counted as dropped when there is none); an
  interrupted spool replay keeps its file for the next start.
- The sensor starts even when the engine is not listening yet (boot
  order, engine restart): events wait in the queue/spool. Only
  configuration errors (CA bundle, TLS verification, rejected token)
  abort the start.
- `sf-console -Stop` no longer claims success when the processes were
  started from an Administrator window and could not be stopped.
- Installer: when another install (e.g. the old security-framework one)
  comes first on the user PATH, the new bin moves to the front instead
  of being appended behind it; the PATH is read and written through the
  registry API (keeps REG_EXPAND_SZ and non-ASCII folders) and the
  change is broadcast to new terminals. A leftover security-framework
  install is reported with how to remove it.
- Installer: an update stops with a clear message, before modifying
  anything, when the engine/collector binaries are still running (e.g.
  started from an Administrator window); a running sensor no longer
  aborts the end of the install.
- Installer: native tool output is no longer printed twice, and go, git,
  bun, Next and cargo output is decoded as UTF-8 (no more `Ô£ô`).
- Engine: hot-reload announces rules/sequences/beacons/thresholds only
  when a set changes (it printed four lines every 15 s), and a broken
  edit to any of them is now logged once instead of ignored.
- Ingest: error acks are written with a deadline. The Rust sensor never
  reads them after AUTH, so ~1000 refused lines (malformed JSON or a host
  outside the identity binding) used to park the connection handler for
  good; the connection is now closed and the refusals stay counted.

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

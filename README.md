<div align="center">

# security-framework

**Real-time threat detection for Windows endpoints — ETW sensor, behavioral engine, and an operator console that shows only the truth.**

[![ci](https://github.com/Ruby570bocadito/security-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/Ruby570bocadito/security-framework/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![go](https://img.shields.io/badge/Go-1.22%2B-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![rust](https://img.shields.io/badge/Rust-1.85%2B-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows11&logoColor=white)](docs/OPERATIONS.md#one-command-install-windows)
[![api](https://img.shields.io/badge/API-OpenAPI_3.0_drift--guarded-6BA539?logo=openapiinitiative&logoColor=white)](docs/api/openapi.yaml)
[![latency](https://img.shields.io/badge/ingest%E2%86%92alert%20p99-%E2%89%880.4_ms_measured-34d399)](#measured-performance)
[![prs](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

</div>

A behavioral detection framework built by an offensive-security practitioner, informed by how actual adversary tradecraft behaves on Windows endpoints. It combines a kernel-level **ETW sensor (Rust)**, a **behavioral detection engine (Go)**, a **YAML rule format mapped to MITRE ATT&CK**, and a **web console** with an AI triage analyst.

> The project name is provisional. Expect a rename before v1.0.

**Status: `v0.1.0`** (`engine version`). Phases 1–3 of the roadmap are delivered: the full pipeline — real ETW/Sysmon telemetry → rules → correlation → alert → gated response — runs against the actual host, wrapped in the production surface (SQLite persistence, SIEM sinks, chat/mail notifications, audited active response, operator console). The scripted `sf-devsensor` scenario remains solely as a clearly labeled demo; nothing in the product path invents data. Next up: YARA memory scanning, an ETW-native collector and phase-4 filaments (see [Roadmap](#roadmap)).

---

## At a glance

| | |
|---|---|
| **Sensor** | Rust ETW sensor (Kernel-Process) + Sysmon ingestion path; Windows-gated — refuses to run where there is no real telemetry |
| **Engine** | Go 1.22, single binary, CGO-free: ingest → enrich → rules → correlate → alert → respond |
| **Rules** | YAML with 17 operators (11 case-sensitive + 6 case-insensitive), per-rule MITRE ATT&CK tags, hot-reload every 15 s |
| **Sigma import** | `engine sigma` converts community Sigma rules to the native format (deterministic, fail-loud per rule, provenance preserved) |
| **Correlation** | Kill-chain sequencer (same host, time window) with a hard state cap and external observability |
| **Risk scoring** | Per-host decayed risk score (severity-weighted, 30-min half-life): hot-hosts KPI in stats, Prometheus and console |
| **Beaconing** | C2 call-home detector (CV regularity over connection timing): ships conservative profiles, cooldown, bounded state, same alert pipeline |
| **Console** | Next.js + socket.io live triage with an AI analyst (bring-your-own OpenAI-compatible model) and a read-only active-response view with its forensic audit trail |
| **Storage** | Opt-in SQLite persistence (`-store`, pure-Go driver, WAL) with a retention pruner |
| **Performance** | Measured, not assumed: ingest→alert p99 ≈ 0.4 ms on loopback ([numbers](#measured-performance)) |
| **Security posture** | Loopback-only binds by default, constant-time token compares, CSV formula-injection neutralization, SHA-pinned CI |

![Console operations dashboard: KPIs with the per-host risk tile, sensor activity chart, hot-hosts panel and recent telemetry](docs/assets/console-panel.png)

---

## Why security-framework

Most open EDR-style sensors are either hard to extend or hard to integrate. This project bets on three ideas:

1. **Behavior over signatures.** IOCs expire; TTPs persist. Rules model process trees, command lines and handle access — the noise an attacker actually makes.
2. **Offensive provenance.** Every seeded rule corresponds to a technique validated in a lab against its real TTP, and documents the noise it produces on a clean host.
3. **Usability is a security feature.** A detection engine nobody wants to operate detects nothing. NDJSON debugging with netcat, hot-reloaded YAML rules and an OpenAPI-first REST interface come before exotic features.

And one engineering rule that shapes everything else: **no simulated data in the product path.** The console never invents events, the engine degrades loudly instead of silently, and the only scripted piece in the repo is the demo scenario, clearly labeled as such.

## Architecture

![Architecture: kernel, Rust sensor, Go detection engine with its behavioral detectors and output layers](docs/assets/diagram_arquitectura.png)

One Go binary: **ingest → enrich → rules → correlate → alert** feeds the API, the store, the webhook/SIEM/notification sinks and the console — with the behavioral detectors on top of the rule engine (kill-chain sequencer, per-host risk decay, C2 beaconing, volumetric thresholds) and a heavily gated, fully audited active-response surface. The unified event schema (`pkg/model`) is the master contract: sensors emit it, the engine validates and enriches it, rules index it, every interface consumes it. Full diagram, mermaid source, feature inventory and annotated repository tree: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Quickstart (tracer bullet)

Requirements: Go 1.22+.

```bash
# terminal 1 — start the engine
make run-engine

# terminal 2 — replay the demo scenario (simulated data, smoke test only)
make run-devsensor
```

Representative output on the engine terminal (the rule pack grows over time, so the counts reflect the current state of `rules/`):

```
[ENGINE] 23 rules loaded from ./rules (types: [file.write image.load network.connect process.access process.create registry.set])
[ENGINE] 4 sequences loaded from ./sequences (correlator on: [Campana de robo de credenciales Campana de intrusion completa Apagon defensivo Instalacion de persistencia])
[ENGINE] 2 beacon profiles loaded from ./beacons.yaml (beaconing detection on: [C2 beacon rapido C2 beacon web lento])
[ENGINE] 2 threshold definitions loaded from ./thresholds.yaml (volumetric detection on: [Fuerza bruta a servicios remotos Rafaga de escrituras en carpeta publica])
[ENGINE] listening on 127.0.0.1:7777 (NDJSON, 1 event per line)
[ENGINE] api on 127.0.0.1:7778 (stats / events / alerts / rules / stream)
[ALERT] HIGH     9f31c2a4... powershell.exe -nop -w hidden -enc SQBF... host=LAB-WKS-01
[ALERT] HIGH     c1d24e9b... certutil.exe -urlcache -split -f https://... host=LAB-WKS-01
[ALERT] CRITICAL 5b7e1f38... rundll32.exe C:\Windows\...\comsvcs.dll, MiniDump... host=LAB-WKS-01
[ALERT] HIGH     e8a1c72d... schtasks.exe /create /tn MicrosoftEdgeUpdaterCore... host=LAB-WKS-01
[ALERT] HIGH     f3b2d98e... wmic.exe /node:LAB-WKS-02 process call create... host=LAB-WKS-01
[ALERT] CRITICAL a7c4e5f1... powershell.exe -c Set-MpPreference -DisableRealtimeMonitoring... host=LAB-WKS-01
[ALERT] CRITICAL b8d5f6e2... vssadmin.exe delete shadows /all /quiet host=LAB-WKS-01
```

Each alert is also emitted as a structured JSON line for downstream consumers (SIEM connectors, the web console).

![Tracer bullet pipeline: devsensor, NDJSON/TCP, engine, rules, alert](docs/assets/diagram_tracer.png)

One command per component — the full guides live in **[docs/OPERATIONS.md](docs/OPERATIONS.md)**:

- Engine from source: `make build`, then `./bin/engine` — [build from source](docs/OPERATIONS.md#build-from-source) · [Docker image](docs/OPERATIONS.md#docker)
- Web console: `cd web/console-service && bun install && bun run dev`, then `cd web/console && bun install && bun run dev` — [console section](#web-console)
- Windows one-command install (six commands on PATH, Sysmon setup and autostart optional) — [install guide](docs/OPERATIONS.md#one-command-install-windows)
- Real host telemetry: `sf-sensor -SetupSysmon`, then `sf-sensor` — [Sysmon guide](docs/OPERATIONS.md#real-telemetry-with-sysmon-recommended)
- Rust ETW sensor from source: `make build-sensor-windows` — [sensor build](docs/OPERATIONS.md#building-the-real-sensor-windows)

The complete operational surface — [configuration reference](docs/OPERATIONS.md#configuration-reference) (every flag and env var), [HTTP API](docs/OPERATIONS.md#local-http-api), [Prometheus metrics](docs/OPERATIONS.md#prometheus-metrics), [SQLite storage](docs/OPERATIONS.md#persistent-storage-sqlite-opt-in), [ingest auth with zero-downtime rotation](docs/OPERATIONS.md#ingest-authentication-shared-token), [ingest TLS](docs/OPERATIONS.md#ingest-tls-encryption-in-transit), [alert webhook](docs/OPERATIONS.md#alert-webhook-siemsoar-connector), [Elastic/Splunk sinks](docs/OPERATIONS.md#siem-sinks-elasticsearch--splunk), [Slack/Telegram/email notifications](docs/OPERATIONS.md#external-notifications-slack-telegram-email), [suppressions](docs/OPERATIONS.md#alert-suppressions-operator-allowlist), [triage lifecycle](docs/OPERATIONS.md#alert-triage-lifecycle), [risk scoring](docs/OPERATIONS.md#host-risk-scoring-hot-hosts), [beaconing](docs/OPERATIONS.md#beaconing-detection-c2-call-home) and [active response](docs/OPERATIONS.md#active-response-kill_process-opt-in) — is documented in **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

## Detection rules

Rules live in `rules/` as YAML, are validated at load with house caps, and hot-reload every 15 seconds by default. The shipped pack: 23 rules over 6 event types (6 critical / 15 high / 2 medium), every one mapped to MITRE ATT&CK with its source TTP and the lab noise it produces on a clean host documented. Example rule:

```yaml
- name: "PowerShell con comando codificado"
  id: "9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40"
  severity: high
  event_type: process.create
  conditions:
    - field: process.name
      operator: eq
      value: "powershell.exe"
    - field: process.command_line
      operator: contains_any
      value: ["-enc", "-EncodedCommand", "-w hidden"]
  tags: ["attack.t1059.001", "attack.execution"]
  enabled: true
```

Beyond per-event rules: kill-chain sequences in `sequences/` (4 shipped, all critical, window 5m), per-rule actions (message templates, per-rule webhooks), Sigma import (`engine sigma`), C2 beaconing profiles (`beacons.yaml`) and volumetric thresholds (`thresholds.yaml`). The full rule table, sequence table, operator reference, action format and Sigma mapping: [docs/OPERATIONS.md](docs/OPERATIONS.md#detection-rules).

## Web console

The repo ships a browser console: live telemetry feed, KPI dashboard, severity triage, the YAML rule pack, the kill-chain chains the correlator has armed, operator suppressions, the active-response audit view, and an AI analyst that explains each alert like a senior SOC analyst would. Both the alert queue and the live feed support free-text search (rule, host, user, command line, MITRE tag) on top of the dropdown filters, so triage can narrow down a noisy host or a single technique in seconds. The hub (`web/console-service`) contains NO simulator: it forwards only what the Go engine's API (:7778) really delivers, and the header chip names the actual source of the events you are looking at - `sf-sensor (Sysmon real)` for real host telemetry, or `sf-devsensor (demo)` while the scripted scenario is replaying. If the engine is unreachable the console says so and shows no data, instead of inventing any.

The interface carries a restrained motion layer adapted from [React Bits](https://reactbits.dev) — every effect communicates a state change and none is decoration: a pointer-reactive dot-grid canvas behind the shell, view titles that blur in on section change, KPI halos that follow the mouse, an animated 1px border on the AI analyst while it is working, a gradient pulse on the critical counter while critical alerts exist, a status chip that scales in when a triage decision lands, and a brand tagline that decrypts once on load. Everything respects `prefers-reduced-motion` (static fallbacks) and the whole layer adds zero runtime dependencies beyond `motion`. The chrome itself is a premium dark surface system (marketplace-template grade, no extra dependencies): glass sidebar and topbar (`backdrop-blur` over the ambient canvas), grouped navigation with a spring-animated emerald pill, panel surfaces built from a hairline border + vertical gradient fill + inner top highlight + soft ambient shadow, KPI stat cards with soft icon tiles and hover lift, and compact status chips across the header — all defined once in `globals.css` (`.panel`/`.chip`/`.icon-tile`/`.glass`) and reused by every view.

Operations dashboard: KPIs, sensor activity, hot hosts, top kill-chain alerts and the live event sample in one view. The KPI strip carries a per-host risk tile (tracked hosts + current leader) and the engine column stacks the hot-hosts panel: the top hosts by decayed score, their bar, and an honest empty state when nothing is hot (the score cools on its own; the capture below shows the panel populated with the risk tile and the hot-hosts bar fed by a real devsensor replay with the beaconing detector fired). The header adds one status chip per detector/delivery surface (webhook delivery, kill-chain correlator, A3 beaconing, A2 volumetric thresholds — hidden while the feature is off, red at saturation), and the engine summary names the real persistence mode (`SQLite · N eventos · N alertas` with `-store`, `sin store` without): if a behavioral detector is armed or the store is attached, the console says so on screen, fed only by `/api/stats`.

![Console operations dashboard: KPIs with the per-host risk tile, sensor activity chart, hot-hosts panel and recent telemetry](docs/assets/console-panel.png)

Alert triage queue with severity badges, MITRE tags and expandable details. Selecting a row opens the detail panel: the rendered rule message, matched fields, declared actions and enrichment, plus the triage actions (r6) at the end of the panel:

![Console alert queue with the detail panel open: rule message, matched fields, tags, enrichment](docs/assets/console-alertas.png)

The `Ciclo de vida` section is the operator queue surface: a free-text note and the reconocer / cerrar / reabrir buttons. The decision round-trips console → engine proxy → engine API and every connected console updates live through the `alert_lifecycle` stream — this capture IS the recorded state: the row carries the `reconocida` chip and the panel shows who decided, when, and the note (persisted with `-lifecycle`):

![Console alert detail with a real triage decision recorded: reconocida chip on the row, note and decision metadata in the Ciclo de vida panel](docs/assets/console-alertas-triaje.png)

Free-text search on top of the dropdown filters - typing narrows the queue live to the alerts that mention `lsass`:

![Console search GIF: typing lsass filters the alert queue down to the matching alerts](docs/assets/console-busqueda.gif)

The loaded rule pack, rendered with each rule's conditions and MITRE mapping:

![Console rules view: 23 loaded rules with conditions and ATT&CK mapping](docs/assets/console-reglas.png)

The kill-chain chains the correlator loaded, rendered as connected step chains: emerald connectors when every step's rule is live (the chain can complete and raise its campaign alert), amber nodes for a step waiting on a missing rule:

![Console chains view: 4 armed kill-chain sequences with numbered steps and ATT&CK tags](docs/assets/console-cadenas.png)

Operator suppressions, rendered read-only with rule-name lookup, host scope, reason and a live expiry countdown — the exact set the engine loaded from `suppressions.yaml` (the nav badge shows the active count; suppressed hits raise no alert, as documented in the [suppressions guide](docs/OPERATIONS.md#alert-suppressions-operator-allowlist)):

![Console suppressions view: 1 active entry with rule-name lookup, host scope, reason and a live expiry countdown](docs/assets/console-supresiones.png)

The active-response view (C3) is read-only by design: it renders the armed state of the kill surface (SIGKILL fixed, live operator allowlist count, audit file health against the 64 MiB ceiling) and the tail of the audit JSONL with executed AND denied attempts, newest first - every denial keeps its reason code (`operator_not_allowed`, `host_mismatch`, `self_protected`, `cooldown_active`, `idempotency_repeated`). The class filter, the operator-controlled queue window (100/500) and the client-side JSONL export of the whole fetched window (independent of the class filter - the export is a data artifact, the filter is a view lens) are the forensic operability layer; the kill itself is invoked through the API by a human operator, never from the console UI, and on an engine without `-allow-kill` the view shows a real "no disponible" (the surface does not exist, same as for any probe). One audit line per attempt is the contract: a successful kill - pidfd or degraded - never carries the mechanism in the JSONL (it travels in the API response and the engine log); the followup line that does carry `mechanism` (with the `fallback_reason` errno when the send degraded) is written only when a committed send fails:

![Console active-response view over a live armed engine: the audit tail with executed and denied attempts and the F1 pair on top, arm and audit-health cards, class filter and JSONL export](docs/assets/console-respuesta-activa.png)

The degraded path itself is captured live: the second shot is the tail of a real fd-exhaustion live-fire - the lab filled the armed engine's file-descriptor table with idle TCP connections and delivered the kill over a connection accepted before the exhaustion, so `pidfd_open` failed with the real kernel `EMFILE` and the engine executed through the classic-kill fallback (target verified dead, `mechanism=fallback fallback_reason=emfile` in the API response and the engine log). The same tail shows the R2 fail-safe working under the same exhaustion: a name mismatch on a live decoy is denied by the pre-commit guard (`pid_mismatch`, resolved `real: sleep` versus the requested `notsleep`) without ever reaching the signal:

![Console active-response view after a degraded kill: fd-exhaustion live-fire tail with the executed fallback kill, the R2 denial and the normal pair](docs/assets/console-respuesta-activa-fallback.png)

Requirements: [bun](https://bun.sh). The hub (`web/console-service`) forwards only what the engine really delivers; details and the AI-analyst setup in [`web/console/README.md`](web/console/README.md).

```bash
# terminal 1 — realtime hub (socket.io on :3003, engine bridge on :7778)
cd web/console-service && bun install && bun run dev

# terminal 2 — console (Next.js on :3000)
cd web/console && bun install && bun run dev
```

Open http://localhost:3000. Point the UI at a remote hub with `NEXT_PUBLIC_CONSOLE_URL=http://hub-host:3003`. The console copy is in Spanish.

## Measured performance

Measured, not assumed: `cmd/bench` streams real events through the live engine and measures every alert on the same clock — ingest→alert p99 ≈ 0.4 ms (loopback, 23 rules, 2000-event runs, three consecutive), far inside the phase-1 contract of 10 ms. The nightly bench adds a second pass with the SQLite store attached, so the persistence overhead is recorded as data, not assumed. Full numbers, honest caveats and run-it-yourself commands: [docs/OPERATIONS.md](docs/OPERATIONS.md#measured-performance).

## How it compares

security-framework is a small, readable detection stack for Windows
telemetry, built for lab and educational use: one Go binary, YAML rules
you can read in an afternoon, and a kill-chain correlator you can audit
line by line. It is not a production SIEM or a managed EDR and does not
try to be. Where it sits next to tools you may already run:

| Project | What it is | How security-framework differs |
|---------|-----------|-------------------------------|
| Wazuh | full SIEM platform: manager, agents, compliance packs, dashboards, fleet management | Wazuh is a production deployment with real operational weight; this is a single binary plus a rule folder - useful to understand and extend a detection pipeline end to end, not to run a SOC |
| Velociraptor | DFIR tool for remote hunting and forensics at fleet scale | Velociraptor collects and hunts with its own query language, mostly on demand; this streams a narrow event schema into always-on rules and sequence correlation |
| Falco | runtime threat detection for Linux and containers (syscall events) | Falco covers Linux/syscall telemetry; this covers Windows ETW/Sysmon with process, registry, file and handle context, plus its own kill-chain correlator |
| osquery | fleet-wide SQL queries over host state | osquery answers point-in-time questions over a fleet; this is continuous detection over an event stream |
| Sigma | vendor-neutral rule format shared across SIEMs | Sigma is a specification, not a product; this ships its own small YAML format (also mapped to ATT&CK) tied to its evaluator - a deliberate trade: no format ecosystem, but rules, sequences and engine live in the same repo and hot-reload together |

If you need retention, analyst dashboards, agent fleet management or
compliance reporting, run a SIEM and ship the alerts there: the engine
webhook (`-webhook`) and the export endpoints (`/api/alerts/export`,
`/api/events/export`) exist precisely to feed a bigger pipeline.

## Repository layout

```
cmd/engine/           detection engine binary (Go)
cmd/devsensor/        demo sensor (Go): scripted scenario, the only
                      simulated piece in the repo
cmd/bench/            load and latency harness (p50/p99 ingest→alert)
internal/             19 detection/ops packages: ingest, enrich, rules,
                      beacon, threshold, correlate, sigma, alert, actions,
                      redact, api, risk, store, suppress, lifecycle,
                      webhook, notify, siem, respond
pkg/model/            unified event schema (the wire contract)
sensor/               Rust ETW sensor (collector is Windows-gated)
rules/  sequences/    detection content (hot-reloaded every 15 s)
beacons.yaml  thresholds.yaml  suppressions.example.yaml
web/console/          Next.js console (live feed, triage, AI analyst)
web/console-service/  realtime telemetry hub (bun + socket.io)
website/              official landing page (Next.js 16 + Tailwind 4)
scripts/              E2E verification harnesses, Windows runtime scripts,
                      versioned PDF pipeline (scripts/arq_v04/)
install.ps1  uninstall.ps1  Makefile  Dockerfile
docs/                 architecture PDFs, OPERATIONS.md, ARCHITECTURE.md,
                      OpenAPI spec (docs/api/), round reports (docs/agentes/)
```

The full annotated tree, one line per package: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#repository-layout).

## Documentation map

| Document | Contents |
|----------|----------|
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | operations guide: install (one-command Windows, Docker, source), configuration reference (flags + env vars), HTTP API, Prometheus, storage, ingest auth and rotation, webhook/SIEM sinks/notifications, suppressions, triage, risk, beaconing, active response, detection content (rules/sequences/Sigma), CLI reference, CI and the bench |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | architecture deep-dive: system diagram and mermaid source, the schema contract, detailed feature inventory and the annotated repository tree |
| [`docs/arquitectura-tecnica-v0.10.pdf`](docs/arquitectura-tecnica-v0.10.pdf) | full technical architecture (Spanish; current revision, generated by the versioned pipeline `scripts/arq_v04/` — includes C2 notifications, native SIEM sinks and audited C3 active response with its read surface, forensic console operability (class filter, 100/500 window, JSONL export), dual kill mechanism certified permanently in CI, real lab captures of the respond view embedded (Figures 3-4), the three-suite console battery floor enforced in CI (36 tests / 110 assertions) and the release packaging (v0.1.0 with CHANGELOG and binaries); v0.1/v0.2/v0.3/v0.4/v0.5/v0.6/v0.7/v0.8/v0.9 kept for provenance) |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | OpenAPI 3.0 contract of the API surface, drift-guarded in CI against `internal/api/api.go` |
| [`docs/false-positive-control.md`](docs/false-positive-control.md) | the operator guide to alert noise: suppression recipes, dedup semantics, correlator volume, receiver-side filtering, abuse-resistance caps |
| [`SECURITY.md`](SECURITY.md) | how to report a security vulnerability privately (coordinated disclosure with response windows) |
| [`CHANGELOG.md`](CHANGELOG.md) | versioned release history (Keep a Changelog format; v0.1.0 lists the shipped feature set and the CI enforcement behind it) |
| [`docs/analisis-brechas-y-mejoras.md`](docs/analisis-brechas-y-mejoras.md) | gap analysis and future improvements (Spanish; verified snapshot of what exists, what is missing across sensor/deployment/detection-content/ecosystem, with prioritized proposals and provenance) |
| [`docs/agentes/`](docs/agentes) | round-by-round development reports (multi-agent workflow, verifications included) |
| `rules/`, `sequences/`, `suppressions.example.yaml` | the shipped detection content, annotated and lab-validated |

## Roadmap

| Phase | Delivers | Status |
|-------|----------|--------|
| 1 | tracer bullet, ETW sensor, rule index, p99 < 10 ms | **shipped** |
| 2 | YARA memory scan, ETW-native collector (no Sysmon dependency) | in progress — SQLite persistence already shipped (`-store`) |
| 3 | ecosystem hooks: REST + OpenAPI (drift-guarded in CI), alert webhook, Slack/Telegram/email notifications, native Elastic/Splunk sinks | **shipped ahead of window** |
| 4 | Python filaments (sandboxed), plugins, benchmarks | planned |

## Contributing

Issues and PRs are welcome. Every detection PR must include: the TTP it models, the lab evidence (events produced) and the false-positive profile observed on a clean host.

## License

Apache License 2.0. See [LICENSE](LICENSE).

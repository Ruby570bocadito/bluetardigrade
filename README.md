<div align="center">

# security-framework

**Real-time threat detection for Windows endpoints — ETW sensor, behavioral engine, and an operator console that shows only the truth.**

[![ci](https://github.com/Ruby570bocadito/security-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/Ruby570bocadito/security-framework/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![go](https://img.shields.io/badge/Go-1.22%2B-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![rust](https://img.shields.io/badge/Rust-1.85%2B-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows11&logoColor=white)](#one-command-install-windows)
[![prs](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

</div>

A behavioral detection framework built by an offensive-security practitioner, informed by how actual adversary tradecraft behaves on Windows endpoints. It combines a kernel-level **ETW sensor (Rust)**, a **behavioral detection engine (Go)**, a **YAML rule format mapped to MITRE ATT&CK**, and an early **web console** with an AI triage analyst.

> The project name is provisional. Expect a rename before v1.0.

**Status: `v0.1` — tracer bullet plus console preview.** The full end-to-end pipeline (event → rules → alert) works today against REAL telemetry: `sf-sensor` streams events from the actual host and the browser console shows only what the engine really delivers, with AI triage. The scripted `sf-devsensor` scenario remains solely as a clearly labeled demo to smoke-test the pipeline. ETW-native ingestion (no Sysmon dependency) and YARA memory scanning land next (see the [roadmap](#roadmap) and `docs/`).

![Console operations dashboard: KPIs, sensor activity chart, kill-chain alerts and recent telemetry](docs/assets/console-panel.png)

---

## Table of contents

- [Why security-framework](#why-security-framework)
- [Features](#features)
- [Architecture (v0.1)](#architecture-v01)
- [Quickstart (tracer bullet)](#quickstart-tracer-bullet)
  - [Local HTTP API](#local-http-api)
  - [Ingest authentication (shared token)](#ingest-authentication-shared-token)
  - [Alert webhook (SIEM/SOAR connector)](#alert-webhook-siemsoar-connector)
  - [Alert suppressions (operator allowlist)](#alert-suppressions-operator-allowlist)
- [One-command install (Windows)](#one-command-install-windows)
- [Real telemetry with Sysmon](#real-telemetry-with-sysmon)
- [Web console (preview)](#web-console-preview)
- [Building the real sensor (Windows)](#building-the-real-sensor-windows)
- [Detection rules](#detection-rules)
  - [Kill-chain correlation](#kill-chain-correlation)
  - [Rule actions](#rule-actions)
- [Development & CI](#development--ci)
- [Measured performance](#measured-performance)
- [Repository layout](#repository-layout)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why security-framework

Most open EDR-style sensors are either hard to extend or hard to integrate. This project bets on three ideas:

1. **Behavior over signatures.** IOCs expire; TTPs persist. Rules model process trees, command lines and handle access — the noise an attacker actually makes.
2. **Offensive provenance.** Every seeded rule corresponds to a technique validated in a lab against its real TTP, and documents the noise it produces on a clean host.
3. **Usability is a security feature.** A detection engine nobody wants to operate detects nothing. NDJSON debugging with netcat, hot-reloaded YAML rules and an OpenAPI-first REST interface come before exotic features.

And one engineering rule that shapes everything else: **no simulated data in the product path.** The console never invents events, the engine degrades loudly instead of silently, and the only scripted piece in the repo is the demo scenario, clearly labeled as such.

## Features

| Area | What you get today |
|------|--------------------|
| **Telemetry** | Rust ETW sensor (Kernel-Process) + Sysmon ingestion path; NDJSON/TCP feed with schema validation and enrichment (user, command line, network context) |
| **Detection** | YAML rules with 11 operators (`eq`, `regex`, `contains_any`, …), hot-reload every 15 s, per-rule MITRE ATT&CK tags and actions |
| **Correlation** | Kill-chain sequencer: named steps across the same host within a time window raise one high-signal campaign alert |
| **Response** | Operator suppressions (rule/host, expiry, hot-reload), alert webhook with Bearer auth and bounded retries |
| **API** | Local REST API with OpenAPI 3.0 spec (drift-guarded in CI), SSE live stream, filters, JSONL/CSV export with formula-injection neutralization |
| **Console** | Live feed, KPI dashboard, severity triage with free-text search, rule browser, suppressions view, AI analyst (bring-your-own OpenAI-compatible endpoint) |
| **Auth** | Shared-token ingest handshake (constant-time), zero-downtime token rotation window, optional Bearer on the API and on outbound webhooks |
| **Ops** | One-command Windows installer (six commands on PATH), Docker image for the engine, GitHub Actions CI on every push |

## Architecture (v0.1)

![Architecture: kernel, Rust sensor, Go detection engine and output layers](docs/assets/diagram_arquitectura.png)

```
Windows kernel (ETW providers)          [phase 2: Linux eBPF]
        │
        ▼
Sensor (Rust) ── NDJSON/TCP ──►  Detection engine (Go)
                                 ingest → enrich → rules → alerts
                                        │
                          ┌─────────────┼─────────────┐
                          ▼             ▼             ▼
                     console/web   SIEM/SOAR     forensic store
                      (preview)    connectors     (phase 2)
```

The unified event schema (chapter 4 of the docs) is the master contract: sensors emit it, the engine validates and enriches it, rules index it, interfaces consume it.

Full write-up: [docs/arquitectura-tecnica-v0.1.pdf](docs/arquitectura-tecnica-v0.1.pdf) (Spanish). It reflects the v0.1 design including the kill-chain correlator and rule actions; it predates the ingest shared-token auth, the export API and the OpenAPI spec, which are documented in the [Local HTTP API](#local-http-api) section and in [`docs/api/openapi.yaml`](docs/api/openapi.yaml). See also [`docs/README.md`](docs/README.md) for the full design-vs-implementation status of the document.

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

### Local HTTP API

The engine serves a small read-only API used by the web console and handy for SIEM taps. Both the ingest port and the API bind to `127.0.0.1` by default: the feed carries sensitive host data (users, command lines) and the NDJSON ingest must stay unauthenticated only on loopback, so nothing should be reachable from other machines unless you decide so. To accept sensors running on different hosts, start the engine with `-addr 0.0.0.0:7777` (and `-api 0.0.0.0:7778` if the console is remote too), enable the shared-token auth ([next section](#ingest-authentication-shared-token)), open the port with the installer's `-Firewall` switch, and plan a network-level restriction to the sensor segment. The API can be disabled entirely with `-api 0`:

| Endpoint | Returns |
|----------|---------|
| `GET /api/health` | liveness + mode |
| `GET /api/stats` | uptime, counters, per-severity totals, rule count, ingest auth rejections, webhook delivery counters, active suppressions, kill-chain correlator observability (`correlator_states` / `correlator_sequences` / `correlator_cap`) |
| `GET /api/events?limit=200` | recent events, newest first |
| `GET /api/alerts?limit=100` | recent alerts, newest first |
| `GET /api/suppressions` | operator allowlist currently active (read-only view) |
| `GET /api/sequences` | kill-chain sequences loaded by the correlator (read-only view; empty = correlator off) |
| `GET /api/events/export?format=jsonl\|csv` | bulk download of the event ring (JSON Lines or CSV) |
| `GET /api/alerts/export?format=ndjson\|csv&limit=256` | downloadable alert feed for SIEM/SOAR handoff, chronological order |
| `GET /api/rules` | live rule set (hot-reload aware) |
| `GET /api/stream` | Server-Sent Events with live events + alerts |

All four telemetry endpoints (`/api/events`, `/api/alerts` and both `/export` variants) accept the same filter parameters, applied BEFORE `limit`: `host=<name>` (exact, case-insensitive), `since=`/`until=` (RFC 3339 timestamp or positive duration like `90m`/`24h`), `q=<free text>` (case-insensitive across ids, summaries, tags and context), plus `severity=a,b` and `rule_id=` on the alert endpoints and `type=` on the event ones. Invalid values answer 400 with an actionable message. Examples: `/api/alerts/export?host=lab-wks-01&since=24h` for "that box, today", `/api/events?type=network.connect&q=suspicious.tld` to chase one domain.

Exports are for SIEM import, offline analysis and the forensic store: JSONL round-trips the full records, CSV flattens them to stable columns and neutralizes spreadsheet formula injection on attacker-controlled fields. When `-webhook` is set, `/api/stats` additionally reports `webhook_sent` / `webhook_failed` / `webhook_dropped` so the delivery pipeline can be sized from the outside; with ingest auth active (`-token`), `ingest_rejected` counts connections rejected by the shared-token handshake. The machine-readable contract for the whole surface lives in OpenAPI 3.0 at [`docs/api/openapi.yaml`](docs/api/openapi.yaml).

The API can demand a bearer token: start the engine with `-api-token '...'` (or `SF_API_TOKEN`) and every `/api/*` route — stats, events, alerts, rules, stream, exports — answers `401` without a valid `Authorization: Bearer <token>` header, with a loud log line per rejected request. `/api/health` stays open on purpose: it is the liveness probe the engine, the console bridge and uptime checks rely on, and it reveals nothing but `{"mode":"engine","status":"ok"}`. The console-service bridge honors the same `SF_API_TOKEN` variable, so a token-protected console stack needs exactly one extra environment entry. This follows the same standard as the ingest auth: loopback stays friction-free by default, but a listener reachable beyond loopback must never serve telemetry without an explicit credential.

### Ingest authentication (shared token)

The NDJSON ingest supports a shared-token handshake for deployments where sensors connect over the network. Start the engine with `-token` or the `SF_INGEST_TOKEN` environment variable (flag wins):

```bash
sf-engine -addr 0.0.0.0:7777 -token 'pick-a-long-random-secret'
# or:  export SF_INGEST_TOKEN=...  and just run sf-engine
```

Every connection must then send `AUTH <token>` as its FIRST line (before any event) and receive `{"ack":"ok"}`. All bundled sensors honor it:

| Sensor | How to pass the token |
|--------|-----------------------|
| `sf-engine` | `-token <t>` flag or `SF_INGEST_TOKEN` env |
| `devsensor` (Go demo) | `-token <t>` flag or `SF_INGEST_TOKEN` env |
| `sf-sensor` (Rust/Sysmon) | `--token <t>` flag or `SF_INGEST_TOKEN` env |
| `sf-devsensor` (PowerShell demo) | `-Token <t>` param or `SF_INGEST_TOKEN` env |

Mismatch behavior is loud on purpose: a sensor with a stale token is closed with a clear `{"ack":"error",...}` message, a sensor sending `AUTH` to a token-less engine is closed too, and a silent client that never authenticates is dropped after 10 seconds. The comparison is constant-time. Loopback-only deployments without a token keep working exactly as before (auth disabled); a non-loopback bind without a token prints a startup warning, because any host that reaches the port could then inject events.

**Rotating the token without downtime.** The token is static per process, so rotation uses a two-token window: restart the engine once with BOTH tokens, redeploy the sensors with the new one, then restart the engine a final time with only the new token:

```bash
# 1) open the rotation window: current AND previous token both accepted
sf-engine -token 'the-new-secret' -token-previous 'the-old-secret'
# or:  SF_INGEST_TOKEN_PREVIOUS=the-old-secret  (flag wins)

# 2) redeploy sensors with the new token (any order, zero downtime:
#    sensors still on the old token keep streaming during the window)

# 3) close the window: restart the engine without -token-previous
sf-engine -token 'the-new-secret'
```

During the window the startup banner says `rotation window OPEN` so an operator can see at a glance when a migration is still in progress. Both comparisons are constant-time and combined without branching on the content, so the window does not leak which token matched.

On Windows the installer can persist the token for you (`install.ps1 -IngestToken '...'`, stored under `tools\config\ingest.token`, cleared with an empty value): the autostart entry, `sf-console` and `sf-devsensor` then all start the engine with that token enforced. The installer's `-Firewall` switch **requires** a configured token — it refuses to open TCP 7777 otherwise (and removes a rule left behind by a pre-gate install), because a reachable ingest without a token is an open event-injection channel for the whole network segment.

### Alert webhook (SIEM/SOAR connector)

The engine can push every raised alert as JSON to an external HTTP collector — a SIEM, a SOAR playbook, a chat-ops relay:

```bash
bin/engine -addr :7777 -webhook http://siem.internal:8080/ingest
```

Delivery is asynchronous and bounded: alerts queue up to 512 frames, a single worker POSTs them with up to three attempts (transport errors, 429 and 5xx retry; other 4xx fail fast) and a slow or down receiver never blocks detection — saturated deliveries are counted as dropped instead. The payload is the same structured alert the console and the JSON log line carry, so receivers speak one format. When the connector is active, the console header shows a delivery chip (`webhook N / err / desc`) fed by the same counters `/api/stats` exposes, so a silently down SIEM is visible at a glance.

**Outbound auth.** In shared networks the receiver should be able to verify who is POSTing — and a leaked URL alone must not be enough to inject alerts into your SIEM. Add a Bearer token, sent on every delivery (retries included):

```bash
bin/engine -webhook http://siem.internal:8080/ingest \
           -webhook-token 'pick-another-long-secret'
# or:  export SF_WEBHOOK_TOKEN=...  (flag wins)
```

The receiver then validates the `Authorization: Bearer` header, so a receiver reachable from more than the engine's host can reject unauthenticated or spoofed posts instead of ingesting fake alerts into the SIEM. Per-rule `actions.webhook` entries keep their own independent `secret` config (see [Rule actions](#rule-actions)); when both are set the per-action secret applies to that action only and the global token to the engine-level connector. A webhook running without any token prints a startup reminder listing the flag and the env var.

### Alert suppressions (operator allowlist)

Maintenance windows and accepted exceptions happen: sometimes an alert is correct and still unwanted. `suppressions.yaml` (see `suppressions.example.yaml` for the annotated format) silences a rule, a host, or a rule+host pair, with optional RFC 3339 expiration. The full operator guide to alert noise — dedup semantics, suppression recipes, correlation volume, receiver-side filtering and the pipeline's abuse-resistance caps — lives in [`docs/false-positive-control.md`](docs/false-positive-control.md):

```yaml
- rule_id: vss-delete
  host: LAB-WKS-01
  reason: "approved change window INC-1234 (backup migration)"
  expires: 2026-10-05T06:00:00Z
```

Point the engine at it with `-suppressions <path>` (default `./suppressions.yaml`, falling back to the install root like the rules directory). The file hot-reloads on the same 15 s ticker as rules and sequences: editing it is enough, no restart. Semantics worth knowing:

- A suppressed hit raises NO alert, does NOT reach the webhook, and does NOT feed the kill-chain correlator — a host with a silenced rule is treated as being in an accepted state. Each suppressed hit is logged as `[SUPPRESS] rule=<id> host=<host>`, never silently.
- An entry without `expires` stays active until you remove it; expired entries stop matching on their own.
- A malformed file is FATAL at startup (a typo must not disable a control you believe is armed) and rejected — keeping the previous set — on hot reload, loudly.
- The live set is observable read-only at `GET /api/suppressions` and counted in `/api/stats` (`suppressions_active`). Entries are edited in the YAML file, never through the API: the local API stays read-only.

## One-command install (Windows)

From any PowerShell window, no admin account and no prior download required:

```powershell
irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/install.ps1 | iex
```

The installer downloads the repository, provisions portable Go, Node and Bun under your user profile, builds the engine and the web console, and puts six commands on your PATH:

| Command         | What it does                                   |
|-----------------|------------------------------------------------|
| `sf-engine`     | detection engine, prints alerts live           |
| `sf-sensor`     | streams REAL host telemetry through the engine via Sysmon (`-SetupSysmon` installs it in one command) |
| `sf-devsensor`  | demo only: replays a scripted scenario (simulated data, clearly labeled; works under WDAC/Smart App Control) |
| `sf-console`    | starts the web console and opens the browser   |
| `sf-update`     | updates the code and rebuilds                  |
| `sf-uninstall`  | removes everything                             |

## Real telemetry with Sysmon (recommended)

`sf-devsensor` replays a scripted demo scenario (simulated data - the only simulated piece in the project). To detect what actually happens on the machine, set up Sysmon (free Microsoft telemetry driver) with one command - accept the UAC prompt once:

```powershell
sf-sensor -SetupSysmon
```

That installs Sysmon via winget (or finds an existing copy) and applies the bundled `sysmon-config.xml`. Manual equivalent, in an admin terminal:

```powershell
winget install Sysinternals.Sysmon
sysmon -accepteula -i "$env:LOCALAPPDATA\security-framework\scripts\sysmon-config.xml"
```

The shipped `sysmon-config.xml` is tuned to the detection pack and filters classic noise sources (ShimCache, UserAssist, MUICache, CDN DNS...). Then run `sf-sensor` (normal user; elevation or membership in the local `Event Log Readers` group is only needed to read the Sysmon log) and open `sf-console`: the alerts you see now correspond to real host activity - process creation, network and DNS, registry writes, file drops, and LSASS access (credential-dump detection).

Optional switches (parameterized form):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/install.ps1))) -WithSensor -AutoStart -Firewall
```

`-WithSensor` also builds the Rust ETW sensor (needs Rust + MSVC Build Tools), `-AutoStart` registers engine and console as logon entries (HKCU Run, no admin required), `-Firewall` opens inbound TCP 7777 for remote sensors (domain and private network profiles only) and asks for elevation via UAC when needed; it only matters when the engine is explicitly started with `-addr 0.0.0.0:7777`, since the default bind is loopback. `-WebhookUrl http://siem.internal:8080/ingest` persists the alert webhook so the engine autostart POSTs every alert there as JSON (re-run with `-WebhookUrl ''` to clear it). Install location defaults to `%LOCALAPPDATA%\security-framework` and can be changed with `-InstallDir <path>`.

To uninstall:

```powershell
sf-uninstall
```

or, from a machine where it is not installed (or the PATH is gone):

```powershell
irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/uninstall.ps1 | iex
```

The uninstaller stops the processes, removes the logon entries (HKCU Run and any legacy scheduled tasks), the firewall rule, the PATH entry and the whole install folder, including the portable toolchains it created. Toolchains you had before are left alone.

## Web console (preview)

The repo ships an early browser console: live telemetry feed, KPI dashboard, severity triage, the YAML rule pack and an AI analyst that explains each alert like a senior SOC analyst would. Both the alert queue and the live feed support free-text search (rule, host, user, command line, MITRE tag) on top of the dropdown filters, so triage can narrow down a noisy host or a single technique in seconds. The hub (`web/console-service`) contains NO simulator: it forwards only what the Go engine's API (:7778) really delivers, and the header chip names the actual source of the events you are looking at - `sf-sensor (Sysmon real)` for real host telemetry, or `sf-devsensor (demo)` while the scripted scenario is replaying. If the engine is unreachable the console says so and shows no data, instead of inventing any.

Operations dashboard: KPIs, sensor activity, top kill-chain alerts and the live event sample in one view.

![Console operations dashboard: KPIs, sensor activity chart, kill-chain alerts and recent telemetry](docs/assets/console-panel.png)

Alert triage queue with severity badges, MITRE tags and expandable details:

![Console alert queue: 18 alerts with severity badges, MITRE tags and kill-chain names](docs/assets/console-alertas.png)

Free-text search on top of the dropdown filters - typing narrows the queue live (from 18 alerts to the 3 that mention `lsass`):

![Console search GIF: typing lsass filters the alert queue from 18 to 3](docs/assets/console-busqueda.gif)

The loaded rule pack, rendered with each rule's conditions and MITRE mapping:

![Console rules view: 23 loaded rules with conditions and ATT&CK mapping](docs/assets/console-reglas.png)

Operator suppressions, rendered read-only with rule-name lookup, host scope, reason and a live expiry countdown — the exact set the engine loaded from `suppressions.yaml` (the nav badge shows the active count; suppressed hits raise no alert, as documented in the suppressions section above):

![Console suppressions view: 2 active entries with rule names, host scope, reasons and an expiry countdown](docs/assets/console-supresiones.png)

Requirements: [bun](https://bun.sh).

```bash
# terminal 1 — realtime hub (socket.io on :3003, engine bridge on :7778)
cd web/console-service && bun install && bun run dev

# terminal 2 — console (Next.js on :3000)
cd web/console && bun install && bun run dev

# optional terminal 3 — real engine to feed the console
make run-engine
```

Open http://localhost:3000. Point the UI at a remote hub with `NEXT_PUBLIC_CONSOLE_URL=http://hub-host:3003`. The console copy is in Spanish; see `web/console/README.md` for details.

## Building the real sensor (Windows)

Requirements: Rust stable with the `x86_64-pc-windows-msvc` target. Use **1.85 or newer**: the committed `Cargo.lock` resolves `time-core 0.1.9`, which needs the edition-2024 Cargo feature — older toolchains fail to parse that dependency's manifest even though this crate itself is edition 2021.

```bash
make build-sensor-windows
./sensor/target/x86_64-pc-windows-msvc/release/security-sensor.exe --addr 127.0.0.1:7777
```

The sensor has no simulated mode: it runs only where real telemetry exists (Windows ETW) and refuses to start anywhere else.

## Detection rules

Rules live in `rules/` as YAML, are validated at load, and hot-reload every 15 seconds by default (disable with `-reload-every 0`).

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

Operators (v0.1): `eq`, `neq`, `contains`, `contains_any`, `startswith`, `endswith`, `regex`, `in`, `not_in`, `gt`, `lt`.

### Kill-chain correlation

Beyond per-event rules, the engine ships a sequence correlator: `sequences/*.yaml` lists named steps (exact rule names) that, when all observed on the same host inside a `window` (e.g. `5m`), raise a single high-signal alert describing the campaign. The shipped pack models credential-dump campaigns, full intrusion chains, defensive shutdown and registry-based persistence. Sequences hot-reload together with the rules. Note: suppressing a rule also removes it from every chain it feeds on that host (accepted-state semantics — see [docs/false-positive-control.md](docs/false-positive-control.md)).

The correlator is observable from the outside: `/api/sequences` lists the armed chains (steps, window, tags) as loaded right now, and `/api/stats` carries `correlator_states` (in-flight (sequence, host) chains) against `correlator_cap` (8192) — a hostile feed inventing hostnames pushes states toward the cap, and past it NEW hosts would silently stop being tracked, so the number is meant to be watched. The console surfaces both: the `correlador N/cap` chip in the header turns red the moment the cap is reached, and the Cadenas view lists each chain with its steps and flags any step whose rule is not loaded (a chain that can never complete).

### Rule actions

Rules can declare an `actions` list; the engine executes it every time the rule fires (message rendering happens before the alert is written, so the console and the JSON log line carry the rendered text):

```yaml
  actions:
    # human message attached to the alert payload (`message` field);
    # placeholders: {host} {user} {rule} {severity} {event_type} {summary}
    # notify marks the alert for external notification (`notify` field)
    - type: alert
      config:
        message: "Robo de credenciales en {host} por {user}"
        notify: "true"

    # real HTTP POST of the full alert JSON (background delivery,
    # bounded in-flight queue, never blocks detection)
    - type: webhook
      config:
        url: "https://siem.example.com/hooks/edr"
        secret: "bearer-token-optional"   # sent as Authorization: Bearer
        timeout: 5s                        # per delivery, max 30s
```

Delivery failures are logged on stderr and never surface as detection errors; a dead webhook endpoint degrades to log noise, not data loss in the engine.

## Development & CI

Every push and pull request runs the same checks the maintainers run locally (`.github/workflows/ci.yml`, three jobs):

- **Go engine** — `gofmt` (no diffs), `go build`, `go vet`, `go test -count=1 ./...`, plus the OpenAPI drift guard (`scripts/dev-tests/check_openapi.py`, spec vs. `internal/api/api.go`).
- **Console** — hub: `bun install --frozen-lockfile`, `bun test`, `tsc --noEmit`; web console: same install, `tsc --noEmit`, `next build`.
- **Sensor** — `cargo check --locked` (the crate compiles on any OS; ETW ingestion is cfg-gated to Windows and refuses to run off-Windows).

To run the equivalent suite locally (Go 1.22+, bun, cargo, python3 with PyYAML):

```bash
make ci
```

There are no mocked tests in the product path: the same rule of honesty the runtime follows applies to CI — what it verifies is what runs.

## Repository layout

```
cmd/engine/       detection engine binary (Go)
cmd/devsensor/    demo sensor for development (Go): scripted scenario,
                  simulated data - the only simulated piece in the repo
cmd/bench/        load and latency harness (measures ingest→alert p50/p99)
internal/ingest/  NDJSON TCP listener + schema validation
internal/enrich/  enrichment pipeline (context, not evidence mutation)
internal/rules/   YAML parser, rule index and evaluator
internal/correlate/  kill-chain sequence correlator
internal/alert/   alert rendering, dedup, structured JSON
internal/actions/ rule action executor (message templates, webhooks)
internal/api/     local read-only HTTP API + SSE stream + JSONL/CSV export
internal/suppress/  operator allowlist: rule/host suppressions with expiry
internal/webhook/ alert webhook delivery (bounded queue, retries)
pkg/model/        unified event schema (the wire contract)
sensor/           Rust ETW sensor (collector is Windows-gated)
rules/            seeded detection pack (windows/)
sequences/        kill-chain sequences for the correlator
suppressions.example.yaml  annotated allowlist format (rename to
                  suppressions.yaml to arm it)
scripts/windows/  installed runtime scripts (sf-sensor, sf-console, ...)
                  + bundled sysmon-config.xml tuned to the detection pack
scripts/dev-tests/ end-to-end verification scripts (OpenAPI drift check,
                  webhook receiver, ingest auth smoke with real binaries)
install.ps1       one-command Windows installer
uninstall.ps1     standalone uninstaller
Makefile          build automation (engine, sensor, console, docker)
Dockerfile        production container for the engine
docs/             architecture document, OpenAPI spec (docs/api/),
                  diagram assets and agent round reports (docs/agentes/)
web/console/          Next.js console (live feed, triage, AI analyst)
web/console-service/  realtime telemetry hub (bun + socket.io)
```

## Measured performance

The phase-1 promise (p99 < 10 ms) is now measured, not assumed. `cmd/bench` is a load and latency harness: it streams process.create events that deterministically fire one seeded rule, listens on the engine SSE stream and measures every alert on the same clock — from the NDJSON line leaving the client to the alert frame arriving, i.e. the full pipeline (ingest parse, rule evaluation, alert build, broadcast) plus the SSE hop the console experiences.

Measured with `go run ./cmd/bench -n 2000 -rate 1000` against a live engine (loopback, Linux development VM, 23 rules loaded), three consecutive runs, 2000/2000 alerts produced and sampled each time:

```
latency p50 : 133-139 µs      latency p90 : 187-211 µs
latency p99 : 319-434 µs      latency max : 0.73-5.9 ms
throughput  : ~830 ev/s sustained at that rate cap
```

Two honest caveats the harness documents by design: the numbers are loopback on a development host — a Windows endpoint under real Sysmon load will see higher ingest-side latency, and the bench measures the engine, not the sensor; and the SSE fan-out is best-effort (slow subscribers miss frames instead of stalling the engine), so a burst at unlimited speed (~128k ev/s) shows the alerts still produced 2000/2000 while the bench client's frames arrive late — backpressure, not loss.

Run it yourself against a live engine (re-runs are safe: the bench
uses a per-run host, so the engine's 60 s alert dedup never swallows
a second run; engines started with `-api-token` need the same
credential passed to the bench):

```bash
go build -o bin/bench ./cmd/bench
bin/bench -addr 127.0.0.1:7777 -api 127.0.0.1:7778 -n 2000 -rate 1000
bin/bench -addr 127.0.0.1:7777 -api 127.0.0.1:7778 -api-token <token> -n 2000
```

## Roadmap

| Phase | Window          | Delivers                                              |
|-------|-----------------|-------------------------------------------------------|
| 1     | weeks 1–6 2026  | tracer bullet, ETW sensor, rule index, p99 < 10 ms    |
| 2     | weeks 7–14 2026 | YARA memory scan, eBPF collector, SQLite  |
| 3     | weeks 15–20     | REST+OpenAPI spec, Elastic/Splunk connectors          |
| 4     | weeks 21–26     | Python filaments (sandboxed), plugins, benchmarks     |

## Contributing

Issues and PRs are welcome. Every detection PR must include: the TTP it models, the lab evidence (events produced) and the false-positive profile observed on a clean host.

## License

Apache License 2.0. See [LICENSE](LICENSE).

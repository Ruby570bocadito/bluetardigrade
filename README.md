# security-framework

A real-time threat detection framework built by an offensive-security
practitioner, informed by how actual adversary tradecraft behaves on
Windows endpoints. It combines a kernel-level ETW sensor (Rust) with a
behavioral detection engine (Go), a YAML rule format mapped to MITRE
ATT&CK, and an early web console.

> The project name is provisional. Expect a rename before v1.0.

**Status:** `v0.1` — tracer bullet plus console preview. The full
end-to-end pipeline (event → rules → alert) works today against REAL
telemetry: `sf-sensor` streams Sysmon events from the actual host and
the browser console shows only what the engine really delivers, with
AI triage. The scripted `sf-devsensor` scenario remains solely as a
clearly labeled demo to smoke-test the pipeline. ETW-native ingestion
(no Sysmon dependency) and YARA memory scanning land next (see the
roadmap in `docs/`).

## Why

Most open EDR-style sensors are either hard to extend or hard to
integrate. This project bets on three ideas:

1. **Behavior over signatures.** IOCs expire; TTPs persist. Rules
   model process trees, command lines and handle access — the noise an
   attacker actually makes.
2. **Offensive provenance.** Every seeded rule corresponds to a
   technique validated in a lab against its real TTP, and documents
   the noise it produces on a clean host.
3. **Usability is a security feature.** A detection engine nobody
   wants to operate detects nothing. NDJSON debugging with netcat,
   hot-reloaded YAML rules and an OpenAPI-first REST interface come
   before exotic features.

## Architecture (v0.1)

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
                      (phase 3)    connectors     (phase 2)
```

The unified event schema (chapter 4 of the docs) is the master
contract: sensors emit it, the engine validates and enriches it, rules
index it, interfaces consume it.

## Quickstart (tracer bullet)

Requirements: Go 1.22+.

```bash
# terminal 1 — start the engine
make run-engine

# terminal 2 — replay the demo scenario (simulated data, smoke test only)
make run-devsensor
```

Expected output on the engine terminal:

```
[ENGINE] 7 rules loaded from ./rules (types: [process.create])
[ENGINE] listening on :7777 (NDJSON, 1 event per line)
[ENGINE] api on :7778 (stats / events / alerts / rules / stream)
[ALERT] HIGH     9f31c2a4... powershell.exe -nop -w hidden -enc SQBF... host=LAB-WKS-01
[ALERT] HIGH     c1d24e9b... certutil.exe -urlcache -split -f https://... host=LAB-WKS-01
[ALERT] CRITICAL 5b7e1f38... rundll32.exe C:\Windows\...\comsvcs.dll, MiniDump... host=LAB-WKS-01
[ALERT] HIGH     e8a1c72d... schtasks.exe /create /tn MicrosoftEdgeUpdaterCore... host=LAB-WKS-01
[ALERT] HIGH     f3b2d98e... wmic.exe /node:LAB-WKS-02 process call create... host=LAB-WKS-01
[ALERT] CRITICAL a7c4e5f1... powershell.exe -c Set-MpPreference -DisableRealtimeMonitoring... host=LAB-WKS-01
[ALERT] CRITICAL b8d5f6e2... vssadmin.exe delete shadows /all /quiet host=LAB-WKS-01
```

Each alert is also emitted as a structured JSON line for downstream
consumers (SIEM connectors, the web console).

### Local HTTP API

The engine serves a small read-only API (default `:7778`, `-api 0`
disables) used by the web console and handy for SIEM taps:

| Endpoint | Returns |
|----------|---------|
| `GET /api/health` | liveness + mode |
| `GET /api/stats` | uptime, counters, per-severity totals, rule count, webhook delivery counters |
| `GET /api/events?limit=200` | recent events, newest first |
| `GET /api/alerts?limit=100` | recent alerts, newest first |
| `GET /api/rules` | live rule set (hot-reload aware) |
| `GET /api/stream` | Server-Sent Events with live events + alerts |
| `GET /api/events/export?format=jsonl\|csv` | bulk download of the event ring (JSON Lines or CSV) |
| `GET /api/alerts/export?format=jsonl\|csv` | bulk download of the alert ring (JSON Lines or CSV) |

Exports are for SIEM import, offline analysis and the forensic
store: JSONL round-trips the full records, CSV flattens them to
stable columns and neutralizes spreadsheet formula injection on
attacker-controlled fields. When `-webhook` is set, `/api/stats`
additionally reports `webhook_sent` / `webhook_failed` /
`webhook_dropped` so the delivery pipeline can be sized from the
outside.

### Alert webhook (SIEM/SOAR connector)

The engine can push every raised alert as JSON to an external HTTP
collector — a SIEM, a SOAR playbook, a chat-ops relay:

```bash
bin/engine -addr :7777 -webhook http://siem.internal:8080/ingest
```

Delivery is asynchronous and bounded: alerts queue up to 512 frames,
a single worker POSTs them with up to three attempts (transport
errors, 429 and 5xx retry; other 4xx fail fast) and a slow or down
receiver never blocks detection — saturated deliveries are counted
as dropped instead. The payload is the same structured alert the
console and the JSON log line carry, so receivers speak one format.

## One-command install (Windows)

From any PowerShell window, no admin account and no prior download
required:

```powershell
irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/install.ps1 | iex
```

The installer downloads the repository, provisions portable Go, Node
and Bun under your user profile, builds the engine and the web console,
and puts six commands on your PATH:

| Command         | What it does                                   |
|-----------------|------------------------------------------------|
| `sf-engine`     | detection engine, prints alerts live           |
| `sf-sensor`     | streams REAL host telemetry through the engine via Sysmon (`-SetupSysmon` installs it in one command) |
| `sf-devsensor`  | demo only: replays a scripted scenario (simulated data, clearly labeled; works under WDAC/Smart App Control) |
| `sf-console`    | starts the web console and opens the browser   |
| `sf-update`     | updates the code and rebuilds                  |
| `sf-uninstall`  | removes everything                             |

## Real telemetry with Sysmon (recommended)

`sf-devsensor` replays a scripted demo scenario (simulated data - the
only simulated piece in the project). To detect what actually happens
on the machine, set up Sysmon (free Microsoft telemetry driver) with
one command - accept the UAC prompt once:

```powershell
sf-sensor -SetupSysmon
```

That installs Sysmon via winget (or finds an existing copy) and applies
the bundled `sysmon-config.xml`. Manual equivalent, in an admin
terminal:

```powershell
winget install Sysinternals.Sysmon
sysmon -accepteula -i "$env:LOCALAPPDATA\security-framework\scripts\sysmon-config.xml"
```

The shipped `sysmon-config.xml` is tuned to the detection pack and
filters classic noise sources (ShimCache, UserAssist, MUICache, CDN
DNS...). Then run `sf-sensor` (normal user; elevation or membership in
the local `Event Log Readers` group is only needed to read the Sysmon
log) and open `sf-console`: the alerts you see now correspond to real
host activity - process creation, network and DNS, registry writes,
file drops, and LSASS access (credential-dump detection).

Optional switches (parameterized form):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/install.ps1))) -WithSensor -AutoStart -Firewall
```

`-WithSensor` also builds the Rust ETW sensor (needs Rust + MSVC Build
Tools), `-AutoStart` registers engine and console as logon entries
(HKCU Run, no admin required), `-Firewall` opens inbound TCP 7777 for
remote sensors and asks for elevation via UAC when needed. Install
location defaults to `%LOCALAPPDATA%\security-framework` and can be
changed with `-InstallDir <path>`.

To uninstall:

```powershell
sf-uninstall
```

or, from a machine where it is not installed (or the PATH is gone):

```powershell
irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/uninstall.ps1 | iex
```

The uninstaller stops the processes, removes the logon entries (HKCU
Run and any legacy scheduled tasks), the firewall rule, the PATH entry
and the whole install folder, including the portable toolchains it
created. Toolchains you had before are left alone.

## Web console (preview)

The repo ships an early browser console: live telemetry feed, KPI
dashboard, severity triage, the YAML rule pack and an AI analyst that
explains each alert like a senior SOC analyst would. Both the alert
queue and the live feed support free-text search (rule, host, user,
command line, MITRE tag) on top of the dropdown filters, so triage
can narrow down a noisy host or a single technique in seconds. The hub
(`web/console-service`) contains NO simulator: it forwards only what
the Go engine's API (:7778) really delivers, and the header chip names
the actual source of the events you are looking at - `sf-sensor
(Sysmon real)` for real host telemetry, or `sf-devsensor (demo)` while
the scripted scenario is replaying. If the engine is unreachable the
console says so and shows no data, instead of inventing any.

Requirements: [bun](https://bun.sh).

```bash
# terminal 1 — realtime hub (socket.io on :3003, engine bridge on :7778)
cd web/console-service && bun install && bun run dev

# terminal 2 — console (Next.js on :3000)
cd web/console && bun install && bun run dev

# optional terminal 3 — real engine to feed the console
make run-engine
```

Open http://localhost:3000. Point the UI at a remote hub with
`NEXT_PUBLIC_CONSOLE_URL=http://hub-host:3003`. The console copy is in
Spanish; see `web/console/README.md` for details.

## Building the real sensor (Windows)

Requirements: Rust stable with the `x86_64-pc-windows-msvc` target.

```bash
make build-sensor-windows
./sensor/target/x86_64-pc-windows-msvc/release/security-sensor.exe --addr 127.0.0.1:7777
```

The sensor has no simulated mode: it runs only where real telemetry
exists (Windows ETW) and refuses to start anywhere else.

## Writing rules

Rules live in `rules/` as YAML, are validated at load, and hot-reload
every 15 seconds by default (disable with `-reload-every 0`).

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

Operators (v0.1): `eq`, `neq`, `contains`, `contains_any`,
`startswith`, `endswith`, `regex`, `in`, `not_in`, `gt`, `lt`.
Sequence operators (`sequence` + `maxspan`) arrive with the
correlation engine in phase 2.

## Repository layout

```
cmd/engine/       detection engine binary (Go)
cmd/devsensor/    demo sensor for development (Go): scripted scenario,
                  simulated data - the only simulated piece in the repo
internal/ingest/  NDJSON TCP listener + schema validation
internal/enrich/  enrichment pipeline (context, not evidence mutation)
internal/rules/   YAML parser, rule index and evaluator
internal/alert/   alert rendering, dedup, structured JSON
pkg/model/        unified event schema (the wire contract)
sensor/           Rust ETW sensor (collector is Windows-gated)
rules/            seeded detection pack (windows/)
docs/             architecture document + ADRs
web/console/          Next.js console (live feed, triage, AI analyst)
web/console-service/  realtime telemetry hub (bun + socket.io)
```

## Roadmap

| Phase | Window          | Delivers                                              |
|-------|-----------------|-------------------------------------------------------|
| 1     | weeks 1–6 2026  | tracer bullet, ETW sensor, rule index, p99 < 10 ms    |
| 2     | weeks 7–14 2027 | YARA memory scan, eBPF collector, correlation, SQLite |
| 3     | weeks 15–20     | web console, REST+OpenAPI, Elastic/Splunk connectors  |
| 4     | weeks 21–26     | Python filaments (sandboxed), plugins, benchmarks     |

## Contributing

Issues and PRs are welcome. Every detection PR must include: the TTP
it models, the lab evidence (events produced) and the false-positive
profile observed on a clean host.

## License

Apache License 2.0. See [LICENSE](LICENSE).

# security-framework

A real-time threat detection framework built by an offensive-security
practitioner, informed by how actual adversary tradecraft behaves on
Windows endpoints. It combines a kernel-level ETW sensor (Rust) with a
behavioral detection engine (Go), a YAML rule format mapped to MITRE
ATT&CK, and an early web console.

> The project name is provisional. Expect a rename before v1.0.

**Status:** `v0.1` — tracer bullet plus console preview. The full
end-to-end pipeline (event → rules → alert) works today and the
browser console (`web/`) is already usable against a simulated
telemetry hub with AI triage; real ETW ingestion, YARA memory scanning
and correlation land next (see the roadmap in `docs/`).

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

# terminal 2 — replay the simulated TTP scenario
make run-devsensor
```

Expected output on the engine terminal:

```
[ENGINE] 3 rules loaded from ./rules (types: [process.create])
[ENGINE] listening on :7777 (NDJSON, 1 event per line)
[ALERT] HIGH     9f31c2a4... powershell.exe -nop -w hidden -enc SQBF... host=LAB-WKS-01
[ALERT] HIGH     c1d24e9b... certutil.exe -urlcache -split -f https://... host=LAB-WKS-01
[ALERT] CRITICAL 5b7e1f38... rundll32.exe C:\Windows\...\comsvcs.dll, MiniDump... host=LAB-WKS-01
```

Each alert is also emitted as a structured JSON line for downstream
consumers (SIEM connectors, the web console).

## One-command install (Windows)

From any PowerShell window, no admin account and no prior download
required:

```powershell
irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/install.ps1 | iex
```

The installer downloads the repository, provisions portable Go, Node
and Bun under your user profile, builds the engine and the web console,
and puts five commands on your PATH:

| Command         | What it does                                   |
|-----------------|------------------------------------------------|
| `sf-engine`     | detection engine, prints alerts live           |
| `sf-devsensor`  | replays the simulated TTP scenario             |
| `sf-console`    | starts the web console and opens the browser   |
| `sf-update`     | updates the code and rebuilds                  |
| `sf-uninstall`  | removes everything                             |

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
explains each alert like a senior SOC analyst would. It runs against a
simulated telemetry hub (the devsensor scenarios plus the three seeded
rules, ported to TypeScript), so no Windows host is required.

Requirements: [bun](https://bun.sh).

```bash
# terminal 1 — realtime hub (socket.io on :3003)
cd web/console-service && bun install && bun run dev

# terminal 2 — console (Next.js on :3000)
cd web/console && bun install && bun run dev
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

On any platform you can exercise the Rust transport with
`cargo run -- --simulate` (no kernel access needed).

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
cmd/devsensor/    simulated sensor for development (Go)
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

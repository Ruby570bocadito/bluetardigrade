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

The unified event schema (chapter 4 of the docs) is the master
contract: sensors emit it, the engine validates and enriches it, rules
index it, interfaces consume it.

Full write-up: [docs/arquitectura-tecnica-v0.1.pdf](docs/arquitectura-tecnica-v0.1.pdf)
(Spanish). It reflects the v0.1 design including the kill-chain
correlator and rule actions; it predates the ingest shared-token auth,
the export API and the OpenAPI spec, which are documented in the
[Local HTTP API](#local-http-api) section and in
[`docs/api/openapi.yaml`](docs/api/openapi.yaml). See also
[`docs/README.md`](docs/README.md) for the full design-vs-implementation
status of the document.

## Quickstart (tracer bullet)

Requirements: Go 1.22+.

```bash
# terminal 1 — start the engine
make run-engine

# terminal 2 — replay the demo scenario (simulated data, smoke test only)
make run-devsensor
```

Representative output on the engine terminal (the rule pack grows over
time, so the counts reflect the current state of `rules/`):

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

Each alert is also emitted as a structured JSON line for downstream
consumers (SIEM connectors, the web console).

![Tracer bullet pipeline: devsensor, NDJSON/TCP, engine, rules, alert](docs/assets/diagram_tracer.png)

### Local HTTP API

The engine serves a small read-only API used by the web console and
handy for SIEM taps. Both the ingest port and the API bind to
`127.0.0.1` by default: the feed carries sensitive host data (users,
command lines) and the NDJSON ingest must stay unauthenticated only on
loopback, so nothing should be reachable from other machines unless you
decide so. To accept sensors running on different hosts, start the
engine with `-addr 0.0.0.0:7777` (and `-api 0.0.0.0:7778` if the
console is remote too), enable the shared-token auth (next section),
open the port with the installer's `-Firewall` switch, and plan a
network-level restriction to the sensor segment. The API can be
disabled entirely with `-api 0`:

| Endpoint | Returns |
|----------|---------|
| `GET /api/health` | liveness + mode |
| `GET /api/stats` | uptime, counters, per-severity totals, rule count, ingest auth rejections, webhook delivery counters, active suppressions |
| `GET /api/events?limit=200` | recent events, newest first |
| `GET /api/alerts?limit=100` | recent alerts, newest first |
| `GET /api/suppressions` | operator allowlist currently active (read-only view) |
| `GET /api/alerts/export?format=ndjson\|csv&limit=256` | downloadable alert feed for SIEM/SOAR handoff, chronological order |
| `GET /api/rules` | live rule set (hot-reload aware) |
| `GET /api/stream` | Server-Sent Events with live events + alerts |
| `GET /api/events/export?format=jsonl\|csv` | bulk download of the event ring (JSON Lines or CSV) |
| `GET /api/alerts/export?format=jsonl\|csv` | bulk download of the alert ring (JSON Lines or CSV) |

All four telemetry endpoints (`/api/events`, `/api/alerts` and both
`/export` variants) accept the same filter parameters, applied BEFORE
`limit`: `host=<name>` (exact, case-insensitive), `since=`/`until=`
(RFC 3339 timestamp or positive duration like `90m`/`24h`), `q=<free
text>` (case-insensitive across ids, summaries, tags and context),
plus `severity=a,b` and `rule_id=` on the alert endpoints and `type=`
on the event ones. Invalid values answer 400 with an actionable
message. Examples: `/api/alerts/export?host=lab-wks-01&since=24h` for
"that box, today", `/api/events?type=network.connect&q=suspicious.tld`
to chase one domain.

Exports are for SIEM import, offline analysis and the forensic
store: JSONL round-trips the full records, CSV flattens them to
stable columns and neutralizes spreadsheet formula injection on
attacker-controlled fields. When `-webhook` is set, `/api/stats`
additionally reports `webhook_sent` / `webhook_failed` /
`webhook_dropped` so the delivery pipeline can be sized from the
outside; with ingest auth active (`-token`), `ingest_rejected` counts
connections rejected by the shared-token handshake. The
machine-readable contract for the whole surface lives
in OpenAPI 3.0 at [`docs/api/openapi.yaml`](docs/api/openapi.yaml).

The API can demand a bearer token: start the engine with
`-api-token '...'` (or `SF_API_TOKEN`) and every `/api/*` route —
stats, events, alerts, rules, stream, exports — answers `401` without
a valid `Authorization: Bearer <token>` header, with a loud log line
per rejected request. `/api/health` stays open on purpose: it is the
liveness probe the engine, the console bridge and uptime checks rely
on, and it reveals nothing but `{"status":"ok"}`. The console-service
bridge honors the same `SF_API_TOKEN` variable, so a token-protected
console stack needs exactly one extra environment entry. This follows
the same standard as the ingest auth: loopback stays friction-free by
default, but a listener reachable beyond loopback must never serve
telemetry without an explicit credential.

### Ingest authentication (shared token)

The NDJSON ingest supports a shared-token handshake for deployments
where sensors connect over the network. Start the engine with `-token`
or the `SF_INGEST_TOKEN` environment variable (flag wins):

```bash
sf-engine -addr 0.0.0.0:7777 -token 'pick-a-long-random-secret'
# or:  export SF_INGEST_TOKEN=...  and just run sf-engine
```

Every connection must then send `AUTH <token>` as its FIRST line
(before any event) and receive `{"ack":"ok"}`. All bundled sensors
honor it:

| Sensor | How to pass the token |
|--------|-----------------------|
| `sf-engine` | `-token <t>` flag or `SF_INGEST_TOKEN` env |
| `devsensor` (Go demo) | `-token <t>` flag or `SF_INGEST_TOKEN` env |
| `sf-sensor` (Rust/Sysmon) | `--token <t>` flag or `SF_INGEST_TOKEN` env |
| `sf-devsensor` (PowerShell demo) | `-Token <t>` param or `SF_INGEST_TOKEN` env |

Mismatch behavior is loud on purpose: a sensor with a stale token is
closed with a clear `{"ack":"error",...}` message, a sensor sending
`AUTH` to a token-less engine is closed too, and a silent client that
never authenticates is dropped after 10 seconds. The comparison is
constant-time. Loopback-only deployments without a token keep working
exactly as before (auth disabled); a non-loopback bind without a token
prints a startup warning, because any host that reaches the port could
then inject events.

**Rotating the token without downtime.** The token is static per
process, so rotation uses a two-token window: restart the engine once
with BOTH tokens, redeploy the sensors with the new one, then restart
the engine a final time with only the new token:

```bash
# 1) open the rotation window: current AND previous token both accepted
sf-engine -token 'the-new-secret' -token-previous 'the-old-secret'
# or:  SF_INGEST_TOKEN_PREVIOUS=the-old-secret  (flag wins)

# 2) redeploy sensors with the new token (any order, zero downtime:
#    sensors still on the old token keep streaming during the window)

# 3) close the window: restart the engine without -token-previous
sf-engine -token 'the-new-secret'
```

During the window the startup banner says `rotation window OPEN` so an
operator can see at a glance when a migration is still in progress.
Both comparisons are constant-time and combined without branching on
the content, so the window does not leak which token matched.

On Windows the installer can persist the token for you
(`install.ps1 -IngestToken '...'`, stored under
`tools\config\ingest.token`, cleared with an empty value): the
autostart entry, `sf-console` and `sf-devsensor` then all start the
engine with that token enforced. The installer's `-Firewall` switch
**requires** a configured token — it refuses to open TCP 7777
otherwise (and removes a rule left behind by a pre-gate install),
because a reachable ingest without a token is an open event-injection
channel for the whole network segment.

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
When the connector is active, the console header shows a delivery
chip (`webhook N / err / desc`) fed by the same counters `/api/stats`
exposes, so a silently down SIEM is visible at a glance.

### Alert suppressions (operator allowlist)

Maintenance windows and accepted exceptions happen: sometimes an alert
is correct and still unwanted. `suppressions.yaml` (see
`suppressions.example.yaml` for the annotated format) silences a rule,
a host, or a rule+host pair, with optional RFC 3339 expiration:

```yaml
- rule_id: vss-delete
  host: LAB-WKS-01
  reason: "approved change window INC-1234 (backup migration)"
  expires: 2026-10-05T06:00:00Z
```

Point the engine at it with `-suppressions <path>` (default
`./suppressions.yaml`, falling back to the install root like the rules
directory). The file hot-reloads on the same 15 s ticker as rules and
sequences: editing it is enough, no restart. Semantics worth knowing:

- A suppressed hit raises NO alert, does NOT reach the webhook, and
  does NOT feed the kill-chain correlator — a host with a silenced
  rule is treated as being in an accepted state. Each suppressed hit
  is logged as `[SUPPRESS] rule=<id> host=<host>`, never silently.
- An entry without `expires` stays active until you remove it; expired
  entries stop matching on their own.
- A malformed file is FATAL at startup (a typo must not disable a
  control you believe is armed) and rejected — keeping the previous
  set — on hot reload, loudly.
- The live set is observable read-only at `GET /api/suppressions` and
  counted in `/api/stats` (`suppressions_active`). Entries are edited
  in the YAML file, never through the API: the local API stays
  read-only.

**Outbound auth.** In shared networks the receiver should be able to
verify who is POSTing — and a leaked URL alone must not be enough to
inject alerts into your SIEM. Add a Bearer token, sent on every
delivery (retries included):

```bash
bin/engine -webhook http://siem.internal:8080/ingest \
           -webhook-token 'pick-another-long-secret'
# or:  export SF_WEBHOOK_TOKEN=...  (flag wins)
```

The receiver then validates the `Authorization: Bearer` header. Per-
rule `actions.webhook` entries keep their own independent `secret`
config (see *Rule actions*); when both are set the per-action secret
applies to that action only and the global token to the engine-level
connector. A webhook running without any token prints a startup
reminder listing the flag and the env var.

Deliveries can authenticate themselves with `-webhook-token` (or the
`SF_WEBHOOK_TOKEN` env var, flag wins): every POST then carries
`Authorization: Bearer <token>`, so a receiver that is reachable from
more than the engine's host can reject unauthenticated or spoofed
posts instead of ingesting fake alerts into the SIEM.

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
remote sensors (domain and private network profiles only) and asks for
elevation via UAC when needed; it only matters when the engine is
explicitly started with `-addr 0.0.0.0:7777`, since the default bind is
loopback. `-WebhookUrl http://siem.internal:8080/ingest` persists the
alert webhook so the engine autostart POSTs every alert there as JSON
(re-run with `-WebhookUrl ''` to clear it). Install
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

Operations dashboard: KPIs, sensor activity, top kill-chain alerts and
the live event sample in one view.

![Console operations dashboard: KPIs, sensor activity chart, kill-chain alerts and recent telemetry](docs/assets/console-panel.png)

Alert triage queue with severity badges, MITRE tags and expandable
details:

![Console alert queue: 18 alerts with severity badges, MITRE tags and kill-chain names](docs/assets/console-alertas.png)

Free-text search on top of the dropdown filters - typing narrows the
queue live (from 18 alerts to the 3 that mention `lsass`):

![Console search GIF: typing lsass filters the alert queue from 18 to 3](docs/assets/console-busqueda.gif)

The loaded rule pack, rendered with each rule's conditions and MITRE
mapping:

![Console rules view: 23 loaded rules with conditions and ATT&CK mapping](docs/assets/console-reglas.png)

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
Use **1.85 or newer**: the committed `Cargo.lock` resolves `time-core
0.1.9`, which needs the edition-2024 Cargo feature — older toolchains
fail to parse that dependency's manifest even though this crate itself
is edition 2021.

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

### Kill-chain correlation

Beyond per-event rules, the engine ships a sequence correlator:
`sequences/*.yaml` lists named steps (exact rule names) that, when all
observed on the same host inside a `window` (e.g. `5m`), raise a single
high-signal alert describing the campaign. The shipped pack models
credential-dump campaigns, full intrusion chains, defensive shutdown
and registry-based persistence. Sequences hot-reload together with the
rules.

### Rule actions

Rules can declare an `actions` list; the engine executes it every time
the rule fires (message rendering happens before the alert is written,
so the console and the JSON log line carry the rendered text):

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

Delivery failures are logged on stderr and never surface as detection
errors; a dead webhook endpoint degrades to log noise, not data loss in
the engine.

## Repository layout

```
cmd/engine/       detection engine binary (Go)
cmd/devsensor/    demo sensor for development (Go): scripted scenario,
                  simulated data - the only simulated piece in the repo
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

## Roadmap

| Phase | Window          | Delivers                                              |
|-------|-----------------|-------------------------------------------------------|
| 1     | weeks 1–6 2026  | tracer bullet, ETW sensor, rule index, p99 < 10 ms    |
| 2     | weeks 7–14 2026 | YARA memory scan, eBPF collector, SQLite  |
| 3     | weeks 15–20     | REST+OpenAPI spec, Elastic/Splunk connectors          |
| 4     | weeks 21–26     | Python filaments (sandboxed), plugins, benchmarks     |

## Contributing

Issues and PRs are welcome. Every detection PR must include: the TTP
it models, the lab evidence (events produced) and the false-positive
profile observed on a clean host.

## License

Apache License 2.0. See [LICENSE](LICENSE).

# Operations guide

Everything needed to install, configure and operate the framework: the one-command Windows install, Docker and source builds, the full configuration surface, the HTTP API and Prometheus metrics, storage, ingest authentication, alert delivery (webhook, SIEM sinks, chat/mail), alert-noise control, triage, the detection content and the CLI reference. The project overview lives in the [README](README.md); the architecture deep-dive in [ARCHITECTURE.md](ARCHITECTURE.md).

## One-command install (Windows)

Installer fixes, update preservation, recovery and current SOC limitations: [INSTALACION-Y-ESTADO-SOC.md](INSTALACION-Y-ESTADO-SOC.md).

From any PowerShell window, no admin account and no prior download required:

```powershell
irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/install.ps1 | iex
```

The installer downloads the repository, provisions portable Go, Node and Bun under your user profile, builds the engine and the web console, and puts six commands on your PATH:

| Command         | What it does                                   |
|-----------------|------------------------------------------------|
| `sf-engine`     | detection engine, prints alerts live           |
| `sf-sensor`     | streams REAL host telemetry through the engine via Sysmon (`-SetupSysmon` installs it in one command) |
| `sf-collector`  | imports observed IDS/NDR/osquery/honeypot/firewall logs and offline EML |
| `sf-console`    | starts the web console and opens the browser   |
| `sf-update`     | updates the code and rebuilds                  |
| `sf-uninstall`  | removes everything                             |

## Real telemetry with Sysmon (recommended)


Product installs contain no demo generator. Set up Sysmon to observe actual host activity; its installation asks for elevation:

```powershell
sf-sensor -SetupSysmon
```

That installs Sysmon via winget (or finds an existing copy) and applies the bundled `sysmon-config.xml`. Manual equivalent, in an admin terminal:

```powershell
winget install Sysinternals.Sysmon
sysmon -accepteula -i "$env:LOCALAPPDATA\bluetardigrade\scripts\sysmon-config.xml"
```

The shipped `sysmon-config.xml` is tuned to the detection pack and filters classic noise sources (ShimCache, UserAssist, MUICache, CDN DNS...). Then run `sf-sensor` (normal user; elevation or membership in the local `Event Log Readers` group is only needed to read the Sysmon log) and open `sf-console`: the alerts you see now correspond to real host activity - process creation, network and DNS, registry writes, file drops, and LSASS access (credential-dump detection).

Optional switches (parameterized form):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/install.ps1))) -WithSensor -AutoStart -Firewall
```

`-WithSensor` also builds the Rust ETW sensor (needs Rust + MSVC Build Tools), `-AutoStart` registers engine and console as logon entries (HKCU Run, no admin required), `-Firewall` opens inbound TCP 7777 for remote sensors (domain and private network profiles only) and asks for elevation via UAC when needed; it only matters when the engine is explicitly started with `-addr 0.0.0.0:7777`, since the default bind is loopback. `-WebhookUrl http://siem.internal:8080/ingest` persists the alert webhook so the engine autostart POSTs every alert there as JSON (re-run with `-WebhookUrl ''` to clear it). Install location defaults to `%LOCALAPPDATA%\bluetardigrade` and can be changed with `-InstallDir <path>`.

To uninstall:

```powershell
sf-uninstall
```

or, from a machine where it is not installed (or the PATH is gone):

```powershell
irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/uninstall.ps1 | iex
```

The uninstaller stops the processes, removes the logon entries (HKCU Run and any legacy scheduled tasks), the firewall rule, the PATH entry and the whole install folder, including the portable toolchains it created. Toolchains you had before are left alone.

## Docker


```bash
make docker-build
docker build -t bluetardigrade-engine . && docker run --rm -p 127.0.0.1:7777:7777 -p 127.0.0.1:7778:7778 bluetardigrade-engine
```

The image is built from the repo `Dockerfile` (Go builder pinned in the Dockerfile, alpine
runtime, non-root user) and exposes TCP 7777 (NDJSON ingest) and 7778
(HTTP API, bound to `0.0.0.0` inside the container so a console on the
host can reach it). Connect actual sensors or import provider logs using
`collector`; see [SOC integrations](SOC-INTEGRACIONES-E-INFORMES.md).

For anything beyond a local lab, set a token and publish the ports
deliberately: see [Ingest authentication](#ingest-authentication-shared-token).

## Build from source


```bash
make build          # produces bin/engine and bin/collector
./bin/engine run -i # interactive engine
./bin/collector -source suricata -observer IDS-01 -file /path/to/eve.json
```

Other Makefile targets: `make test` (Go unit tests), `make vet`,
`make fmt`, `make build-sensor` / `make build-sensor-windows` (Rust
sensor), `make docker-build`, `make console-install`,
`make console-service` and `make console`.

## Building the real sensor (Windows)


Requirements: Rust stable with the `x86_64-pc-windows-msvc` target. Use **1.85 or newer**: the committed `Cargo.lock` resolves `time-core 0.1.9`, which needs the edition-2024 Cargo feature — older toolchains fail to parse that dependency's manifest even though this crate itself is edition 2021.

```bash
make build-sensor-windows
./sensor/target/x86_64-pc-windows-msvc/release/security-sensor.exe --addr 127.0.0.1:7777
```

The sensor has no simulated mode: it runs only where real telemetry exists (Windows ETW) and refuses to start anywhere else.

## Configuration reference


Everything the engine does is a flag with a safe default; everything secret can also come from the environment. This is the full surface — there are no other knobs:

**Engine flags (`sf-engine`):**

| Flag | Default | Purpose |
|------|---------|---------|
| `-addr` | `127.0.0.1:7777` | NDJSON ingest listener (loopback unless you decide otherwise) |
| `-api` | `127.0.0.1:7778` | local API — read endpoints + the alert triage write (`0` disables it) |
| `-rules` | `./rules` | YAML rules directory (hot-reload aware) |
| `-sequences` | `./sequences` | kill-chain sequences directory (correlator) |
| `-beacons` | `./beacons.yaml` | beacon detector profiles (C2 call-home over `network.connect`; empty disables) |
| `-suppressions` | `./suppressions.yaml` | operator allowlist (hot-reload aware) |
| `-lifecycle` | `./alert-lifecycle.json` | alert triage state file (acknowledged/closed + notes; empty keeps statuses in memory only) |
| `-reload-every` | `15s` | hot-reload cadence for rules/sequences/suppressions (`0` disables) |
| `-token` / `-token-previous` | — | ingest shared token / previous token during a rotation window |
| `-ingest-cert` / `-ingest-key` | — | TLS certificate (PEM) / private key for the ingest listener (both or neither; min TLS 1.2; sensors connect with `-tls -ca`) |
| `-api-token` | — | Bearer required on every `/api/*` route and on `/metrics` (`/api/health` stays open) |
| `-api-write` | off | arm `POST`/`DELETE /api/suppressions` (writes land on the `-suppressions` file; refused beyond loopback without `-api-token`) |
| `-allow-kill` | off | arm `POST /api/respond/kill` (active response, SIGKILL fixed; REQUIRES `-api-token` even on loopback + open `-respond-audit`; falls back to `SF_ALLOW_KILL=1`) |
| `-respond-operators` | `./respond-operators.yaml` | allowlist of operators who may run active response (`{version: 1, names: [...]}`; missing = empty = everything denied; malformed = fatal; hot-reloaded) |
| `-respond-protected` | — | optional extra protected process names merged with the platform defaults (hot-reloaded) |
| `-respond-audit` | `./respond-audit.jsonl` | append-only JSONL audit, one line per attempt, fsync per line, 64 MiB ceiling |
| `-webhook` / `-webhook-token` | — | SIEM/SOAR connector URL / outbound Bearer token |
| `-elastic` / `-elastic-index` / `-elastic-api-key` | — / `sf-alerts` / — | Elasticsearch bulk indexing (daily `-YYYY.MM.DD` index, deterministic `_id`) / index prefix / API key (falls back to `SF_ELASTIC_API_KEY`) |
| `-splunk` / `-splunk-token` | — | Splunk HEC collector base URL (events POSTed to `/services/collector/event`) / HEC token (falls back to `SF_SPLUNK_TOKEN`) |
| `-store` / `-store-retention` | off / `72h` | SQLite persistence / pruning window (`0` keeps everything) |
| `-forensic` / `-forensic-dir` | on / `<forensics>` next to rules | freeze an evidence bundle (alert + 5m host timeline) for every high/critical alert, served at `GET /api/alerts/{id}/forensics`; directory capped at 256 bundles, oldest-first eviction |
| `-v` | off | print every event received |
| `-pidfile` | — | write the engine PID to a file |
| `-i`, `--interactive` | off | interactive TUI over the running engine (degrades to the classic flat run without a TTY) — see [Engine CLI reference](#engine-cli-reference) |

**Environment variables:**

| Variable | Component | Purpose |
|----------|-----------|---------|
| `SF_INGEST_TOKEN` | engine + every bundled sensor | ingest shared token (the flag wins when both are set) |
| `SF_INGEST_CA` | Rust sensor | CA bundle (PEM) the engine's TLS certificate is verified against (same as `--tls-ca`; the flag wins when both are set) |
| `SF_INGEST_TOKEN_PREVIOUS` | engine | second accepted token during a rotation window |
| `SF_API_TOKEN` | engine + console-service + web console | one entry protects the API, the bridge and the console proxy (same-origin writes, loopback-only hosts by default) |
| `SF_API_WRITE` | engine | set to `1` to arm the suppression write API (same as `-api-write`; the flag wins) |
| `SF_ALLOW_KILL` | engine | set to `1` to arm active response (same as `-allow-kill`; the flag wins; the token + audit layers still apply) |
| `SF_WEBHOOK_TOKEN` | engine | Bearer on outbound alert deliveries |
| `NO_COLOR` | engine CLI + alert rendering | any non-empty value strips ANSI color from the CLI tables/banner and from rendered alert output; the standard `no-color.org` switch (a non-TTY stdout already strips it) |
| `NEXT_PUBLIC_CONSOLE_URL` | web console | point the UI at a remote hub |
| `NEXT_PUBLIC_ENGINE_API` | web console | direct engine API base for polling (default same-origin proxy `/api/engine`) |
| `CONSOLE_ALLOWED_HOSTS` | web console | comma-separated hostnames the console proxy serves besides loopback (`localhost`/`127.0.0.1`/`::1` are always served); any other `Host` gets a `403` naming this var — the console posture mirrors the engine's: loopback friction-free, beyond loopback loud and explicit |
| `ANALYST_BASE_URL` / `ANALYST_API_KEY` / `ANALYST_MODEL` | console-service | OpenAI-compatible endpoint for the AI triage analyst |
| `PORT` / `CONSOLE_SERVICE_PORT`, `CONSOLE_HOST`, `CONSOLE_CORS_ORIGIN` | console-service | hub networking and allowed origins |

The AI analyst is optional: without the three `ANALYST_*` variables the
analyst panel says so clearly and the rest of the console keeps working.
Details in [`web/console/README.md`](../web/console/README.md).

## Local HTTP API


The engine serves a small read-only API used by the web console and handy for SIEM taps. Both the ingest port and the API bind to `127.0.0.1` by default: the feed carries sensitive host data (users, command lines) and the NDJSON ingest must stay unauthenticated only on loopback, so nothing should be reachable from other machines unless you decide so. To accept sensors running on different hosts, start the engine with `-addr 0.0.0.0:7777` (and `-api 0.0.0.0:7778` if the console is remote too), enable the shared-token auth ([next section](#ingest-authentication-shared-token)), open the port with the installer's `-Firewall` switch, and plan a network-level restriction to the sensor segment. The API can be disabled entirely with `-api 0`:

| Endpoint | Returns |
|----------|---------|
| `GET /api/health` | liveness + mode |
| `GET /metrics` | the same counters as `/api/stats` in the Prometheus text exposition format (`sf_*` families, `text/plain; version=0.0.4`) — scrapers read the credential from their `authorization` config; see [Prometheus](#prometheus-metrics) |
| `GET /api/stats` | uptime, counters, per-severity totals, rule count, ingest auth rejections, webhook delivery counters, per-platform SIEM sink counters (`elastic_*` / `splunk_*`), per-channel external notification counters (`notify_channels`), active suppressions, kill-chain correlator observability (`correlator_states` / `correlator_sequences` / `correlator_cap`), store counters (`store_enabled` / `store_events` / `store_alerts`) |
| `GET /api/events?limit=200` | recent events, newest first |
| `GET /api/alerts?limit=100` | recent alerts, newest first |
| `GET /api/suppressions` | operator allowlist currently active; `POST`/`DELETE` (only with `-api-write`) edit the same file atomically — see [Alert suppressions](#alert-suppressions-operator-allowlist) |
| `POST /api/respond/kill` | active response (C3, opt-in): kill one verified local process, operator-invoked; exists only with `-allow-kill` + API token + open audit (otherwise a real `404`) — see [Active response](#active-response-kill_process-opt-in) |
| `GET /api/respond/state` | armed state of the active-response surface: live allowlist/protected counts, the paths armed at startup and the audit file size against its 64 MiB ceiling; same real-`404` contract as the kill route |
| `GET /api/respond/audit?limit=100` | tail of the `-respond-audit` JSONL (executed AND denied attempts, newest first) with honest scan bookkeeping (`skipped`/`truncated`); hard cap 500; same real-`404` contract |
| `GET /api/sequences` | kill-chain sequences loaded by the correlator (read-only view; empty = correlator off) |
| `GET /api/events/export?format=jsonl\|csv` | bulk download of the event history — in-memory ring, or the full SQLite history with `-store` (JSON Lines or CSV) |
| `GET /api/alerts/export?format=ndjson\|csv&limit=256` | downloadable alert feed for SIEM/SOAR handoff, chronological order |
| `GET /api/alerts/{id}/forensics` | frozen alert + host timeline; `404` missing, `501` capture disabled, `500` unreadable evidence; protected by the API bearer gate |
| `GET /api/rules` | live rule set (hot-reload aware) |
| `GET /api/stream` | Server-Sent Events with live events + alerts |

All four telemetry endpoints (`/api/events`, `/api/alerts` and both `/export` variants) accept the same filter parameters, applied BEFORE `limit`: `host=<name>` (exact, case-insensitive), `since=`/`until=` (RFC 3339 timestamp or positive duration like `90m`/`24h`), `q=<free text>` (case-insensitive across ids, summaries, tags and context), plus `severity=a,b` and `rule_id=` on the alert endpoints and `type=` on the event ones. Invalid values answer 400 with an actionable message. When `-store` is attached, all four read the full stored history — not just the in-memory rings — subject to the configured retention (what that mode changes in [Persistent storage](#persistent-storage-sqlite-opt-in)). Examples: `/api/alerts/export?host=lab-wks-01&since=24h` for "that box, today", `/api/events?type=network.connect&q=suspicious.tld` to chase one domain.

Exports are for SIEM import, offline analysis and the forensic store: JSONL round-trips the full records, CSV flattens them to stable columns and neutralizes spreadsheet formula injection on attacker-controlled fields. When `-webhook` is set, `/api/stats` additionally reports `webhook_sent` / `webhook_failed` / `webhook_dropped` so the delivery pipeline can be sized from the outside; the same delivery triple is reported per SIEM platform when its sink is configured (`elastic_*` via `-elastic`, `splunk_*` via `-splunk`, semantics in [SIEM sinks](#siem-sinks-elasticsearch--splunk)); when `-notify` is set, one `notify_channels` row per configured channel reports the same four-state accounting (sent / failed / dropped / filtered) with the channel name and type; with ingest auth active (`-token`), `ingest_rejected` counts connections rejected by the shared-token handshake; when a `sequences/` directory is loaded, `correlator_states` / `correlator_sequences` / `correlator_cap` expose the kill-chain correlator's in-flight (sequence, host) chains against its hard cap (what the numbers mean and how the console surfaces them in [Kill-chain correlation](#kill-chain-correlation)); and with `-store` attached, `store_enabled` / `store_events` / `store_alerts` report the persisted history size (semantics in [Persistent storage](#persistent-storage-sqlite-opt-in)); `risk_hosts_tracked` / `hot_hosts` always report the per-host risk surface (semantics in [Host risk scoring](#host-risk-scoring-hot-hosts)), and `beacons_tracked` / `beacons_cap` / `beacons_fired` the beaconing detector's live signal (semantics in [Beaconing detection](#beaconing-detection-c2-call-home)). The machine-readable contract for the whole surface lives in OpenAPI 3.0 at [`api/openapi.yaml`](api/openapi.yaml).

The API can demand a bearer token: start the engine with `-api-token '...'` (or `SF_API_TOKEN`) and every `/api/*` route — stats, events, alerts, rules, sequences, suppressions, stream, exports — answers `401` without a valid `Authorization: Bearer <token>` header, with a loud log line per rejected request. `/metrics` is gated by the same credential, and `/api/health` stays open on purpose: it is the liveness probe the engine, the console bridge and uptime checks rely on, and it reveals nothing but `{"mode":"engine","status":"ok"}`. The console-service bridge honors the same `SF_API_TOKEN` variable, so a token-protected console stack needs exactly one extra environment entry. This follows the same standard as the ingest auth: loopback stays friction-free by default, but a listener reachable beyond loopback must never serve telemetry without an explicit credential.

## Prometheus metrics


`GET /metrics` serves the same counters as `/api/stats` in the Prometheus text exposition format (`text/plain; version=0.0.4`), one `sf_*` family per numeric stats field — `sf_events_total`, `sf_alerts_total`, `sf_events_dropped_total`, `sf_ingest_rejected_total`, `sf_webhook_*_total`, `sf_elastic_*_total`, `sf_splunk_*_total`, `sf_notify_{sent,failed,dropped,filtered}_total{channel=...}`, `sf_suppressions_active`, `sf_store_*`, `sf_correlator_*`, `sf_risk_hosts_tracked`, plus the labeled families `sf_alerts_by_severity{severity=...}` and `sf_host_risk_score{host=...}` (top-5 host risk, labels sorted and escaped like the severity series). It is rendered from the same snapshot struct the JSON endpoint serves (a parity test pins both views together), so it reveals nothing `/api/stats` does not, and the non-numeric fields (`rules_types`, `mode`) are deliberately omitted to keep series cardinality out of operator-file control. Scraping a token-protected engine works with the standard `authorization` scrape option:

```yaml
scrape_configs:
  - job_name: bluetardigrade
    metrics_path: /metrics
    authorization:
      credentials: <SF_API_TOKEN>
    static_configs:
      - targets: ['127.0.0.1:7778']
```

Worth alerting on: `sf_ingest_rejected_total` climbing (a probe against the ingest port), `sf_webhook_failed_total` climbing (a down SIEM connector), `sf_elastic_failed_total` / `sf_splunk_failed_total` climbing (a misconfigured or saturated SIEM sink), `sf_notify_failed_total` climbing (a dead chat or mail channel — the alert still fires, the operator just stops seeing it), and `sf_correlator_states` reaching `sf_correlator_cap` (a feed problem flooding the kill-chain tracker — see [Kill-chain correlation](#kill-chain-correlation)).

## Persistent storage (SQLite, opt-in)


By default the engine keeps recent telemetry in bounded in-memory rings (1000 events / 256 alerts) and that is all the API serves. Start it with `-store` to persist every event and alert to a SQLite database (pure-Go driver, WAL journalling — the Docker image and every CI job stay cgo-free):

```bash
sf-engine -store ./sf-store.db                     # retention defaults to 72h
sf-engine -store ./sf-store.db -store-retention 0  # keep everything, prune nothing
```

While the store is attached:

- The telemetry lists (`/api/events`, `/api/alerts`) and both `/export` endpoints read the **full stored history** (same filters, same wire format, subject to the configured retention) instead of the rings, so `since=24h` reaches beyond the 1000-event window. The SSE stream and the console keep their live behavior unchanged.
- `/api/stats` reports `store_enabled`, `store_events` and `store_alerts` — the counts survive a restart, because the history does: kill the engine, start it again on the same file, and the API serves everything it persisted.
- Rows older than `-store-retention` (default 72h; `0` keeps everything) are pruned on a 5-minute ticker, loudly when something is removed.
- The database (and its WAL side files) is created `0600` — full telemetry (users, command lines, file paths) must not be readable by other local users. A file that already exists keeps its mode (no surprise permission changes; tighten it yourself if it predates this change).
- A store that cannot be opened is a FATAL startup error, by the same standard as a malformed suppressions file: persistence you believe is armed must not silently stay off. Write failures at runtime are logged with a throttle and never stop detection.

## Ingest authentication (shared token)


The NDJSON ingest supports a shared-token handshake for deployments where sensors connect over the network. Start the engine with `-token` or the `SF_INGEST_TOKEN` environment variable (flag wins):

```bash
sf-engine -addr 0.0.0.0:7777 -token 'pick-a-long-random-secret'
# or:  export SF_INGEST_TOKEN=...  and just run sf-engine
```

Every connection must then send `AUTH <token>` as its FIRST line (before any event) and receive `{"ack":"ok"}`. All bundled sensors honor it:

| Sensor | How to pass the token |
|--------|-----------------------|
| `sf-engine` | `-token <t>` flag or `SF_INGEST_TOKEN` env |
| `collector` | `SF_INGEST_TOKEN` env |
| `sf-sensor` (PowerShell Sysmon) | `-Token <t>` or `SF_INGEST_TOKEN` env |
| `security-sensor.exe` (Rust) | `--token <t>` or `SF_INGEST_TOKEN` env |

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

On Windows the installer can persist the token for you (`install.ps1 -IngestToken '...'`, stored under `tools\config\ingest.token`, cleared with an empty value): the autostart entry, `sf-console` and `sf-sensor` then all start the engine with that token enforced. The installer's `-Firewall` switch **requires** a configured token — it refuses to open TCP 7777 otherwise (and removes a rule left behind by a pre-gate install), because a reachable ingest without a token is an open event-injection channel for the whole network segment.

## Ingest TLS (encryption in transit)

The shared token authenticates the sender but does not encrypt the channel: with `-addr 0.0.0.0:7777` the feed travels in clear text and carries sensitive host data (users, command lines). For remote-sensor deployments the ingest speaks native TLS — standard library only, no extra dependencies:

```bash
# engine: wrap the NDJSON listener in TLS (both flags together or neither)
sf-engine -addr 0.0.0.0:7777 -ingest-cert /etc/sf/ingest.pem -ingest-key /etc/sf/ingest-key.pem -token 'pick-a-long-random-secret'

# sensor: verify the engine against your CA and stream over the encrypted channel
collector -source suricata -observer IDS-01 -file /path/to/eve.json -addr engine.example:7777 -tls-ca /etc/sf/ingest-ca.pem # SF_INGEST_TOKEN in env
security-sensor.exe --addr engine.example:7777 --tls-ca /etc/sf/ingest-ca.pem --token 'pick-a-long-random-secret' # Rust binary
```

The installed `sf-sensor` launcher invokes the PowerShell Sysmon path; it does not accept Rust TLS flags. Use that path on loopback. Remote TLS collection uses the Rust binary or the SOC collector.

Behavior and failure modes:

- The certificate/key pair is loaded **at startup, before the bind**: a wrong path, a missing file or a mismatched pair aborts the engine with an error naming the file — a half-encrypted feed never serves traffic. Passing only one of the two flags is a startup error too (`pass both or neither`).
- TLS 1.2 is the minimum negotiated version.
- `collector -tls` verifies the engine's certificate chain against the `-tls-ca` PEM file (self-signed lab deployments pass their own CA; production deployments can use a system-trusted CA by omitting `-tls-ca`). There is deliberately **no skip-verification mode**: an encrypted channel to an unauthenticated endpoint would protect the feed from nobody. The certificate must match the hostname/IP the sensor dials (e.g. a self-signed cert needs `subjectAltName=IP:127.0.0.1` for loopback tests).
- A plain-TCP sensor dialing a TLS port fails loudly and ingests nothing, and a TLS sensor dialing a plain port fails the handshake the same way — mismatched deployments are visible, not silent.
- TLS composes with the shared-token AUTH handshake (the token travels encrypted). For untrusted networks use both layers: TLS encrypts the channel, the token authenticates the sender. The startup banner reports `ingest TLS: ENABLED (cert ...)` so the state is visible at a glance.

A lab-grade certificate (self-signed, valid for the loopback IP, usable directly as its own trust anchor):

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout ingest-key.pem -out ingest.pem -days 30 -nodes -subj "/CN=ingest-lab" \
  -addext "subjectAltName=IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,digitalSignature,keyCertSign" \
  -addext "extendedKeyUsage=serverAuth"
```

**Rotating certificates without downtime.** The engine re-reads the `-ingest-cert`/`-ingest-key` pair whenever the modification time of either file changes — no restart, no signal (the product is Windows-first and SIGHUP does not exist there). Replace the PEM files in place and the NEXT connection is wrapped with the new certificate; connections already established keep the handshake they were born with. Failure semantics are asymmetric on purpose: the first load at startup is fail-loud, but a failed REload (truncated file caught mid-copy, mismatched pair) keeps the current certificate serving and reports through the log line `ingest TLS: reload failed: keeping current certificate (reloads=N, reload_errors=N)` — a broken rotation can never degrade an encrypted channel, it just leaves it on the previous cert until the files are fixed. mtime is the change signal: a replacement that preserves the original timestamps is not detected (touch the files to force it). Sensors that pin the OLD CA in `-ca` are rejected after the rotation — redeploy them with the new CA, the same way the shared token uses its two-token rotation window.

The scripted path covering all of the above lives in `scripts/dev-tests/smoke_ingest_tls.sh` (seven scenarios: round trip, plain-vs-TLS rejection, wrong-CA rejection, TLS+token, half-set flags, missing cert, hot rotation). The Rust sensor (`sf-sensor`) speaks the same scheme with `--tls-ca <ca.pem>` (or the `SF_INGEST_CA` environment variable): every (re)connection is upgraded to TLS and the engine's certificate must chain to the given bundle — pinned CA only, no skip-verification mode, and no relay needed anymore. The host part of `--addr` is the server name the certificate is validated against (IP-SAN certificates work; the handshake phase is bounded by the same 10 s deadline as AUTH). After an engine certificate rotation a sensor pinned to the old CA is rejected exactly like its Go siblings — redeploy it with the new CA bundle.

## Alert webhook (SIEM/SOAR connector)


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

## SIEM sinks (Elasticsearch / Splunk)


For teams that run their detections straight into a SIEM platform — no relay endpoint of their own to build — the engine ships native sinks for Elasticsearch and Splunk:

```bash
# Elasticsearch: alerts bulk-indexed into a daily index
bin/engine -elastic http://elastic.internal:9200 \
           -elastic-api-key 'base64-of-your-api-key'      # or SF_ELASTIC_API_KEY

# Splunk: alerts POSTed as HEC events to the collector
bin/engine -splunk https://splunk.internal:8088 \
           -splunk-token 'your-hec-ingestion-token'       # or SF_SPLUNK_TOKEN
```

Both sinks run in parallel with the webhook and share its delivery discipline: a bounded 512-alert queue, a single worker, three attempts with linear backoff, transport errors / 429 / 5xx retried and everything else failed fast — a slow platform never stalls detection, and every sent / failed / dropped alert is counted per platform in `/api/stats` (`elastic_sent` / `elastic_failed` / `elastic_dropped`, `splunk_*`) and as `sf_elastic_*_total` / `sf_splunk_*_total` in `/metrics`. The example endpoints spell their scheme on purpose: both credentials travel in headers (`Authorization: ApiKey`, `Authorization: Splunk`), so an `http://` endpoint leaks no secret — but the alert bodies themselves cross the wire in the clear, which is fine for a trusted lab LAN and is exactly why anything routed over a network you do not control should be `https://`.

The Elasticsearch sink speaks the real Bulk API: NDJSON meta/doc pairs, `application/x-ndjson`, `Authorization: ApiKey`, one request per batch (up to 64 alerts or one flush window). Documents land in `<index>-YYYY.MM.DD` (UTC, `-elastic-index` to change the prefix, default `sf-alerts`) so retention follows the operator's index lifecycle instead of a single ever-growing index — and each document carries the alert ID as its `_id`, which makes retries idempotent: an ambiguous transport failure re-indexes the same document instead of duplicating it. The bulk answer is always parsed, because a 200 can still carry per-item rejections (mapping errors count as failed immediately, 429/5xx items are retried alone).

The Splunk sink speaks the HTTP Event Collector: one event per POST to `/services/collector/event` with `Authorization: Splunk <token>`, the full alert as the event body, and the alert's `time` (epoch seconds), `host`, `source` and `sourcetype` (`sf:alert`) at HEC level; `rule_id`, `severity`, `host` and `user` also travel as indexed `fields` so Splunk admins can search and alert on them without parsing the payload. Success requires both an HTTP 2xx AND a zero ack code — HEC reports rejected events as 200-with-code, and those are permanent failures, not retries.

Delivery semantics are at-least-once on both paths (the Elasticsearch `_id` makes them effectively deduplicated; HEC has no client-side event key, so downstream dedup can key on the alert `id` every event carries). The end-to-end delivery contract — wire shapes, auth enforcement, negative control and wrong-credential visibility — is pinned by `scripts/dev-tests/e2e_siem.sh` with its labeled lab receivers.

## External notifications (Slack, Telegram, email)


The webhook speaks JSON to machines; `-notify` speaks human to the on-call. One YAML config file arms any combination of chat and mail channels, and every raised alert — the same stream the webhook and the console see — fans out to each channel without ever blocking detection:

```bash
bin/engine -notify /etc/bluetardigrade/notify.yaml
```

```yaml
channels:
  - type: slack
    name: soc-slack              # label for stats/metrics; defaults to the type
    url: https://hooks.slack.com/services/T000/B000/XXXX
    min_severity: high           # optional floor: info < low < medium < high < critical
  - type: telegram
    token_env: SF_TG_BOT_TOKEN   # secrets resolve from the environment (literal token also accepted)
    chat_id: "-100123456789"
  - type: email
    server: smtp.internal:587
    from: sf-alerts@corp.example
    to: ["soc@corp.example", "oncall@corp.example"]
    username_env: SF_SMTP_USER
    password_env: SF_SMTP_PASS
    starttls: true               # the default: the engine refuses to downgrade to cleartext
```

Delivery follows the same discipline as the SIEM webhook: one bounded queue (256) and worker per channel, three attempts with linear backoff (transport errors, 429 and 5xx retry; definitive 4xx fail fast), and a dead channel never touches detection — its frames are counted instead. Every channel reports `sent` / `failed` / `dropped` / `filtered` on `/api/stats` (`notify_channels`) and as the labeled families `sf_notify_*_total{channel=...}` on `/metrics`; `filtered` is the operator-configured silence of a `min_severity` floor, reported as data rather than hidden.

Email transport is deliberate about plaintext: STARTTLS defaults to **on** and a relay that does not offer it is a loud startup-and-delivery refusal, not a silent downgrade; AUTH PLAIN never sends credentials over an unencrypted connection (the net/smtp loopback exception is what makes local relays testable). Chat message bodies carry the rendered human line `[SEVERITY] rule @ host — summary`; email additionally carries the full structured alert in the body so the mailbox doubles as a forensic record. The config loader is fail-loud at startup (unknown channel type, missing endpoint, unresolved secret env var, duplicate names, more than 8 channels, file above 4 MiB all stop the engine), because a notification channel that silently never fires is a silent control. The same deliberateness has a boundary the operator should know: the loader accepts `http://` for Slack and Telegram endpoints (self-hosted relays and lab LANs are legitimate), but a Slack hook URL *is* the credential and the Telegram token travels inside the request path — on any network you do not control, keep both on `https://` (their public defaults already are) so the secret never crosses the wire in cleartext.

## Alert suppressions (operator allowlist)


Maintenance windows and accepted exceptions happen: sometimes an alert is correct and still unwanted. `suppressions.yaml` (see `suppressions.example.yaml` for the annotated format) silences a rule, a host, or a rule+host pair, with optional RFC 3339 expiration. The full operator guide to alert noise — dedup semantics, suppression recipes, correlation volume, receiver-side filtering and the pipeline's abuse-resistance caps — lives in [`false-positive-control.md`](false-positive-control.md):

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
- The live set is observable at `GET /api/suppressions` and counted in `/api/stats` (`suppressions_active`).
- **API writes are opt-in**: an engine started with `-api-write` (or `SF_API_WRITE=1`) also answers `POST /api/suppressions` (add/update one entry, keyed by the rule_id+host pair) and `DELETE /api/suppressions?rule_id=…&host=…` (exact-pair removal, `404` when nothing matched). Writes go through the same validation as the YAML loader, land on the file atomically (temp + rename, preserving its mode) and are loaded back immediately — the file stays the single source of truth, so hand edits and API edits never diverge. Without the flag both routes answer `403` naming it; beyond loopback, arming is refused at startup unless `-api-token` is set. Every write logs an audit line (`WRITE suppressions add rule=… host=… by=api`) with control characters %XX-escaped, so a hostile request cannot forge engine-log lines. Hard caps shared by the API and the YAML loader bound one hostile or careless request: fields (`rule_id` 128, `host` 253, `reason` 2000 characters), 8 KiB per request body and 1000 entries per file (hand edits of the file are not capped — you already hold the pen). Contract details: [`api/openapi.yaml`](api/openapi.yaml).

## Alert triage (lifecycle)


Detecting is only half of the job — the other half is working the queue. Every alert carries a unique engine-assigned `id`, and the operator triage state travels with it:

```bash
# acknowledge an alert, with an optional note
curl -X POST http://127.0.0.1:7778/api/alerts/<id>/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"acknowledged","note":"visto, investigando","by":"ana"}'

# close it, reopen it ("new"), same endpoint — statuses: new, acknowledged, closed
```

`GET /api/alerts` merges the current status into every alert (`status`, `status_note`, `status_by`, `status_at`), a `alert_lifecycle` SSE frame announces each decision live, and the web console renders the status chips plus the reconocer/cerrar/reabrir actions in the alert panel (the write goes console → same-origin Next.js proxy → engine; the API token stays on the server). The API token gates the write endpoint exactly like every read endpoint.

Statuses persist across engine restarts with `-lifecycle <file>` (default `./alert-lifecycle.json`, falling back to the install root; `-lifecycle ""` keeps them in memory only). The file is written atomically on every decision and is FATAL to load if malformed — the same fail-loud standard as suppressions: triage work silently resetting to "new" would be a lie. One honest note on restarts: without `-store` the alert ring is in-memory, so after a restart the file preserves the audit record while the alerts it refers to are gone. With the SQLite store attached, alerts are served from the persisted history after a restart (see [Persistent storage](#persistent-storage-sqlite-opt-in)), so alert and lifecycle persist together and the triage status stays visible end to end.

## Host risk scoring (hot hosts)


Running alongside triage, the engine keeps a per-host risk score: every alert adds a fixed severity weight to its host's score — critical 10, high 5, medium 2, low 1, info 0 — and the total halves every 30 minutes without new alerts (a one-critical host is gone from the board in about three hours). `/api/stats` serves the top five as `hot_hosts` (host, score rounded to 2 decimals, alert count, last-seen) plus a `risk_hosts_tracked` count, `/metrics` renders `sf_host_risk_score{host=...}` next to `sf_risk_hosts_tracked`, and the console dashboard shows the leaders with their decay. Two deliberate design lines: the tracker's state is bounded (`MaxHosts`, coldest-evicted-first — a hostile feed inventing hostnames cannot wash out a genuinely hot one), and the score models what the engine SAW, never what the operator decided — acknowledging or closing an alert does not refund points, because queue priority and detection heat answer different questions.

## Beaconing detection (C2 call-home)


The engine also ships a behavioral detector that no single-event rule can express: beaconing. For every (profile, host, destination) triple it keeps the last 64 connection timestamps inside the profile's sliding window and measures the regularity of the inter-arrival intervals with the coefficient of variation (stddev/mean): implants sleep on a schedule, human browsing does not. When at least `min_count` connections show a CV at or under `max_jitter` with a mean interval of at least `min_interval`, exactly one alert fires — naming the destination, the observed cadence and the measured jitter, so an analyst can reproduce the verdict by hand.

Profiles live in `beacons.yaml` (committed and loaded by default; `-beacons ""` turns the detector off; a file that exists but does not parse is FATAL at startup — the same fail-loud standard as suppressions). The shipped pack is deliberately conservative: the web profile needs 12 regular connections inside a 15-minute window with a mean interval of at least 2 s — CDNs, load balancers and NTP pools are regular too, but at sub-second cadences the `min_interval` floor keeps that chatter out by construction. Detections honor the rest of the pipeline for free: profile+host suppressions, triage lifecycle, store, webhook and console, because a beacon alert is just another alert (its `rule_id` is the profile's id). The tracker's state is bounded (8192 keys, weakest-evicted-first — a flood of one-connection fake destinations can only evict other flood entries, never wash out evidence that is building), and re-fires are throttled per key by the profile's `cooldown`. `/api/stats` exposes the live signal (`beacons_tracked` / `beacons_cap` / `beacons_fired`) and `/metrics` the same families as `sf_beacon_keys_tracked` / `sf_beacon_cap` / `sf_beacons_fired_total`. The console header carries the same signal as a `beacons N/cap` chip — red the moment the cap is reached (new destinations silently stop being tracked, which is detection loss on a flooded feed) — next to the `umbrales N · M` chip that keeps the volumetric thresholds detector (A2) visible the same way, fed by `threshold_rules` / `threshold_keys` / `threshold_fired`.

## Active response (kill_process, opt-in)


The engine can act, not just detect — and the action is the most
heavily gated surface in the project (roadmap C3, iteration 1: local
`kill_process` only). An engine started with `-allow-kill` **plus** an
API token **plus** an open audit file arms `POST /api/respond/kill`:
one verified process on the engine's own host, terminated with a fixed
SIGKILL on behalf of a named human operator. Without any of the three,
the route answers a real `404` — there is no surface to probe.

Five permission layers run before every signal, and every well-formed
attempt (denied included) is written to the `-respond-audit` JSONL
**before** the signal, with fsync and a 64 MiB ceiling: the action that
cannot be proven to have happened, does not happen. The operator must
be on the `-respond-operators` allowlist; the `host` field must equal
the engine's own hostname (a console replaying a REMOTE sensor's alert
gets `host_mismatch`, never a local kill); budgets cap committed
actions (60 s cooldown per host+pid, 20/min global, 6/min per
operator); and the process guard kills the VERIFIED object, not the
number — pidfd pinning on Linux and a single verified handle on
Windows (`mechanism` in the response), with the real process name
checked per platform before anything is sent. When the Linux kernel
predates pidfd (or the syscall is blocked), the engine degrades to the
classic fallback — re-verifying the name immediately before the signal
— and the degradation is loud AND diagnosable: `fallback_reason`
carries the errno name that defeated `pidfd_open` in the response and
in the audit followup (`enosys` = old kernel, permanent and expected;
`emfile`/`enfile` = fd exhaustion of a mechanism that was alive,
transient and worth watching). PID 0/1/negative,
self/ancestor, and protected names (Windows defaults: csrss, smss,
wininit, services, lsass; extend with `-respond-protected`) are
refused with their own audit codes.

Two honest limits, in the flag text and the audit: the name check
protects against the mechanical error (wrong PID through recycling),
not against malware disguising its identity — the kill decision
belongs to the operator backed by the alert. And there is NO
automation path: rules, sequences and the correlator cannot reach
this surface; it exists because an operator called it. Contract
details: [`api/openapi.yaml`](api/openapi.yaml).

The surface is also READABLE (console visibility): `GET
/api/respond/state` reports what was armed at startup with LIVE
allowlist counts and the audit file health, and `GET
/api/respond/audit` tails the JSONL — every attempt, executed and
denied, newest first, with the lines that are not records yet counted
instead of hidden. Both extend the §2.1 contract to reads: a disarmed
engine answers a real `404`, so probing learns nothing, and both sit
behind the same bearer credential as every other `/api` read. The web
console renders both in its "Respuesta activa" view — read-only by
design (R8: the kill has no UI trigger).

Verification is three-layered: unit tests exercise both kill paths
against real child processes (native pidfd and forced fallback),
`scripts/dev-tests/e2e_respond_kill.sh` runs the full permission
matrix over real Linux binaries, and CI runs
`scripts/windows/smoke_respond.ps1` on a native Windows runner (job
`engine-windows`): real kills of throwaway processes the smoke itself
spawns, the protected set denied via a decoy `csrss.exe` in temp
(the real one is never touched — the guard refuses before signaling),
and the audit JSONL asserted end to end. The Windows handle path is
verified in conduct, not just in compilation.

## Detection rules


Rules live in `rules/` as YAML, are validated at load, and hot-reload every 15 seconds by default (disable with `-reload-every 0`). The loader carries the same house caps as every other config surface: 4 MiB per file (checked before reading), a nesting-depth pre-scan and a 2048 enabled-rules ceiling — enforced fail-loud on startup and on every hot-reload tick, so an oversized or hostile file aborts startup, or keeps the previous set on reload, instead of degrading a running engine. The shipped pack uses 69 of those 2048 slots. The shared guard also rejects cyclic aliases and caps projected expansion and composed flow depth before typed decoding.

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

Operators (17): case-sensitive `eq`, `neq`, `contains`, `contains_any`, `startswith`, `endswith`, `regex`, `in`, `not_in`, `gt`, `lt`, plus the case-insensitive `i*` family — `ieq`, `icontains`, `icontains_any`, `istartswith`, `iendswith`, `iin` — which shares one Unicode folding semantics across all six operators and the `(?i)` regex fallback (the same property the Sigma mapping table below relies on).

The enabled rule inventory is generated from the YAML files themselves:
`python3 scripts/dev-tests/check_rule_inventory.py --write`. CI checks it on
every change. Artifact rules have positive/negative fixtures; Windows lab
validation and environment-specific noise tuning remain separate checks.

<!-- BEGIN RULE INVENTORY -->
The enabled pack contains **69 rules across 12 event types**: 16 critical / 37 high / 13 medium / 1 low / 2 info.
Full IDs are retained because different rules in a pack can share a UUID prefix.

| ID | Rule | Severity | Event type | ATT&CK | Tactic |
|----|------|----------|------------|--------|--------|
| `a1b2c3d4-0004-4a04-9e04-040404040404` | Abuso de Kerberos con Rubeus | critical | `process.create` | T1558.003 | credential-access |
| `d37e8fa6-b0cf-42d3-f4e5-6a7b8c9dae10` | Acceso a memoria de LSASS | critical | `process.access` | T1003.001 | credential-access |
| `b8d5f6e2-0e39-4c47-9a58-2f6b0d4e7c44` | Borrado de instantaneas VSS | critical | `process.create` | T1490 | impact |
| `c3d4e5f6-0002-4c02-9e02-020202020202` | Borrado de instantaneas VSS con wmic | critical | `process.create` | T1490 | impact |
| `c3d4e5f6-0001-4c01-9e01-010101010101` | Borrado del registro de eventos con PowerShell | critical | `process.create` | T1070.001 | defense-evasion |
| `a1b2c3d4-0002-4a02-9e02-020202020202` | Cosecha de contrasenas con LaZagne | critical | `process.create` | T1003 | credential-access |
| `a1b2c3d4-0003-4a03-9e03-030303030303` | Dumping local de hashes con Pwdump | critical | `process.create` | T1003.002 | credential-access |
| `b2c3d4e5-0005-4b05-9e05-050505050505` | Editor de Office lanzando un interprete | critical | `process.create` | T1566.001 | execution |
| `a1b2c3d4-0001-4a01-9e01-010101010101` | Herramienta de volcado Mimikatz | critical | `process.create` | T1003.001 | credential-access |
| `a7c4e5f1-9d28-4b36-8f47-1e5a9c3d6b33` | Manipulacion de Windows Defender | critical | `process.create` | T1562.001 | defense-evasion |
| `c3d4e5f6-0003-4c03-9e03-030303030303` | Reduccion de almacenamiento VSS con vssadmin o PowerShell | critical | `process.create` | T1490 | impact |
| `a1b2c3d4-0008-4a08-9e08-080808080808` | Stager de Meterpreter o Metasploit | critical | `process.create` | T1059 | execution |
| `4f7b0d26-9e58-4c3f-a112-6b9d4e8f3c66` | Volcado de LSASS con procdump | critical | `process.create` | T1003.001 | credential-access |
| `5b7e1f38-2c94-4d0a-b6e7-19a8c3d54f02` | Volcado de LSASS via comsvcs.dll | critical | `process.create` | T1003.001 | credential-access |
| `c3d4e5f6-0006-4c06-9e06-060606060606` | Volcado de ntds.dit con ntdsutil | critical | `process.create` | T1003.003 | credential-access |
| `3e6a9c15-8d47-4b2e-9f01-5a8c3d7e2b55` | Volcado del registro SAM | critical | `process.create` | T1003.002 | credential-access |
| `d4e5f607-1006-4a00-8000-000000000006` | Artefacto de volcado de LSASS escrito en disco | high | `file.write` | T1003.001 | credential-access |
| `8dbf416a-d29c-4073-a556-afd182cd70aa` | Borrado de registros de eventos | high | `process.create` | T1070.001 | defense-evasion |
| `c3d4e5f6-0005-4c05-9e05-050505050505` | Borrado del diario USN con fsutil | high | `process.create` | T1070.005 | defense-evasion |
| `a1b2c3d4-0009-4a09-9e09-090909090909` | Canal de control remoto silencioso con AnyDesk | high | `process.create` | T1219 | command-and-control |
| `d4e5f607-1005-4a00-8000-000000000005` | Contenido activo en el inicio automatico de Office | high | `file.write` | T1137 | persistence |
| `soc-honeypot-login` | Cowrie: acceso aceptado en el honeypot | high | `honeypot.login` | T1078 |  |
| `soc-honeypot-command` | Cowrie: comando observado en la sesion | high | `honeypot.command` | T1059 |  |
| `b2c3d4e5-0007-4b07-9e07-070707070707` | Cradle de descarga en PowerShell | high | `process.create` | T1059.001 | execution |
| `e8a1c72d-4b6f-4f39-9a52-0d3b7c5f1a11` | Creacion de tarea programada | high | `process.create` | T1053.005 | persistence |
| `8e2f3a51-6b7c-4d8e-af90-1b2c3d4e5f60` | Defensa antivirus desactivada via registro | high | `registry.set` | T1562.001 | defense-evasion |
| `7cae3059-c18b-4f62-9445-9ec071bc6f99` | Desactivacion del firewall de Windows | high | `process.create` | T1562.004 | defense-evasion |
| `c1d24e9b-7a03-4c56-9f11-8e2b5a4d9c73` | Descarga con certutil o bitsadmin | high | `process.create` | T1105 | command-and-control |
| `b2c3d4e5-0002-4b02-9e02-020202020202` | Ejecucion de JavaScript con rundll32 | high | `process.create` | T1218.011 | defense-evasion |
| `f3b2d98e-7c15-4a58-8e0a-2c4d6e8f0b22` | Ejecucion de procesos via WMI | high | `process.create` | T1047 | execution |
| `b2c3d4e5-0001-4b01-9e01-010101010101` | Ejecucion de scripts con mshta | high | `process.create` | T1218.005 | defense-evasion |
| `5a8c1e37-af69-4d40-b223-7cae5f9a4d77` | Ejecucion de scripts con regsvr32 | high | `process.create` | T1218.010 | defense-evasion |
| `b2c3d4e5-0003-4b03-9e03-030303030303` | Ejecucion evasiva con InstallUtil | high | `process.create` | T1218.001 | defense-evasion |
| `b2c3d4e5-0004-4b04-9e04-040404040404` | Ejecucion indirecta con forfiles | high | `process.create` | T1202 | defense-evasion |
| `a1b2c3d4-0007-4a07-9e07-070707070707` | Ejecucion remota con CrackMapExec o Impacket | high | `process.create` | T1021 | lateral-movement |
| `b15c6d84-9eaf-40b1-d2c3-4e5f6a7b8c90` | Ejecutable disfrazado de documento | high | `file.write` | T1036.007 | defense-evasion |
| `a04b5c73-8d9e-4fa0-c1b2-3d4e5f6a7b80` | Ejecutable soltado en carpeta de inicio | high | `file.write` | T1547.001 | persistence |
| `a1b2c3d4-0006-4a06-9e06-060606060606` | Enumeracion de directorio con AdFind | high | `process.create` | T1087.002 | discovery |
| `9f3a4b62-7c8d-4e9f-b0a1-2c3d4e5f6a70` | Exclusiones de Defender anadidas via registro | high | `registry.set` | T1562.001 | defense-evasion |
| `c3d4e5f6-0007-4c07-9e07-070707070707` | Falsificacion de marcas de tiempo de ficheros | high | `process.create` | T1070.006 | defense-evasion |
| `6b9d2f48-b07a-4e51-8334-8dbf60ab5e88` | Instalacion remota con msiexec | high | `process.create` | T1218.005 | defense-evasion |
| `b2c3d4e5-0006-4b06-9e06-060606060606` | Interprete de script ejecutando desde staging de usuario | high | `process.create` | T1204.002 | execution |
| `d4e5f607-1002-4a00-8000-000000000002` | Interprete escribe una DLL en una ruta temporal | high | `file.write` | T1574.001 | defense-evasion |
| `a1b2c3d4-0005-4a05-9e05-050505050505` | Mapeo de dominio con SharpHound | high | `process.create` | T1087.002 | discovery |
| `afd1638c-f4be-4295-c778-cfa36a4ef92c` | Movimiento lateral con PsExec | high | `process.create` | T1021.002 | lateral-movement |
| `b2c3d4e5-0008-4b08-9e08-080808080808` | Navegador lanzando un interprete de comandos | high | `process.create` | T1203 | execution |
| `soc-ndr-public-smb` | NDR: SMB hacia una direccion publica | high | `network.connect` | T1021.002 |  |
| `d4e5f607-1001-4a00-8000-000000000001` | Office escribe un payload en una ruta de usuario | high | `file.write` | T1204.002 | execution |
| `9ec0527b-e3ad-4184-b667-be92593de81b` | Persistencia en clave Run | high | `process.create` | T1547.001 | persistence |
| `7d1e2f40-5a6b-4c7d-9e8f-0a1b2c3d4e5f` | Persistencia en clave Run via registro | high | `registry.set` | T1547.001 | persistence |
| `9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40` | PowerShell con comando codificado | high | `process.create` | T1059.001 | execution |
| `c3d4e5f6-0004-4c04-9e04-040404040404` | Sabotaje de recuperacion de arranque con bcdedit | high | `process.create` | T1490 | impact |
| `soc-ids-priority-high` | Suricata: firma de prioridad alta | high | `network.alert` |  |  |
| `c3d4e5f6-0008-4c08-9e08-080808080808` | Borrado dirigido de artefactos forenses de Windows | medium | `process.create` | T1070.004 | defense-evasion |
| `e48f9ab7-c1d0-43e4-a5f6-7b8c9daebf21` | Consulta DNS a dominio generado (posible DGA) | medium | `network.connect` | T1568.002 | command-and-control |
| `d4e5f607-1003-4a00-8000-000000000003` | DLL candidata a carga lateral descargada o extraida | medium | `file.write` | T1574.001 | defense-evasion |
| `c26d7e95-afbe-41c2-e3d4-5f6a7b8c9da0` | DLL cargada desde ruta de usuario | medium | `image.load` | T1574.001, T1574.002 | privilege-escalation |
| `soc-firewall-admin-allow` | Firewall: conexion administrativa entrante permitida | medium | `network.firewall` |  |  |
| `d4e5f607-1004-4a00-8000-000000000004` | Modificacion de un perfil de PowerShell | medium | `file.write` | T1546.013 | persistence |
| `soc-ndr-public-rdp` | NDR: RDP hacia una direccion publica | medium | `network.connect` | T1021.001 |  |
| `soc-osquery-admin-listener` | osquery: nuevo puerto administrativo en todas las interfaces | medium | `host.query` |  |  |
| `soc-mail-risky-attachment` | Phishing: adjunto de extension activa | medium | `email.message` | T1566.001 |  |
| `soc-mail-dmarc-fail` | Phishing: fallo DMARC declarado en cabecera | medium | `email.message` | T1566 |  |
| `soc-mail-ip-url` | Phishing: URL con direccion IP literal | medium | `email.message` | T1566.002 |  |
| `a1b2c3d4-000a-4a0a-9e0a-0a0a0a0a0a0a` | Reconocimiento de dominio con comandos net/nltest | medium | `process.create` | T1087.002 | discovery |
| `soc-ids-priority-medium` | Suricata: firma de prioridad media | medium | `network.alert` |  |  |
| `soc-mail-reply-mismatch` | Phishing: Reply-To de otro dominio | low | `email.message` | T1566 |  |
| `soc-firewall-admin-drop` | Firewall: intento administrativo entrante descartado | info | `network.firewall` |  |  |
| `soc-ips-reported-drop` | Suricata: bloqueo declarado por el proveedor | info | `network.alert` |  |  |
<!-- END RULE INVENTORY -->

Nota: los nombres de reglas y secuencias se mantienen en espanol, tal
como viven en los YAML del repositorio; no se traducen en la doc.


### Kill-chain correlation

Beyond per-event rules, the engine ships a sequence correlator: `sequences/*.yaml` lists named steps (exact rule names) that, when all observed on the same host inside a `window` (e.g. `5m`), raise a single high-signal alert describing the campaign. The shipped pack models credential-dump campaigns, full intrusion chains, defensive shutdown and registry-based persistence. Sequences hot-reload together with the rules. Load-time caps keep the config surface bounded (4 MiB/file, nesting depth 512, 512 sequences, 64 steps/chain, window ≤ 7 days, id/name/tag length caps, no control runes in strings that reach logs or alerts): an oversized or hostile file fails the load loudly instead of degrading a running engine. Steps naming rules that do not exist are reported as a WARNING at startup and on every reload, because a chain waiting on a ghost rule can never complete. Note: suppressing a rule also removes it from every chain it feeds on that host (accepted-state semantics — see [docs/false-positive-control.md](false-positive-control.md)).

The shipped pack (`sequences/kill-chains.yaml`) defines 4 sequences, all
`critical`, window `5m`:

| ID | Sequence | Severity | Window | Steps (rules, unordered) |
|----|----------|----------|--------|--------------------------|
| `c0a5e7d1-1a2b-4c3d-8e4f-a5b6c7d8e9f0` | Campana de robo de credenciales | critical | 5m | Volcado de LSASS via comsvcs.dll + Volcado de LSASS con procdump + Volcado del registro SAM |
| `d1b6f8e2-2b3c-4d4e-9f50-b6c7d8e9f0a1` | Campana de intrusion completa | critical | 5m | Descarga con certutil o bitsadmin + Creacion de tarea programada + Borrado de instantaneas VSS |
| `e2c7a9f3-3c4d-4e5f-a061-c7d8e9f0a1b2` | Apagon defensivo | critical | 5m | Manipulacion de Windows Defender + Desactivacion del firewall de Windows + Borrado de registros de eventos |
| `f3d8ba64-4d5e-4f60-b172-d8e9f0a1b2c3` | Instalacion de persistencia | critical | 5m | Descarga con certutil o bitsadmin + Persistencia en clave Run via registro |

The correlator is observable from the outside: `/api/sequences` lists the armed chains (steps, window, tags) as loaded right now, and `/api/stats` carries `correlator_states` (chains in flight, one per sequence/host pair), `correlator_sequences` (loaded sequences) and `correlator_cap` (hard tracking cap, 8192). A hostile feed inventing hostnames drives `correlator_states` toward the cap — past it, NEW hosts silently stop being tracked, so a value climbing on a small fleet is a feed problem, not popularity. The console surfaces both: the `correlador N/cap` chip in the header turns red the moment the cap is reached, and the Cadenas view renders each chain as its step sequence and flags any step whose rule is not loaded (a chain that can never complete).

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

### Converting Sigma rules

`engine sigma` converts [Sigma](https://sigma.is) YAML rules into the native format above, so the community corpus can feed `rules/` without hand-transcription. The converter is **deterministic** (same corpus → byte-identical output) and **fail-loud**: a rule using a construct the engine cannot express faithfully is skipped with an explicit reason in the report, never translated approximately — a broken YAML file aborts the run instead of silently converting the rest.

```bash
engine sigma -dir ./corpus-sigma -out rules/converted.yaml
engine sigma -dir ./corpus-sigma -strict   # exit 1 if anything is skipped
```

What converts (v1 scope):

| Sigma | Native |
|-------|--------|
| `level` | `severity` (`informational` → `info`; missing level → skipped) |
| logsource category | `event_type`: `process_creation`→`process.create`, `file_event`→`file.write`, `network_connection`→`network.connect`, `registry_*`→`registry.set`, `image_loaded`/`driver_load`→`image.load`, `process_access`→`process.access` (Windows product only) |
| field names | the normalized schema (`Image`→`process.image`, `CommandLine`→`process.command_line`, `TargetObject`→`registry.key`, `DestinationIp`→`network.destination_ip`, …) — a field with no real equivalent skips the rule, naming it |
| wildcards | `*x*`→`contains`, `x*`→`startswith`, `*x`→`endswith`, exact→`eq`, anything else→anchored `regex` (literals escaped, `?`→`.`); values with letters use the case-insensitive `i*` family instead (`icontains`, `ieq`, …) and the regex fallback carries `(?i)` — Sigma string matching is case-insensitive by corpus convention, and all three paths share one Unicode folding semantics |
| value lists | `in` / `contains_any`, or a single alternation regex that keeps per-element anchoring |
| `condition` | `A`, `A and B…`, `A or B…`, `1 of them`, `all of them`, `1 of prefix*` — same-field ORs merge into one rule (`contains_any`/`in`), different-field ORs split into one rule per branch; `not`, parentheses and mixed `and/or` are skipped |
| modifiers | `contains`, `startswith`, `endswith`, `re`, `gt`, `lt` — encoding modifiers (`base64*`, `utf16*`, `wide`), `all` and `exists` are skipped |

Provenance travels in the converted rule: author, status, date, references and declared false positives are folded into the description (`[Sigma] …` line), the Sigma UUID stays as the rule `id`, and a `sigma` tag is prepended so imported rules are identifiable in `engine rules`, the console and the API. Bounds apply to the whole run (4 MiB per file, 512 emitted rules, per-rule caps on selections/fields/condition length). The E2E (`scripts/dev-tests/e2e_sigma.sh`) converts a committed fixture corpus and proves the converted rules fire on real telemetry through the engine's TCP feed.

## Engine CLI reference


The engine binary is `engine` (`make build` puts it in `bin/`; the
Windows installer installs it as `sf-engine`). Subcommands:

| Command | What it does |
|---------|--------------|
| `engine run [flags]` | start the full pipeline: ingest, enrichment, rules, correlator, suppressions, API, webhook |
| `engine rules [-rules dir]` | print the loaded rule pack as a table and exit |
| `engine validate [-rules dir] [-sequences dir]` | validate rules and sequences, print a report; exit code 0 when everything loads, non-zero on error (CI-friendly) |
| `engine sigma -dir dir-or-file [-out file] [-strict]` | convert a Sigma corpus to the native rule format; report lists every skipped rule with its reason; exit 0 only with at least one conversion (and, under `-strict`, zero skips) |
| `engine version` | print the engine version and exit |

### Interactive terminal

Run `engine run -i` in a terminal. `1` / `2` / `Tab` switch between alerts
and the rule catalogue; `/` searches, `s` cycles severity, `Enter` opens
details, and `↑↓` / `PgUp` / `PgDown` / `Home` / `End` navigate.
`p` or space pauses only the presentation; detection, API and delivery
keep running. `Esc` returns or clears filters, `?` opens help, and
`q` / `Ctrl+C` stop the engine.

The panel retains 100 alerts and keeps historical selection steady.
Human output neutralizes telemetry control characters; structured evidence
is preserved. Webhook banners expose only scheme and host. Routed commands
reject unexpected positional arguments; the classic invocation is preserved.

### `engine run` flags

Every runtime flag below works identically on the classic single-dash
path (no subcommand) and on `engine run`.

| Flag | Default | Meaning |
|------|---------|---------|
| `-addr host:port` | `127.0.0.1:7777` | NDJSON ingest listen address (`0.0.0.0:7777` to accept remote sensors) |
| `-api host:port` | `127.0.0.1:7778` | read-only HTTP API; `0` disables it |
| `-rules dir` | `./rules` | rules directory (falls back to the directory next to the executable) |
| `-sequences dir` | `./sequences` | kill-chain sequences directory for the correlator |
| `-beacons file` | `./beacons.yaml` | beacon detector profiles (C2 call-home over `network.connect`; empty disables) |
| `-thresholds file` | `./thresholds.yaml` | volumetric threshold definitions (A2: alert when N predicate-matching events accumulate in one window, optionally grouped by a field); a definition without `group_by` aggregates every matching event under one internal key — the alert's host is whichever event crossed the threshold; missing file disables, malformed file is fatal, hot-reloaded |
| `-v` | off | print every event received |
| `-reload-every dur` | `15s` | hot-reload interval for rules, sequences and suppressions; `0` disables |
| `-webhook url` | empty | POST every alert as JSON to this URL (SIEM/SOAR connector) |
| `-webhook-token t` | empty | Bearer token on every webhook delivery (falls back to `SF_WEBHOOK_TOKEN`) |
| `-elastic url` | empty | Elasticsearch base URL; alerts bulk-indexed into `<index>-YYYY.MM.DD` with the alert ID as deterministic `_id` — see [SIEM sinks](#siem-sinks-elasticsearch--splunk) |
| `-elastic-index prefix` | `sf-alerts` | index name prefix used with `-elastic` |
| `-elastic-api-key k` | empty | Elasticsearch API key sent as `Authorization: ApiKey` (falls back to `SF_ELASTIC_API_KEY`); empty disables the header |
| `-splunk url` | empty | Splunk HEC collector base URL; alerts POSTed to `/services/collector/event` — see [SIEM sinks](#siem-sinks-elasticsearch--splunk) |
| `-splunk-token t` | empty | Splunk HEC token sent as `Authorization: Splunk` (falls back to `SF_SPLUNK_TOKEN`); empty disables the header |
| `-api-token t` | empty | bearer token the local API requires on `/api/*` and `/metrics` (falls back to `SF_API_TOKEN`); `/api/health` stays open |
| `-api-write` | off | arm `POST`/`DELETE /api/suppressions` (falls back to `SF_API_WRITE=1`); writes go to the `-suppressions` file, which stays the source of truth; refused at startup when the API has no token beyond loopback |
| `-allow-kill` | off | arm `POST /api/respond/kill` (falls back to `SF_ALLOW_KILL=1`): active response, kill_process, SIGKILL fixed; REQUIRES `-api-token`/`SF_API_TOKEN` even on loopback and an openable `-respond-audit` (otherwise the surface stays disabled, loud); the name check protects against killing the wrong PID, not against malware disguising its identity |
| `-respond-operators file` | `./respond-operators.yaml` | YAML allowlist (`{version: 1, names: [ana, beto]}`) of operators allowed to run active response; missing file = empty allowlist = every action denied; malformed file is fatal; hot-reloaded on the `-reload-every` ticker |
| `-respond-protected file` | empty | optional YAML (`{version: 1, names: [...]}`) with extra protected process names, merged with the platform defaults (Windows: csrss/smss/wininit/services/lsass); malformed file is fatal; hot-reloaded |
| `-respond-audit file` | `./respond-audit.jsonl` | append-only JSONL audit file, one line per attempt (denials included), fsync per line, 64 MiB ceiling: beyond it every action denies with `audit_unavailable` until the file is rotated |
| `-token t` | empty | shared ingest token (falls back to `SF_INGEST_TOKEN`); empty disables auth |
| `-token-previous t` | empty | previous ingest token, still accepted during a rotation window (falls back to `SF_INGEST_TOKEN_PREVIOUS`) |
| `-suppressions file` | `./suppressions.yaml` | operator allowlist YAML silencing rule/host pairs (expirations supported); empty disables |
| `-store path` | empty | SQLite file persisting events and alerts beyond the in-memory rings (e.g. `./sf-store.db`); empty disables — see [Persistent storage](#persistent-storage-sqlite-opt-in) |
| `-store-retention dur` | `72h` | delete stored events/alerts older than this on a 5-minute ticker; `0` keeps everything |
| `-forensic` | `true` | freeze evidence bundles (alert + 5-minute host timeline) for high/critical alerts; `-forensic=false` disables capture and the API answers `501` |
| `-forensic-dir path` | `<forensics>` next to the rules directory | where evidence bundles are written (atomic per bundle, capped at 256 files) |
| `-pidfile path` | empty | write the process PID at startup and remove it on shutdown (lets `sf-console -Stop` stop an engine it did not start) |
| `-i`, `--interactive` | off | interactive TUI: live stats and alert feed in the terminal (degrades to the classic flat run when stdout is not a TTY) |

### Backward compatibility

Invoking the binary without a subcommand keeps the historical behavior:
the single-dash flags above apply directly, exactly as in `engine run`:

```bash
bin/engine -addr :7777 -v    # same as: bin/engine run -addr :7777 -v
bin/engine run -i            # interactive TUI
```

## Development & CI


Every push and pull request runs the same checks the maintainers run locally (`.github/workflows/ci.yml`, three jobs):

- **Go engine** — `gofmt` (no diffs), `go build`, `go vet`, `go test -race -count=1 ./...` (the engine is concurrent by design — G3 landed in CI), plus the OpenAPI drift guard (`scripts/dev-tests/check_openapi.py`, spec vs. `internal/api/api.go`) and the guard's self-test (`--self-test`: one positive plus thirteen negative fixtures that must produce findings).
- **Console** — hub: `bun install --frozen-lockfile`, `bun test`, `tsc --noEmit`; web console: same install, `bun test` (G1 landed in CI), `tsc --noEmit`, `next build`.
- **Sensor** — `cargo check --locked` on two targets: the host and a Windows cross-check (`--target x86_64-pc-windows-msvc`, type/borrow check without linking — the ETW collector is Windows-first and this is the only way to verify it still compiles without a Windows host). The crate itself compiles on any OS; ETW ingestion is cfg-gated to Windows and refuses to run off-Windows.

Nightly (`.github/workflows/bench-nightly.yml`, also triggerable by hand), the pipeline bench runs the **real** engine over loopback with the documented baseline parameters (`scripts/dev-tests/bench -n 2000 -rate 1000`) in two passes on the same clock: a **rings** baseline, and a second identical pass with `-store` attached to a fresh SQLite file so the persistence overhead is measured, not assumed. The run summary records p50/p99 for both passes plus the store-overhead delta as data, alongside the runner identity and an fsync 4k dsync probe of the same medium the sqlite pass wrote to — the environment class that dominates the persistence tail, recorded per run because it is a datum of that run, not a property of the machine (the same role measured a 15.8 ms stalls-class tail one round and a 1.8 ms fast-fsync tail the next). The contract is enforced identically in each pass, and it is **advisory by design** (Director decision 6.2): a p99 at or above the phase-1 contract (< 10 ms) raises a warning annotation for the next review, but never fails the job — only a pipeline completeness failure (lost alerts, in either pass) turns the run red, because that is a functional defect, not a performance one. The same script runs locally: `bash scripts/dev-tests/bench_nightly.sh` (ports 7777/7778 free).

To run the equivalent suite locally (Go 1.26+, bun, cargo via rustup, python3 with PyYAML):

```bash
make ci
```

Runtime telemetry is received from sensors/providers. Automated unit, DOM and browser checks use isolated fixtures; native smokes run actual binaries. These checks do not certify a live provider deployment.

## Measured performance


The phase-1 promise (p99 < 10 ms) is now measured, not assumed. `scripts/dev-tests/bench` is a load and latency harness: it streams process.create events that deterministically fire one seeded rule, listens on the engine SSE stream and measures every alert on the same clock — from the NDJSON line leaving the client to the alert frame arriving, i.e. the full pipeline (ingest parse, rule evaluation, alert build, broadcast) plus the SSE hop the console experiences.

Measured with `go run ./scripts/dev-tests/bench -n 2000 -rate 1000` against a live engine (loopback, Linux development VM, 23 rules loaded), three consecutive runs, 2000/2000 alerts produced and sampled each time:

```
latency p50 : 133-139 µs      latency p90 : 187-211 µs
latency p99 : 319-434 µs      latency max : 0.73-5.9 ms
throughput  : ~830 ev/s sustained at that rate cap
```

Two honest caveats the harness documents by design: the numbers are loopback on a development host — a Windows endpoint under real Sysmon load will see higher ingest-side latency, and the bench measures the engine, not the sensor; and the SSE fan-out is best-effort (slow subscribers miss frames instead of stalling the engine), so a burst at unlimited speed (~128k ev/s) shows the alerts still produced 2000/2000 while the bench client's frames arrive late — backpressure, not loss.

The nightly's second pass quantifies what the opt-in SQLite store costs on that same clock: in its most recent run, p99 moved from 365 µs (rings) to 870 µs with `-store` attached — a +505 µs (+138%) overhead recorded as data, not a verdict, with both passes still far inside the phase-1 contract. That is the price of the durable history described in [Persistent storage](#persistent-storage-sqlite-opt-in); the caveat above about real endpoints applies to both passes equally.

Run it yourself against a live engine (re-runs are safe: the bench
uses a per-run host, so the engine's 60 s alert dedup never swallows
a second run; engines started with `-api-token` need the same
credential passed to the bench):

```bash
go build -o bin/bench ./scripts/dev-tests/bench
bin/bench -addr 127.0.0.1:7777 -api 127.0.0.1:7778 -n 2000 -rate 1000
bin/bench -addr 127.0.0.1:7777 -api 127.0.0.1:7778 -api-token <token> -n 2000
```

## SOC imports and analyst reports

See [SOC-INTEGRACIONES-E-INFORMES.md](SOC-INTEGRACIONES-E-INFORMES.md) for the six collector formats, TLS/auth requirements, osquery schedule, Windows firewall timezone and offline phishing analysis. Reports contain analyst statements plus a frozen alert snapshot; they do not execute actions or change triage. Browser drafts are local to this origin, with ten report slots and explicit save/export/delete.

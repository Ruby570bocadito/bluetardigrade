# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
from 1.0 on, breaking changes to the event schema or the HTTP API come only in a
major version (the schema contract itself is documented in the OpenAPI spec and
guarded in CI). The version reported by `engine version` is
injected at link time from the release tag — see `.github/workflows/release.yml`
and the `make dist` target.

## [Unreleased]

### Privacy audit trails, a publishing audit lane and the bilingual fleet view (2026-10-22)

- **Privacy (SEC-9): reading a user's record leaves a trace, and everything personal expires.** `GET /api/ad/objects/user` now audits every read in the new `ad_read_audit` table — who (the account the console declares via `X-SF-Account`, built server-side, or the remote on direct calls), when, the needle searched for and the outcome; groups, computers and OUs are not personal records and leave no row. Store retention (`-store-retention`) now also covers `query_audit`, `ad_read_audit` and `ad_posture_history`, with second-granularity cutoffs for the audit tables. Domain sign-in `[AUTH]` lines keep the truncated account, never the raw entry.
- **`deps-audit` publishes real cargo audit reports.** The scan job gains job-level `checks: write` (`issues: write` deliberately left out, least privilege), so rustsec/audit-check can publish its report as a check run instead of exiting 1 on the publish attempt with a read-only token. With publishing possible, bincode (RUSTSEC-2025-0141, unmaintained, transitive of yara-x) leaves the `.cargo/audit.toml` ignore list — its written revisit condition is met, and an informational advisory publishes without failing the check. The `rsa` exception (RUSTSEC-2023-0071) stays, with its documented reason.
- **The Equipos view is bilingual end to end (IDEA-10 phase 10).** The host index (search, status and group filters, list cards), the per-host page (last activity and risk, hunt/incident buttons, process tree, graph, timeline, network destinations) and the baseline piece read from the typed ES/EN dictionaries — the Spanish output is byte-identical to what shipped, the English is a real translation. The fleet summary, the outdated-sensor chip, the «Sensor y conexión» card and the «Añadir equipos» dialog (token wizard, manual enrollment, tokens in use, pending approvals, revoke) travel with it; engine data stays literal. Console suite: 591 tests, tsc and next build green.

### Alert assignment end to end (2026-10-21)

- **Assignment from the engine (TEAM-3, M-1).** The alert lifecycle gains the `assignee`/`assigned_by`/`assigned_at` trio with `POST /api/alerts/{id}/assign` (assign, reassign by assigning over, unassign with the empty assignee) and `POST /api/alerts/assign-batch` (up to 500 ids, per-id `assigned`/`failed`, deliberately not atomic). Assignment is WHO owns the triage, status is WHERE it sits: recognizing or closing never unassigns, and assigning never triages. `GET /api/alerts` gains `assignee=<name>` (case-insensitive) and `unassigned=true`, applied after the lifecycle overlay so both backends (memory ring and SQLite) behave alike; every change broadcasts the existing `alert_lifecycle` SSE frame. OpenAPI documents the routes, the schemas and the store-mode window semantics.
- **Assignment from the console (C-2).** The queue gains an assignment lens («Mis alertas» and «Sin asignar»), an assignee chip per row and an assignment block in the detail (take it, hand it to another analyst, reassign, clear); the selection bar gains bulk «Asignar» with per-id failures listed in the dialog. Everything rides the M-1 routes, filters over the live ring and the history pages, and updates in real time through `alert_lifecycle`, whose payload now carries the trio.
- **The proxy lets assignment through.** Its closed write allowlist was missing both M-1 routes, so every assignment action answered 405 `read_only` before reaching the engine: they now travel like the status route (analyst role, the engine's 8 KiB body cap mirrored, server-side attribution — the account replaces `by`, the assignee is the recipient and is never rewritten).
- **The batch cap respects the engine's real ceiling.** The engine advertises 500 ids, but its 8 KiB body cap (~19 bytes per id) rejects batches of ~430–500 with 413 before the 500 check (SEG finding). The client now cuts at 400 (`MAX_ASSIGN_BATCH_IDS`), so a giant selection degrades into two batches that always fit — with `assignee` and `by` at their 200-character max — and a regression pins the full-body arithmetic under 8192 bytes.
- **One unassigned queue and one assignee filter, everywhere.** After M-1, `assignee=none` (search/export) and `unassigned=true` (list) disagreed on the same parameter. One shared parser and one matcher now serve the list, the search and the export: both spellings mean the same queue on every endpoint, invalid values are loud 400s everywhere, and the contradictory `assignee=<name>&unassigned=true` stays a 400 while the redundant `assignee=none&unassigned=true` is allowed.

### Domain sign-in, read-only SQL and AD detections from the endpoint (2026-10-21)

- **Sign-in with domain accounts (AD-7).** With `-domain-auth <file>`, the engine arms `POST /api/auth/domain`: it verifies the operator's credentials with an LDAPS bind AS THE USER (the read-only connector's transport — organization CA, pinned server name, TLS 1.2 floor) and resolves the console role (admin/analyst/viewer) from the user's AD groups, admin > analyst > viewer. No service account is needed for sign-in: the authenticated user reads their own entry (memberOf; bind and search only, the read-only posture intact). Full contract in `docs/api/openapi.yaml` (`domainLogin`, `DomainLoginVerdict`) and a commented example in `domain-auth.example.yaml`; local console accounts remain as the fallback. The console login-page integration follows with the contract published; nested groups are not resolved, declared in the configuration.
- **Read-only SQL over the store (M-4).** New `POST /api/db/query`: a single SELECT (or WITH/VALUES) against the `-store` SQLite, for the analysis the curated endpoints do not cover. Opt-in (`-api-db-query` / `SF_API_DB_QUERY=1`, the same no-token veto outside loopback as writes), 501 without `-store`, and group-scoped accounts never reach it. Server-side limits: one statement with no write verb or side effect (comments included; `REPLACE()` falls with `REPLACE INTO`), `max_rows` 1–5000 (500 default) with a `truncated` hint, `timeout_ms` 100–30000 (10 s default) answered 408. Reads run on a dedicated `mode=ro` + `query_only` handle — the evidence stays append-only whatever the guard does — and every attempt (ok, refused, error) is audited in `query_audit` (remote address, statement up to 4 KiB, status, rows, duration, error; 1000-row cap).
- **The console proxy carries the SQL console.** `POST /api/db/query` joins the `/api/engine` write allowlist (SEG request once M-2/M-4 landed): administrators only, the same 64 KiB body cap as the engine, the body verbatim (the query carries no `by` attribution — the engine audits every attempt itself). The 405 hint now names the query surface, and the query UI (C-4) has its path cleared without touching `internal/`.
- **AD detections from the endpoint (O-2, endpoint half).** New pack `rules/windows/active-directory.yaml` with five rules for the AD techniques whose tooling runs on an endpoint the sensor already watches: raw SPN ticket requests (Kerberoasting without Rubeus, T1558.003), DRSUAPI/DCSync tooling beyond mimikatz and impacket (T1003.006), password-spray scripts (T1110.003), group changes via `net.exe` (T1098) and services whose binPath boots an interpreter into SYSTEM (T1543.003 — the high-precision core; the broad "any new service" signal stays out on purpose). Every rule ships with synthetic fire and silence evidence in `internal/rules/active_directory_test.go`, with the documented overlaps against `hacktools.yaml` and `privilege-escalation.yaml`; 119 rules shipped and the OPERATIONS inventory regenerated. The Security-log event IDs of the same techniques (4625, 4769, 4662, 4728/4732/4756, 7045) live on the domain controllers and arrive via WEF (M-7).
- **WEF subscription guide skeleton (draft).** New `docs/AD-WEF-SUSCRIPCION.md` sketches how the SOC will receive the domain controllers' Security log through Windows Event Forwarding with nothing installed on the sources: a source-initiated subscription deployed by GPO, a provisional event-ID filter tied to O-2, delivery into the engine's existing NDJSON ingest, retention/privacy notes and a lab test plan. The carrier → engine contract is left open on purpose until AG-1 defines it in M-7.

### Sensor: YARA on written files and honest telemetry (2026-10-21)

- **YARA over every written file, and on demand (S-2).** The ETW sensor compiles a directory of YARA rules (`yara-x`, pure Rust) and scans each file written to the host — strictly opt-in: without `--yara-rules` no file telemetry is consumed and no thread is added. A dedicated session (`bluetardigrade-sensor-file`, Kernel-File 12 Create / 16 Write) hands the Win32 path to a scanner thread outside the ETW callbacks: `stat` and dedupe by (path, size, mtime), a size cap (`--yara-max-mb`, 16 MiB default), a bounded queue of 512 files; what does not fit is counted in the heartbeat (`yara_dropped`) and never blocks. All `*.yar`/`*.yara` under the directory compile into one set — a broken file is skipped and reported without sinking the rest; an optional `bundle.json` names the batch version, and the directory is re-evaluated every minute by fingerprint, so a new batch lands without restarting the sensor. Matches emit `yara.match` (path, extension, size, SHA-256, rule, namespace, tags, bounded meta and strings); the heartbeat reports `yara_rules` (0 = off), `yara_rules_sha`, `yara_scans`, `yara_matches`, `yara_dropped` and `yara_errors`. A `scan <PATH>...` subcommand runs the same scanner on demand (NDJSON on stdout, exit 2 on matches; no ETW, no engine). Spool, log, token and the rules directory itself are always excluded. Dependency cost: `yara-x` 1.22 brings its WASM module runtime (`wasmtime`, a hard dependency of the crate); the CI sensor job stays well inside its 15 minutes.
- **Registry writes are named, attributed and carry their data (S-1).** An unknown registry root resolves through keys already opened under that base and, failing that, through the writer's user (`HKU\<SID>` from the process table); when the root is inferred, the event says so in `registry_root_inferred` instead of passing the guess off as fact, and with no known SID the `?` stays — the hive is never invented. Every `registry.set` carries the writer's SID in `user`, and the written value travels in `registry.value` (a zero-byte capture omits the field rather than sending an empty string). Rules and suppressions that need a written value must key on `registry.value`: there is no `registry.value_data` field.
- **The sensor can no longer stall forever on a wedged engine connection.** After the AUTH/TLS handshake the event stream was purely blocking, so an engine that accepted the TCP connection but stopped reading blocked the delivery thread inside `write_all` indefinitely — the stop flag never consulted, a shutdown losing the in-flight line, heartbeats frozen, false «sensor sin señal» alerts for a live sensor. Event writes now carry a 30 s ceiling (reads stay blocking; the sensor never reads after the handshake): a wedged write fails, `send_line` drops the socket, honors the stop flag and the queue spills to the spool as documented. Enrollment also flushes the credential file to disk (`sync_all`) before the atomic rename, so a power cut in the enrollment window can no longer leave a torn credential that bricks every later start.
- **The heartbeat reports what ETW lost.** Every minute the sensor asks both ETW sessions how many events and real-time buffers they lost (`ControlTraceW`) and sends the totals (`etw_events_lost`, `etw_buffers_lost`), plus the process starts that went out without their SHA-256 because the image-hash thread could not take them (`hash_dropped`; hashing off with `--no-hash` does not count). A sensor silently losing telemetry now shows up in the machine inventory instead of only in a log line.

### Hardening: redirects refused, shutdowns that drain, a cheaper hot path (2026-10-21)

- **Outbound alert sinks refuse redirects.** The SIEM webhook, the Slack and Telegram channels, the Elasticsearch and Splunk sinks and the reputation lookups all delivered through the default redirect policy: a receiver answering 3xx made the engine re-POST the alert payload — and, on a same-host redirect, its Bearer, ApiKey or HEC token with it — to whatever host the `Location` header named, including a downgrade to cleartext on the follow. Every one now hands the 3xx back unanswered (`ErrUseLastResponse`), so a redirect counts as one definitive failed delivery in the existing counters and nothing ever leaves for the redirect target. The reputation client had the sharpest edge: Go does not strip custom headers on cross-host redirects.
- **The remaining outbound clients refuse redirects too.** The scenario replay client (`getJSONInto`, which sends the engine bearer token) and the `apiHealthy` ingest probe both answer a 3xx as a definitive failure: the bearer can no longer ride a redirect to another port or host, and a hostile squatter of the ingest port cannot turn the health probe into a GET at a URL the engine never chose. Regression tests pin both.
- **Shutdown can no longer be stretched by one slow notification.** The notify drain's 2 s budget was only checked between frames — each delivery ran under `context.Background()` with no ceiling, so a wedged SMTP server (15 s) turned a 2 s graceful drain into a ~17 s engine shutdown with `nt.Wait()` blocking the stop sequence. The budget is now enforced per attempt: every delivery runs under a context that expires with the time the drain has left (the email channel applies the deadline to its socket and fails fast), and the frame popped when the budget is spent counts as dropped.
- **Notifications no longer die twice at shutdown.** A cancel landing while a notify channel's queue was busy sent half the queued alerts into instant doomed attempts (each counted as failed) instead of the documented best-effort drain. The worker now checks the context before every pop, so each queued frame gets exactly one drain attempt under a live context — bounded by the same 2 s shutdown deadline — and only frames the deadline leaves behind are counted as dropped.
- **The forensic bundle cap no longer taxes the hot path.** The first real nightly profile showed `evictOldFiles` (a ReadDir plus one stat per file plus a sort on every bundle write once the directory sits at the cap) taking ~29% of the hot alert-path CPU. The cap is now enforced with an in-memory FIFO of bundles written by this process — one unlink per alert in steady state — while the disk is still scanned exactly once per recorder lifetime to seed bundles left by previous runs. The cap (256 bundles, oldest evicted first) and its best-effort contract are unchanged.

### Console: the shared kit everywhere, honest warnings and the bilingual wave (2026-10-21)

- **The POL-7 kit reaches the rest of the views.** Incidentes, Equipos, Directorio, Informes, Supresiones, Intel and Ruido build their controls on the shared primitives (button, field, select, table, tabs). The kit gains a `solid` button variant (the `--primary-strong` accent fill the views repeated by hand, THEME-2) and a `Textarea` primitive with Input's token profile; the directory explorer's type switch becomes a WAI-ARIA tablist with roving tabindex, and the remaining hand-rolled data tables use the `Table*` primitives with their own caption (the printable sheet keeps the caption visible on purpose: it labels the table on paper). No behavior change; console suite, tsc and next build green.
- **An honest outdated-sensor warning (C-5).** The heartbeat carries the sensor version and the engine publishes its own in `/api/stats`; when they differ, Equipos shows an amber chip on the index rows and the sensor card, an amber band on the host page with both versions and how to update (`security-sensor.exe` from this install), and a count in the inventory tile. Honest criterion: outdated = "does not match the engine's", with no invented semver hierarchies; no warning when the engine does not publish a version or the sensor does not declare one.
- **Honest notification avisos.** Turning the notification bell on now says so when the browser prompt was dismissed or never answered (permission still `default`): both the header popover and Ajustes → Notificaciones state that no notification will appear until the permission is granted, instead of an armed toggle and silence. The alert tone also asks a suspended AudioContext to resume, so the autoplay policy no longer silently eats the sound after a page reload.
- **The bilingual wave (IDEA-10 phases 6–9).** Spanish byte-identical to what shipped, English a real translation, each phase pinning its ES strings in the parity test; the console suite climbed 581 → 589 tests, all green with tsc, next build and the DOM battery:
  - **Panel de operaciones (fase 6):** the whole dashboard (tabs, status notices, sensor activity, the investigation graph, ATT&CK matrix, donuts, triage flow, the last-hour line, hot hosts, risk evolution, the weekly grid, recent telemetry and pipeline health), the triage hero, the indicator tiles and the shared chart camera read from the typed ES/EN dictionaries. `pipelineIssues` returns structured problems and the copy lives in the dictionary.
  - **Directorio (fase 7):** header, connector strip, posture, trend, effective privileged accounts, findings and the snapshot explorer. Engine text (finding titles and remediations, connector notices, API hints) stays literal, as the file itself declares.
  - **Validación y probador (fase 8):** the detection-validation view (tiles, tactic filter, launches, success-rate trend, run history, live progress, per-scenario detail, library) and the rule tester (examples, honest client-side validation errors, headers, buttons, result). Fixture events and engine answers stay literal.
  - **Inteligencia, Supresiones y Cadenas (fase 9):** the three Detection-group views — Intel (tiles, list table with per-type breakdown, latest matches), operator Suppressions (live expirations) and kill-chain Cadenas (step graphs, alternatives, rule-less step notices). List names, operator-declared reasons and chain details stay literal.

### Launcher: notifications delivered and password prompts fixed; docs and profiling (2026-10-21)

- **Windows launchers deliver external notifications.** `sf-start`, `sf-console` and `start-engine` pass `-notify tools\config\notify.yaml` to the engine whenever the operator created that file — until today the flag existed but nothing on Windows ever handed the config over, so mail and Telegram could never arrive from a stock install (the missing piece behind the «alerta crítica, sin aviso» report). `notify.example.yaml` documents the channel schema at the repository root, and `sf-engine doctor` gains an external-notifications check that validates the file with the engine's own fail-loud loader — sending nothing and disclosing no secrets (only scheme://host or an `<endpoint>` placeholder reaches the report).
- **Console passwords at the terminal.** `sf-console -AddUser` (and the first-account prompt of `sf-start`) states the rules before asking — at least 12 characters, nothing echoed — and repeats the question up to three times when the two entries do not match or the password is too short, instead of failing the whole command; piped passwords are still read once.
- **Password questions on their own lines.** The two password questions left the prompt mid-line, and a line without its newline can stay buffered until Enter under Windows PowerShell — the operator typed blind without even seeing the question. Each question is now a whole flushed line of its own (`Contraseña para …:`, `Repite la contraseña:`); the typed characters stay hidden, a piped password is still read once, and the failure messages are unchanged.
- **OPERATIONS by chapters.** The 39 flat sections of the operations guide are grouped into eight parts with a contents index at the top; former sections and their subsections demote one heading level, so every heading text — and with it every anchor referenced from the README, GUIA-INICIO and TODO — keeps working. One pre-existing dead intra-doc anchor (`#alert-noise-control`) now points at the REP-1 section that actually documents the noise report.
- **The nightly bench profiles the hot path.** The engine gains an opt-in `-pprof-dir` flag (a CPU profile spanning the whole run plus heap and goroutine snapshots at clean shutdown; off by default and unchanged without it), and `bench_nightly.sh` profiles both passes — rings and sqlite — verifies the files are there and uploads them as the `bench-pprof` workflow artifact (14-day retention; locally, `BENCH_PPROF_DIR` keeps a copy). A profiled run that produces no profiles fails the nightly like a lost-alert run does.

### Console accounts, sign-in, host groups and a calmer replay (2026-10-20)

- **Accounts from the console.** Administrators manage console accounts in Ajustes → Cuentas: create, change the role, disable or enable, reset the password, remove the two-step sign-in, delete. A new account or a reset password gets a temporary password, shown once; its owner must choose their own at the next sign-in, after the second step if any, before any session opens. Disabling an account, or changing its role or password, ends its sessions. An administrator cannot change their own account there, and no change may leave the console without an enabled administrator. Every action is audited with the account it targeted, and the audit panel shows that account.
- **Change your own password.** Anyone signed in with an account changes their password from the session panel (the current one, then the new one twice); their other sessions end.
- **A sign-in page and real sessions.** With accounts (or the shared token), the browser gets a sign-in page at `/login` instead of its own Basic dialog, and a session cookie (HttpOnly, SameSite=Strict, Secure over HTTPS) that ends after 30 idle minutes, 12 hours, a sign-out from the session panel, or a change to the account's password or role. A page opened without a session comes back to where it was heading after signing in; an open console whose session ends returns to the sign-in page. Sign-ins and sign-outs are audited, and only the console's own page can submit them. Scripts keep using HTTP Basic; behind HTTPS the console sends HSTS.
- **Two-step sign-in for console accounts (TOTP).** An account can add a code from any authenticator app (RFC 6238) from the session panel: the console shows a QR code drawn on the server without a new dependency and the key typed out, then hands over 10 single-use recovery codes, stored hashed. Signing in then takes the password and a code, or a recovery code. `sf-console -RequireMfa admin,analyst` makes it compulsory for those roles, and `sf-console -ResetMfa <name>` removes it when a phone is lost. Five wrong codes in 15 minutes lock an account's second step; each code works once. Accounts with a second step cannot use HTTP Basic. `sf-engine doctor` validates the new fields and reports how many accounts have it.
- **Account tool fixes.** `console-user.mjs --file` now keeps every other field of the accounts file when it writes it, and compares account names without case, as the console does: adding `Ana` next to `ana` updates that account instead of writing a duplicate that locks the console.
- **Host groups.** The engine groups machines by host-name pattern, Active Directory OU or ingest credential (`-host-groups <file.yaml>`; the Windows launcher always passes `tools\config\host-groups.yaml`). `GET /api/groups` lists the groups with their machines, and `PUT /api/settings/groups` saves them (needs `-api-write`; refused with 409 after a hand edit). In the console, administrators edit the groups in Ajustes → Grupos, and Equipos shows each machine's groups and filters by group. `sf-engine doctor` validates the file.
- **Access by host group.** A console account that is not an administrator can be limited to some host groups (Ajustes → Cuentas, the "Equipos" column, also on account creation; `sf-console -SetGroups <account> -Groups <groups|none>`; `console-user.mjs --groups`): it then sees and acts on the machines of those groups only. The users file keeps `"groups"` per account, and changing them ends the account's sessions.
- **AD settings through the console.** The console's proxy now forwards `PUT /api/settings/ad` and `POST /api/ad/test` for administrators. It refused them before, so the console could not save or test the connector unless the browser talked to the engine directly.
- **A replayed backlog no longer turns the console upside down.** The service-mode sensor delivers its in-memory queue and disk spool at full speed when the engine returns (up to 50,000 events, hundreds per second for minutes): SSE event frames now merge in 500 ms batches (alerts stay per frame), the live entity graphs redraw at most every 3 s keeping the nodes already on screen pinned where they were, and the per-host risk score charges each alert to its triggering event's time — a replayed backlog decays as it would have live instead of landing as one burst of fresh points (20 six-hour-old high alerts used to score ~105, "critical"). The sensor tile «En cola de disco» becomes «Desbordados a disco»: the sensor reports a cumulative counter since it started, not the backlog still pending.

### Windows launcher, Go 1.26.10 and a readable architecture (2026-10-20)

- **`sf-start` / `sf-stop` / `sf-status`.** One command starts the engine, the hub, the web console and the ETW sensor service, then opens the browser; another stops them all. The sensor stops first, so it delivers what it holds to the still-running engine instead of queueing it for a replay at the next start (`sf-stop -KeepSensor` keeps it capturing). Changing the sensor service's state shows one UAC prompt and is skipped when there is nothing to change. `sf-console` and `sf-etw` keep working on their own.
- **Quieter installer.** go build, bun install and next build no longer print their output on screen: it goes to `%TEMP%\bluetardigrade-install.log`, whose path the summary shows. A failing step still prints its output in the error; `-ShowBuildOutput` (or `SF_INSTALL_VERBOSE=1` for `irm | iex` installs) shows everything live.
- **Go 1.26.10.** `go.mod` and the installer's portable Go move from 1.26.6/1.26.8 to 1.26.10: govulncheck reported nine reachable standard-library vulnerabilities (net/http, crypto/tls, net/textproto; GO-2026-6603 to 6611) on 1.26.6 and none on 1.26.10. The installer now requires the pinned patch release (the build runs with `GOTOOLCHAIN=local`), and it replaces a portable Go instead of extracting the new release over the old one, which left the older release's files mixed into the standard library. The nightly `FuzzHTMLAttribute` failure was in the test oracle, not the parser: an empty wanted name looped forever and `ToLower` missed `EqualFold`'s simple folding; both inputs are now seeds.
- **Readable architecture.** `docs/ARCHITECTURE.md` replaces a 30-node horizontal Mermaid chart (shrunk past legibility at GitHub's page width) and an outdated image (eBPF and Kernel-File capture that the sensor does not do) with two vertical Mermaid diagrams: endpoint to analyst, and inside the engine. The development round reports (`docs/agentes/`), the 2026-10-08 audit report and a tracked `node_modules` symlink into a developer cache left the tree; git history keeps them. The README's pinned-install example now names the published `v1.0.0-rc1` release.

### Active Directory, validation, reports, noise control and a bilingual console (2026-10-06)

- **Active Directory, read only (`-ad`, needs `-store`):**
  - **Connector:** reads users, groups, computers and OUs over LDAPS (or
    LDAP upgraded with StartTLS). It validates the domain controller
    against a configured CA, with TLS 1.2 or later and a pinned server
    name, and binds as a least-privilege service account.
  - **Paging:** objects are paged under a hard cap, and OUs can be
    included or excluded.
  - **Posture:** recomputed after every sync, with a 0–100 score and
    history:
    - effective privileged members;
    - `krbtgt` age;
    - unconstrained delegation;
    - accounts without Kerberos pre-authentication;
    - SPN accounts with RC4;
    - unsupported operating systems;
    - inactive accounts and passwords that never expire;
    - computers without a sensor;
    - orphaned `adminCount`.
  - **API:** `GET /api/ad/status`, `/objects/{kind}`, `/posture`,
    `/posture/history`.
  - **Credential:** the service-account password lives in an envelope
    (`engine secret-write`), DPAPI-encrypted on Windows and `0600`
    elsewhere. It is zeroed after every bind and never served or logged.
  - **Settings:** `GET/PUT /api/settings/ad` and `POST /api/ad/test`
    («Probar conexión»), behind `-api-write` and the API token.
    - A PUT validates first, then commits and swaps the connector
      synchronously in commit order.
    - A file changed by hand is protected with 409.
    - **The CA and credential paths can only be changed in the `-ad` file
      on the engine host:** a request that names other paths is refused
      with 400, and the probe needs `-ad`. Before this fix, the API
      credential could overwrite any file the engine can write, or read one
      and send it as a bind password to a chosen server.
- **Noise control and triage (v1.1):**
  - **Known software (`-known-software`):**
    - matched by image glob or SHA-256 and labelled
      `enrichment.known_software`;
    - events are never hidden;
    - the baseline and the noise report stop counting it, and a rule may
      opt out with `exclude_known_software`.
  - **Conditional suppressions:** a `when` list of event-field conditions,
    evaluated with the rule engine's operators, silences one exact use
    without disabling the rule.
  - **Triage verdict:** `false_positive`, `authorized_activity` or
    `confirmed_incident`, in the lifecycle, the API and the exports. The
    noise report ranks rules by their real false-positive rate.
  - **Per-host quotas** in the beacon and threshold tables and the
    in-memory rings, so one noisy host cannot wash the others out.
    `/api/stats` reports the rotation and the per-host pressure.
- **Platform status:** `/api/stats` publishes the engine version,
  ingest→alert latency (p50/p95/max), store size and the expiry of both TLS
  certificates.
- **Console:**
  - **Panel:** three tabs (Resumen, Detección, Equipos y actividad).
  - **Detection:**
    - «Validación» launches the inert scenario battery and shows its
      trend, with a searchable, paged library;
    - «Ruido» shows top processes, domains and rules, with one-click
      suppressions;
    - the ATT&CK matrix shows the scenarios that validate each tactic.
  - **«Directorio»:** posture, findings, trend, privileged accounts,
    domain-versus-sensor coverage and the object explorer.
  - **«Ajustes»:** the Active Directory form, with a write-only password
    and read-only file paths; the other sections show their real state.
  - **«Informes»:** catalog, printable PDF sheet and the console's charts.
  - **Incidents and onboarding:** incident playbooks and a first-run
    assistant.
  - **Language:** Spanish and English across the frame, the alerts,
    incidents, reports, NOC and status views. The panel, directory,
    validation and settings follow in the next round.
  - **Look:**
    - a zinc accent end to end;
    - shared tab, badge and table components;
    - motion fully still under `prefers-reduced-motion`;
    - production source maps.
  - **Fixes:**
    - the theme and NOC buttons no longer share an icon;
    - the risk history waits for the engine;
    - the triage flow explains a single state;
    - the English sidebar no longer repeats a group heading.
- **Security and quality:**
  - **Console CSP:** nonce-based, without `unsafe-inline`.
  - **API:** `nosniff` and `no-referrer` on every engine response.
  - **CSV:** console CSV exports neutralize formulas.
  - **Analyst:** the single-alert analyst cleans client-provided alerts.
  - **Active response:** a duplicate idempotency key is denied at commit.
  - **Enrollment:** the registry refuses duplicate token digests.
  - **Reports and noise:** they accept `7d`/`30d` and keep their truncation
    flags honest.
  - **Intel:** a list saved twice no longer glues a BOM to its first
    indicator (found by live fuzzing).
  - **Enrollment test:** it no longer depends on a fixed date.
- **Build and CI:**
  - `make` works again (recipe tabs restored, with a guard).
  - Test tooling installs with `--ignore-scripts --no-save
    --no-package-lock`.
  - Windows `vet` covers the whole module.
  - Nightly fuzzing runs every target, including the ingest first line.
  - The console palette and accessibility (axe-core, 18 views, both
    themes) are checked.
  - Lighthouse baseline: 97/100/96/100.
- **Windows launcher:**
  - `sf-console`/`start-engine` arm the Validation view (`-scenarios`)
    whenever the install ships `scenarios\`. The replay stays inside the
    engine and never reaches the alerts, the store or the risk score.
  - The AD connector (`-ad`) is armed only when the operator writes
    `tools\config\ad.yaml`.

### Detection validation, reports and the noise report (2026-10-05)

- **Detection validation with inert synthetic scenarios (`scenarios/`):**
  - 127 scenarios, one per shipped rule and kill chain, each with its
    ATT&CK techniques and the alerts it must raise.
  - `engine scenarios list|replay` replays them against a laboratory engine
    on loopback only.
  - Every event is tagged `simulation` and pinned to a `LAB-SIM-*` host, and
    every alert derived from simulated evidence carries the tag.
  - CI fails when a scenario stops detecting, when a detection loses its
    scenario, or when a simulated alert goes out untagged.
- **On-demand battery** on a lab engine started with `-scenarios <dir>`:
  - `GET /api/scenarios`, `POST /api/scenarios/run` (202, or 409 while a run
    is in flight), `GET /api/scenarios/runs` and `GET /api/scenarios/runs/{id}`.
  - Nothing a run raises reaches the live engine.
  - Run history persists with the store (last 200 runs) or in memory
    (last 50).
  - The start of a run is answered with a snapshot: answering with the
    record the run goroutine is writing was a data race under `-race`.
- **Reports and noise:**
  - `GET /api/reports` and `GET /api/reports/{kind}` generate an executive
    summary, an incident bundle, fleet coverage or SOC activity, as JSON or
    CSV, over 24h/7d/30d windows.
  - Reports say when they come from the in-memory rings or hit the scan cap.
  - `GET /api/noise?window=24h` ranks the processes, domains and rules that
    make the most events or alerts.
  - Reports only read: they never change alert lifecycle and never touch a
    host.
- **Enrollment:** identity names are unique by construction. A collision
  across re-enrollments used to save fine and then stop the engine at the
  next restart.

### Console: charts, platform status, incident analysis and the light theme (2026-10-05)

- **Dashboard charts:**
  - weekday × hour alert heatmap;
  - donuts for alerts by tactic and by source, and fleet by status;
  - triage flow (source → tactic → status);
  - lifecycle per tactic and per-host risk evolution, which records outages
    as gaps.
  - Every chart exports its data as CSV and itself as SVG or PNG.
- **«Estado de la plataforma»** (`g h`): the engine's runtime counters in six
  panels. What the API does not publish is shown as «no publicado», never as
  zero.
- **AI analyst:**
  - analyzes a whole incident or a multi-alert selection, with the case
    timeline and the forensic bundle as evidence;
  - streams the provider's answer as it is written;
  - providers without streaming still answer in one piece.
- **Light theme** next to the dark one:
  - system/light/dark selector;
  - the NOC wall stays dark;
  - the accent is a token family (`--primary*`);
  - palettes are validated for contrast and color blindness by
    `check_console_theme.py`.

### Quality, security and documentation (2026-10-05)

- **Security:**
  - `deps-audit` workflow: `govulncheck`, `osv-scanner` and `cargo audit` on
    every push, pull request and weekly;
  - a guard against package lifecycle scripts, and another one for workflow
    triggers;
  - Go 1.26.6 or later, which fixes five standard-library vulnerabilities
    reached by the engine (`net/url`, `net/http`, `crypto/tls`,
    `encoding/asn1`), and `golang.org/x/text` v0.39.0;
  - 83 advisories cleared from the website's dependency tree;
  - STRIDE threat model (`docs/MODELO-DE-AMENAZAS.md`) and a line-by-line
    audit of the enrollment protocol;
  - the console-service status page builds its pill from DOM nodes instead
    of `innerHTML`.
- **Fuzzing and bug fixes:**
  - 20 native Go fuzz targets over every input surface (ingest, identities,
    intel, rule and detector loaders, Sigma, mail, reputation indicators,
    API query filters);
  - three bugs they found or that were reported, now fixed:
    - a malformed intel domain could forge an intel hit;
    - a blank before the extension evaded the double-extension check;
    - the ingest auth banner named the wrong credential;
  - an advisory nightly fuzz job.
- **Code and naming:**
  - the correlator is split into five files by responsibility, with no
    behavior change;
  - the remaining old name («security-framework») is gone from the banner,
    OpenAPI and the Docker paths.
- **Documentation:**
  - complete flag, CLI and Prometheus-metric references;
  - the architecture diagram matches the pipeline;
  - `CONTRIBUTING.md`, issue and PR templates;
  - change notes travel as `changelog.d/` fragments until they are
    consolidated here.

### Fewer false alarms from a day in class (2026-10-05)

The laptop's risk score sat at 5–11 all day from three false alarms, all
legitimate and all confirmed in the engine's store.

- **Beaconing:** the Windows DNS Client (`svchost.exe`) talks to the
  configured resolver over TCP port 53 every ~64 s (135 connections in a
  morning). Its traffic to ports 53/853 no longer feeds the detector. DNS
  tunnels show in the query events, and any other process talking to
  port 53 is still tracked.
- **Beaconing:** profiles accept `exclude_domains`, for services whose
  keep-alives are regular by design. An entry covers the domain and its
  subdomains, never look-alikes, and IP-only connections are never
  excluded. The shipped profiles exclude WhatsApp, whose app polls
  `web.whatsapp.com` on 443 and 5222 every ~60 s.
- **«Consulta DNS a dominio generado (posible DGA)»:** a long label made
  only of hex digits is a hash, not a generated name. Examples are
  Microsoft network measurements (`<md5>.azr.footprintdns.com` from
  Edge/WebView2) and ad frames (`<md5>.safeframe.googlesyndication.com`).
  The rule now needs a letter beyond `a-f` in that label.
- A test loads the shipped `beacons.yaml` (a malformed one is fatal at
  startup). The enrollment test that checked a closed connection was
  forgotten now waits for its handler to return.

### Sensor enrollment with tokens and approval (2026-10-05)

- **Engine (`-enroll <file>`):** a new sensor joins with a token from the
  console instead of a hand-made identity.
  - It opens with `ENROLL <token> <host>` and receives a credential of its
    own, bound to that host; later connections use `AUTH`.
  - The host stays pending until an administrator approves it. The engine
    holds its connections off with `{"ack":"pending"}` before any event, and
    the sensor keeps its events in its spool meanwhile.
  - Tokens are single use by default, expire (1 hour to 30 days) and can
    auto-approve a hostname pattern.
  - A host that another identity already reports as is never approved
    automatically.
  - Rejecting or revoking a host closes its open connections at once.
  - `ENROLL` is only accepted over TLS or from loopback.
  - Only SHA-256 digests are kept, in a JSON file written atomically.
  - New API routes: `GET /api/enroll`, `POST /api/enroll/tokens`,
    `POST /api/enroll/tokens/{id}/revoke` and
    `POST /api/enroll/hosts/{name}/{action}`. The writes need an API token.
- **Sensor:** `--enroll-token` / `--enroll-token-file` / `SF_ENROLL_TOKEN`
  with `--token-file`.
  - It stores the credential and deletes the enrollment token file.
  - It retries an engine that is not reachable yet.
  - A pending host is waited for like an unreachable engine, so no events
    are lost.
  - `sf-etw -Install -EnrollToken <token>` does the same for the Windows
    service and keeps the credential across updates.
- **Console:**
  - Equipos → «Añadir equipos» has a token wizard. The token is shown once,
    next to the commands for the new machine.
  - A «Pendientes de aprobación» panel lets administrators approve or reject
    hosts, and shows name conflicts.
  - The host page shows how a machine joined and can revoke it.
  - The console proxy lets these writes through for administrators only,
    with the account name recorded and audited.
- **Windows launcher:** an ingest certificate pair opens the ingest to the
  network with TLS and enrollment. Without one, nothing changes: loopback
  only.

### ETW sensor as a Windows service (2026-10-05)

- `sf-etw -Install` registers the `bluetardigrade-sensor` service:
  - one UAC prompt, from a normal PowerShell;
  - it runs as SYSTEM, starts with Windows and restarts itself if it fails;
  - no elevated window is needed afterwards;
  - `sf-etw` shows the status (what the engine sees, and the log for
    administrators); `-Start`, `-Stop`, `-Restart`, `-Uninstall [-Purge]`.
- Install layout: the binary is copied to `Program Files` (a SYSTEM
  service must not run a user-writable file); spool, log and ingest token
  live in `ProgramData` with SYSTEM/Administrators-only permissions.
- The sensor gains `--service`, `--log <file>` (output to a rotated
  file) and `--token-file <file>` (the token stays out of the service's
  command line).
- A manual sensor refuses to start while the service runs (both would
  use the same ETW sessions).
- Heartbeats report `run_mode` (service or console). The engine and
  `/api/fleet` carry it, and the host page in Equipos shows it.
- The installer adds `sf-etw` and says when the service runs an older
  build after `sf-update`. The uninstaller refuses to delete files while
  the service is installed.

## [v1.0.0-rc1] — 2026-10-05 — first release candidate

The first candidate for 1.0. The Windows ETW sensor is verified on a real
laptop (Windows 11 25H2):
- process starts with image path and SHA-256;
- DNS queries with their answers;
- TCP connections with their domain;
- registry writes, with the alerts they raise.

The engine brings:
- 114 enabled rules;
- cross-host correlation chains, beaconing, thresholds, local threat intel
  and the per-host baseline;
- fleet heartbeats with silent-sensor alerts;
- forensic bundles and incidents.

The console adds per-analyst accounts and an audit trail.

All components report the same version now: engine `v1.0.0` (release
binaries report their tag), ETW sensor `1.0.0`, console and console service
`1.0.0`, API spec `1.0.0`.

Before `v1.0.0`:
- a 24–48 hour real-use run;
- test sheet sections 7 (accounts) and 4 (a second machine), in
  `docs/PRUEBAS-PENDIENTES.md`.

### Known limitations

- **Sensor:**
  - The ETW sensor is Windows-only and runs from an Administrator window
    (kernel ETW needs it). It runs as a Windows service from 1.1.
  - Endpoints are enrolled by hand (`ingest-identities.yaml`).
    Single-use enrollment tokens and an installer package are planned.
  - A registry key opened relative to a handle that predates the sensor
    shows an unknown root (`?\Software\...\Run`). The data written to a
    value is not captured.
  - About 10% of DNS events carry no answer (cached or failed lookups).
    A TCP connection carries its domain only when the sensor saw the
    lookup.
  - ETW lost events are not reported in the heartbeat yet.
- **Noise:**
  - Routine vendor software is not aggregated. On the test laptop, Lenovo
    Vantage starts four add-ins every minute: 43% of process starts at
    idle. Aggregation, a known-software list and conditional suppressions
    are planned for 1.1.
  - "Lectura del portapapeles desde la línea de comandos" also fires on
    legitimate tools that read the clipboard through PowerShell, such as
    developer assistants. Suppress it per host until conditional
    suppressions land.
- **Scale and deployment:**
  - One engine node on SQLite, measured on one real host and in the lab.
    There are no large-fleet measurements yet.
  - The console listens on loopback over HTTP. For analysts on other
    machines, put it behind an HTTPS reverse proxy.
  - Release assets are the engine and collector binaries. `install.ps1`
    builds the ETW sensor and the console from source (Rust and Bun).
- **By design:**
  - Threat intel comes only from local files; nothing is downloaded.
  - The console runs no actions on endpoints.

### Fleet after a laptop suspension (2026-10-05)

- The engine no longer reports "sensor sin señal" after it was itself
  suspended (a laptop with the lid closed): when its fleet check sees a
  wall-clock gap of more than three intervals, every sensor gets a fresh
  grace period.

### DNS rebinding guard for the tokenless engine API (2026-10-04)

Security

- A loopback engine API without `-api-token` now answers only to Host
  `localhost` or an IP literal (421 otherwise). Before, a web page the
  operator visited could rebind its own DNS name to 127.0.0.1 and, as a
  same-origin client, read every event and alert and close alerts (or
  write suppressions with `-api-write`). Engines with a token, or bound
  beyond loopback, are unchanged; reach a tokenless engine by name only
  after setting a token.

Tests

- `TestAlertStatusPersistErrorHidesPath` skips when run as root, where a
  read-only directory is still writable (container CI runners).

### First run on a real Windows host (2026-10-04)

- ETW sensor, found and verified on the first real run:
  - short-lived processes (`reg.exe`, `whoami.exe`, `conhost.exe`) had
    no image or hash: they exit within the ~1 s ETW delivery. The image
    now also comes from Microsoft-Windows-Kernel-Process event 1 (NT
    path mapped to the drive letter); after the fix 19 of 19 process
    starts carried it, and the hash of `whoami.exe` matched
    `Get-FileHash`.
  - every DNS query arrived with status 87 and no answer: Windows reports
    a query first with that status and then with the result, and the
    repeat suppression kept the first. After the fix 15 of 16 queries
    carried their answer.
  - not one registry write was reported: Kernel-Registry's SetValueKey
    names the key only by its kernel object (KeyName empty on all of
    them). Keys are now named from the OpenKey/CreateKey/CloseKey events;
    a handle opened relative to a base that predates the sensor keeps
    its known part under an unknown root (`?\Software\...\Run`).
    Verified: the HKCU Run-key write raised "Persistencia en clave Run via
    registro". `--debug-registry <fragment>` prints how keys are named.
  - the transport says when it reconnects (only failures were printed).
  - "Sensor sin señal" fired on its own while the sensor was stopped.
  - Ctrl+C closes both ETW sessions cleanly; 0.1-0.2 s of CPU and 15 MB
    of memory at idle, also with the registry key tracking.
- Beaconing: four false "C2 beacon web lento" alerts on the first real
  run, all legitimate polling: DNS lookups that Chrome and a web app repeat
  every ~64 s, and TCP to the router's DNS on a link-local address. DNS
  query events and loopback, link-local and multicast destinations no
  longer feed the detector; connections to routable addresses (with the
  domain the sensor attaches) still do.

### Second review round (2026-10-04)

- Fixes:
  - Cross-host chains followed built-in identities that exist on every
    machine: the ETW sensor reports SIDs (`S-1-5-18` is SYSTEM, which
    remote-execution tools run as), and localized or virtual accounts
    (`AUTORIDAD NT\Servicio de red`, `NT SERVICE\…`, `DWM-1`) slipped
    through, so routine remote administration could raise "Cuenta
    saltando entre equipos". Only user accounts and user SIDs are
    followed now.
  - Fleet restore: a sensor already reported silent before the restart
    showed as online for the grace period, and hosts without heartbeats
    briefly showed as online; the grace now only covers sensors that
    were healthy at shutdown.
  - Header drop-downs: keyboard focus moves into the panel when it
    opens, Tab past its last control returns to the chip.
- ETW sensor: the process name comes from the image path when it matches
  the kernel's name (the kernel cuts names at 14 characters; a reused
  PID is never mislabeled), also for the start-up rundown that names the
  processes of network and registry events.
- Intel hits on DNS events say "consulta DNS" / "respuesta DNS" instead
  of the raw field, and "proceso nuevo" alerts carry the image SHA-256
  in their enrichment (`image_sha256`).
- Sysmon sensor (`sf-sensor`): DNS queries never carried their answer.
  The parser expected an invented `A:1.2.3.4` form (and its self-test
  used it); Sysmon writes `type:  5 alias;::ffff:1.2.3.4;`. It now reads
  the real format, so IP intel lists match Sysmon DNS answers too. CI
  runs the sensor self-test on Windows PowerShell 5.1.
- `sf-engine doctor` validates `ingest-identities.yaml` with the engine's
  loader (a malformed file stops the engine at startup).

### Review round: fixes, observability and the host baseline (2026-10-04)

- Fixes:
  - ETW sensor: DNS repeats are suppressed with a sliding window. The
    fixed "once a minute" turned a fast poller into a perfectly regular
    60 s series that the beacon detector would flag as an implant.
  - ETW sensor: if the network/registry session cannot start with the
    DNS provider (ferrisetw aborts on the first failing provider), it is
    retried without DNS instead of losing network and registry too.
  - Engine: baseline entries and retired fleet hosts pending persistence
    are drained every 30 s even without `-store` (they used to grow).
  - `engine validate` and `sf-engine doctor` no longer report the steps
    with alternatives as missing rules; a step is dead only when none of
    its alternatives is loaded.
  - Console: the header drop-downs (critical-alert notifications and the
    new detectors menu) were clipped by the scrolling chip row; they now
    float above the page.
  - Console accounts: login failures are tracked for real accounts only
    (a flood of invented names could flush a real account's lockout).
  - `scripts/console-user.mjs`: the second password prompt was hidden on
    a terminal.
  - Windows launcher: deleting `console-users.json` and restarting in the
    same PowerShell left `CONSOLE_USERS_FILE` set, locking the console.
  - Engine: an invalid `SF_BASELINE_LEARN` is reported instead of
    silently ignored.
- `/api/stats` and `/metrics` carry threat-intel and baseline counters
  (OpenAPI documented, parity-tested).
- `GET /api/baseline?host=` and a *Línea base de procesos* card on each
  host page: learning window, known processes (filterable) and the
  host's novelties.
- Header: one **detectores** chip with a drop-down replaces the
  correlator, beacon and threshold chips (the row no longer overflows).
- Intel lists also accept `IP:port`, `domain:port`, defanged indicators
  (`evil[.]com`, `hxxps://`), wildcards and AdBlock rules.
- `sf-engine doctor` checks the intel folder, the `baseline.learn`
  setting and the console accounts file.

### Threat intel, baseline, cross-host chains, analyst accounts and sensor hashes (2026-10-04)

- **Offline threat intelligence** (`internal/intel`, `-intel`, default
  `./intel`): indicator lists the operator drops in a folder (IPs, CIDR
  ranges, domains with their subdomains, hosts-file lines, URLs, MD5 /
  SHA-1 / SHA-256). Every event is matched by destination/source IP,
  domain and process/file hash; a hit is a high `intel-match-<list>`
  alert, once per indicator and host every 10 minutes. Re-read on
  change, never downloads anything; a bad file is logged and retried
  instead of stopping the engine. `GET /api/intel` (OpenAPI documented).
- **Per-host process baseline** (`internal/baseline`, `-baseline-learn`,
  default 24 h): after its learning period a host running a process it
  never ran raises a low `baseline-new-process` alert, rate-limited to
  10 per host per hour. Persisted with `-store`.
- **Fleet inventory persistence**: with `-store` the machine inventory
  survives restarts, and restored sensors get a full grace period, so
  an engine restart raises no wave of silent-sensor alerts.
- **Cross-host kill chains**: sequences gain `scope: user` with
  `min_hosts` (follow one account across several machines) and steps
  with alternatives (`rules: [...]`). `sequences/lateral.yaml` ships two
  lateral-movement chains. `/api/sequences` reports `step_rules`,
  `scope` and `min_hosts`; the Cadenas view shows them.
- **Console accounts and roles** (`CONSOLE_USERS_FILE`, optional):
  per-analyst logins with viewer / analyst / admin roles enforced by the
  engine proxy, the account name written as `by` on triage, incidents
  and notes, an audit trail of every console write
  (`CONSOLE_AUDIT_FILE`, `data\console-audit.jsonl` on Windows) visible
  to administrators, and `scripts/console-user.mjs` to create entries
  (PBKDF2-SHA256). Without the file nothing changes.
- **Incident report export**: Markdown and a printable HTML page with
  the entity graph, from the incident page.
- **Detección -> Inteligencia** tab: loaded lists, counts per kind,
  baseline state and the latest hits. Reputation lookups now include
  the SHA-256 of the image (VirusTotal).
- **ETW sensor**: process starts carry the full image path and its
  SHA-256 (hashed off the ETW threads, cached, files over 100 MiB
  skipped; `--no-hash`); DNS queries from Microsoft-Windows-DNS-Client
  become `network.connect` with `protocol: dns`, and recent answers
  name the domain of the TCP connections that follow (`--no-dns`).
- Fixes: the incident graph only draws the case hosts' connections
  (it used to pull every host in the event buffer); clippy findings in
  the sensor (boxed TLS stream, `is_ok`). CI now runs the sensor's unit
  tests and clippy (host and Windows target).

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

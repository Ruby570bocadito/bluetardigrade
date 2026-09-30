# security-framework console (SOC)

Browser console for the framework: live telemetry feed, KPI dashboard,
severity triage with a detail panel, the YAML rule pack, kill-chain
chains, operator suppressions, a read-only active-response view with
its forensic audit trail, and an AI analyst that explains each alert
the way a senior SOC analyst would. Dark-mode locked product UI (zinc
structure, one emerald interaction accent, severity colors that encode
data semantics).

## Data flow (no fake data anywhere)

```
Go engine (internal/api, 127.0.0.1:7778)
  ├─ GET /api/stream   SSE  ->  use-engine-stream (events, alerts live)
  ├─ GET /api/stats    poll 2s (uptime, counters, severity breakdown)
  ├─ GET /api/events | /api/alerts | /api/rules   one-shot sync
  └─ GET /api/{alerts,events}/export?format=jsonl|csv   downloads
        ▲
        └── same-origin proxy route: web/console/src/app/api/engine/[...path]
              (the engine needs no CORS headers; only GET is forwarded)

console-service (Bun, socket.io :3003)   ->  AI analyst only
```

Telemetry comes straight from the engine API; the hub
(`console-service/`) is only used for the AI analyst. If the engine is
unreachable the console says so (`Motor offline`) and shows no data;
when the hub is down only the analyst view is affected.

## Views

| View | What it shows |
|------|----------------|
| Panel | KPI strip (uptime, events/min, alerts by severity, rules, buffer, webhooks), 4-minute rate chart, engine summary (persistence mode included), latest alerts and telemetry |
| Flujo en vivo | SSE-fed event table with sticky header, pause, search, type filter and JSONL/CSV export |
| Alertas | Semantic table (search, severity filter, export) plus a detail panel: rule message, matched_on, ATT&CK tags, actions, enrichment |
| Reglas | The rule pack as the engine sees it, with expandable conditions |
| Cadenas | The armed kill-chain sequences with their numbered steps and ATT&CK tags, as the correlator tracks them in flight |
| Supresiones | Operator allowlist, read-only by design: rule/host pairs with reason and live expiry countdown; editing happens in `suppressions.yaml`, hot-reloaded by the engine every 15 s |
| Respuesta activa | Read-only active-response surface: arm and audit-health cards plus the forensic audit tail with attempt-class filter (executed / denied / followups), operator-controlled tail window and JSONL export |
| Analista IA | Streaming triage chat bound to a selected alert |

## Header chips

The topbar carries one status chip per delivery/detector surface, all fed by
`/api/stats` and all honest by design — a chip is **hidden** while its feature
is off (an all-zero chip for a disabled feature would be a lie), neutral while
there is headroom and red the moment something needs operator attention:

| Chip | Source fields | Turns red when |
|------|---------------|----------------|
| `webhook N / err / desc` | `webhook_sent` / `webhook_failed` / `webhook_dropped` | any delivery fails or is dropped (the SIEM is missing alerts) |
| `correlador N/cap` | `correlator_states` / `correlator_sequences` / `correlator_cap` | chains in flight reach the tracking cap (new hosts stop being correlated) |
| `beacons N/cap` | `beacons_tracked` / `beacons_cap` / `beacons_fired` (A3) | tracked destinations reach the cap (new destinations stop being tracked) |
| `umbrales N · M` | `threshold_rules` / `threshold_keys` / `threshold_fired` (A2) | never: the engine exposes no key cap, so the chip refuses to paint a saturation signal it cannot know about |

The persistence mode is not a chip but an engine-summary row (`Persistencia`):
`SQLite · X eventos · Y alertas` when `-store` is attached, `sin store` when it
is not — the console shows the real mode, never an assumption.

## Quickstart

Requirements: [bun](https://bun.sh).

```bash
# terminal 1 - the real engine (rules + API on :7778)
go run ./cmd/engine

# terminal 2 (optional) - AI analyst hub (socket.io on :3003)
cd console-service && bun install && bun run dev

# terminal 3 - console (Next.js on :3000)
cd console && bun install && bun run dev
```

Open http://localhost:3000. Without the engine the console renders its
honest empty/offline states; without console-service everything works
except the analyst view.

## Lockfile policy

`bun.lock` is the only lockfile in this package: bun is the toolchain
the docs and the installer rely on, and keeping a second `package-lock.json`
in parallel produced real drift (the two files resolved different
`@types/node` versions). npm users can reproduce a resolution at any
time with `npm install --package-lock-only` if they need one locally,
but it is not committed.

## Design tokens

- Structure: Tailwind zinc (`zinc-950` background, `zinc-100`/`zinc-400` text) with `white/[0.06]` hairlines on surfaces and `zinc-800` for inner detail.
- Surfaces are defined once in `src/app/globals.css` and reused by every view: `.panel` (hairline border, vertical gradient fill, inner top highlight, ambient shadow), `.panel-hover` (lift on hover, frozen under `prefers-reduced-motion`), `.chip`, `.icon-tile`, `.glass` (sidebar and topbar backdrop blur) and the three-radial `ambient-glow` background. Views compose these classes instead of re-declaring card styles inline.
- One interaction accent: `emerald-500`.
- Severity semantics (data, not decoration): `critical` red-500/600,
  `high` orange-500, `medium` amber-400, `low` sky-400.
- Type: Geist Sans for UI, Geist Mono for ids, timestamps, IPs and
  every number (tabular).
- Radius: single 8px scale (`--radius: 0.5rem`).
- Motion: state transitions only, `prefers-reduced-motion` honoured.

## Configuration

- `ENGINE_API_URL` (console, server side): engine API base the proxy
  route forwards to, default `http://127.0.0.1:7778`.
- `SF_API_TOKEN` (console, server side): bearer the proxy rides on
  every forwarded request, the same env var the engine (`-api-token`
  falls back to it) and the console-service bridge honor — a
  token-protected engine needs exactly this one entry on the console
  side; without it the console would sit in 401s.
- `CONSOLE_ALLOWED_HOSTS` (console, server side): comma-separated
  hostnames the proxy serves besides loopback (`localhost`,
  `127.0.0.1`, `::1` are always served). The dev server binds beyond
  loopback, and the proxy is the one listener that bridges a browser
  to engine telemetry, so any other Host gets a 403 that names this
  var — the console posture mirrors the engine's: loopback
  friction-free, beyond loopback loud and explicit.
- Same-origin writes: the triage POST is forwarded only when the
  request shows no cross-site browser context (mismatched `Origin` or
  `Sec-Fetch-Site: cross-site`), so a hostile page cannot drive-by
  close alerts through the proxy; headerless clients (curl, the
  dev-tests smokes) keep working. Covered by `bun test`
  (`route.test.ts`, 10 tests) alongside the live-fire matrix of the
  role report.
- `NEXT_PUBLIC_ENGINE_API` (console, client side): bypass the proxy and
  talk to the engine directly (only useful when the engine serves CORS).
- `NEXT_PUBLIC_CONSOLE_URL` (console): point the analyst socket at a
  remote hub, e.g. `NEXT_PUBLIC_CONSOLE_URL=http://lab-host:3003`. On
  localhost it defaults to `http://localhost:3003`; behind a reverse
  proxy it falls back to the same origin.
- `PORT` / `CONSOLE_HOST` / `CONSOLE_CORS_ORIGIN` (console-service):
  hub bind and CORS allowlist, unchanged; see `console-service/`.
- Analyst triage (console-service): `ANALYST_BASE_URL`,
  `ANALYST_API_KEY` and `ANALYST_MODEL` for any OpenAI-compatible
  endpoint. Without configuration the analyst panel reports it clearly
  and the rest of the console keeps working.

The interface copy is in Spanish by design: the primary audience of the
project documentation is Spanish speaking.

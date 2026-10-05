# bluetardigrade console (SOC)

Browser console for the framework: live telemetry feed, KPI dashboard,
severity triage with a detail panel, the YAML rule pack, kill-chain
chains, operator suppressions, a read-only active-response view with
its forensic audit trail, and an optional AI analyst using the configured
provider to assist alert triage. Dual-theme product UI, dark by default
(zinc structure, one blue interaction accent, severity colors that
encode data semantics, both palettes machine-validated).

## Data flow and demo boundaries

```
Go engine (internal/api, 127.0.0.1:7778)
  ├─ GET /api/stream   SSE  ->  use-engine-stream (events, alerts live)
  ├─ GET /api/stats    poll 2s (uptime, counters, severity breakdown)
  ├─ GET /api/events | /api/alerts   initial/reconnect/manual snapshot
  ├─ GET /api/rules   initial sync + polling (hot reload)
  └─ GET /api/{alerts,events}/export?format=jsonl|csv   downloads
        ▲
        └── same-origin proxy route: web/console/src/app/api/engine/[...path]
              (the engine needs no CORS headers; GET plus the guarded alert-triage POST)

console-service (Bun, socket.io :3003)   ->  AI analyst only
```

Telemetry comes straight from the engine API; the hub
(`console-service/`) is only used for the AI analyst. If the engine is
unreachable the console says so (`Motor offline`) and clears stale telemetry
without manufacturing replacement events;
when the hub is down only the analyst view is affected.

Product installs contain no demo generator. The engine receives sensor/provider records; older stored `source=simulate` records remain explicitly labeled. The header lists declared sources across the received window
and keeps a **demo** indicator visible for mixed data, also on mobile.
`source` is sender-declared, not an attestation. Tests use isolated fixtures.
Archived screenshots use historical generated inputs; they are not proof of a Windows endpoint deployment.

The provider uses bounded requests and serial polling. Snapshots merge with
incoming frames, SSE replay preserves triage decisions, and optional response
state clears on a real 404. The operation summary shows pending critical triage,
pipeline issues, detector saturation, last API reading and manual refresh.
API reachability and live-channel connectivity are tracked separately.
Unavailable metrics show —. The rolling chart ages out during sensor inactivity
and describes a buffer sample, not complete historical retention.

## Views

| View | What it shows |
|------|----------------|
| Panel | KPI strip (uptime, events/min, alerts by severity, rules, buffer, webhooks), 4-minute rate chart, engine summary (persistence mode included), latest alerts and telemetry |
| Flujo en vivo | SSE-fed event table with sticky header, pause, search, type filter, saved searches and JSONL/CSV export |
| Alertas | Semantic table (search, severity filter, saved searches, export) plus detail: matched_on, ATT&CK, actions, enrichment, lazy forensic evidence with retry and full JSON/JSONL snapshot download |
| Reglas | The rule pack as the engine sees it, with expandable conditions |
| Cadenas | The armed kill-chain sequences with their numbered steps and ATT&CK tags, as the correlator tracks them in flight |
| Supresiones | Operator allowlist, read-only by design: rule/host pairs with reason and live expiry countdown; editing happens in `suppressions.yaml`, hot-reloaded by the engine every 15 s |
| Respuesta activa | Read-only active-response surface: arm and audit-health cards plus the forensic audit tail with attempt-class filter (executed / denied / followups), operator-controlled tail window and JSONL export |
| Analista IA | Triage chat bound to a selected alert; real preparation/request steps and a complete reply after provider completion |

**Búsquedas guardadas** stores up to 20 alert/feed filter presets locally in
this browser. Apply restores filters and updates URL history; save with the
same name updates; delete removes a preset. Query text is persisted, so avoid
credentials in it. It saves no evidence snapshot or pause state. Corrupt or
blocked storage reports an error without overwriting unreadable data.
[Operator guide and verification limits](../../docs/INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md).

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

Requirements: [bun](https://bun.sh). Run each terminal from the repository root.

```bash
# terminal 1 - the real engine (rules + API on :7778)
go run ./cmd/engine

# terminal 2 (optional) - AI analyst hub (socket.io on :3003)
cd web/console-service && bun install --frozen-lockfile && bun run dev

# terminal 3 - console (Next.js on :3000)
cd web/console && bun install --frozen-lockfile && bun run dev
```

Open http://localhost:3000. Without the engine the console renders its
honest empty/offline states; without console-service everything works
except the analyst view.

## Lockfile policy

The analyst hub's HTTP and WebSocket origins are included in the production
CSP from `NEXT_PUBLIC_CONSOLE_URL` (default `http://localhost:3003`). Changing
this public URL requires rebuilding the console. The hub independently
validates browser origins for polling and WebSocket handshakes; extend
`CONSOLE_CORS_ORIGIN` when serving the console at another origin. Analyst
concurrency and the request budget also apply across all hub connections.

`bun.lock` is the only lockfile in this package: bun is the toolchain
the docs and the installer rely on, and keeping a second `package-lock.json`
in parallel produced real drift (the two files resolved different
`@types/node` versions). npm users can reproduce a resolution at any
time with `npm install --package-lock-only` if they need one locally,
but it is not committed.

## Theme (dark default, light available)

The console ships dark as the default and as the no-JS outcome; a toggle
in the header (sun/moon, `ThemeToggle`) swaps to the light palette and
back. The choice persists in `localStorage` under `bt-theme`, syncs
across open tabs and, when nothing is stored, follows the OS
`prefers-color-scheme`. An inline boot script in `layout.tsx` resolves
the theme before the first paint, so reloading never flashes the wrong
palette; the decision it implements is mirrored in
`src/lib/theme.ts` (`resolveTheme`, unit-tested).

Both palettes are token sets in `globals.css`: the dark tokens live on
`:root` and the light ones on `html.light`, which also remaps the zinc
ramp and the white-alpha hairline utilities the components are built
with, so a theme switch is one class swap with no per-component
variants. Layers that paint outside CSS (the dot-grid canvas, the
entity-graph SVG) read theme-aware custom properties and repaint on the
theme-change event. `scripts/dev-tests/check_console_theme.py`
validates both palettes (WCAG pairs, severity/status and sequential
ramps on the viz surface, CVD separation via CIEDE2000 with Machado
simulations) — run it whenever a token changes.

## Design tokens

- Structure: Tailwind zinc (`zinc-950` background, `zinc-100`/`zinc-400` text) with `white/[0.06]` hairlines on surfaces and `zinc-800` for inner detail. The light theme remaps the same ramp (see above).
- Surfaces are defined once in `src/app/globals.css` and reused by every view: `.panel` (hairline border, vertical gradient fill, inner top highlight, ambient shadow), `.panel-hover` (lift on hover, frozen under `prefers-reduced-motion`), `.chip`, `.icon-tile`, `.glass` (sidebar and topbar backdrop blur) and the three-radial `ambient-glow` background. Views compose these classes instead of re-declaring card styles inline.
- One interaction accent: blue (400 on dark, 600 on light, AA with the white label on solid fills).
- Severity semantics (data, not decoration): `critical` red-500/600,
  `high` orange-500, `medium` amber-400, `low` sky-400.
- Type: Geist Sans for UI, Geist Mono for ids, timestamps, IPs and
  every number (tabular).
- Radius: single 8px scale (`--radius: 0.5rem`).
- Motion: state transitions only, `prefers-reduced-motion` honoured.

## Motion components

The eight motion primitives live in `src/components/reactbits/`, adapted from
[React Bits](https://reactbits.dev) to the console theme (each header documents
its origin). Every one communicates a state change — none is decoration — and
the layer adds zero runtime dependencies beyond `motion`:

| Component | What it does | Where it lives |
|-----------|--------------|----------------|
| `animated-list` | rows enter staggered (fade + short rise, delay per index) | alert queue, suppressions, chains, respond audit, dashboard lists |
| `blur-text` | view titles reveal word by word (rise + blur) on section change | shell view headers |
| `decrypted-text` | text enters as a decode cycle (unrevealed chars cycle glyphs once on load) | shell brand tagline |
| `dot-grid` | pointer-reactive dot grid canvas behind the shell | shell ambient background |
| `gradient-text` | animated gradient on text (`background-clip: text`, pure CSS) | KPI row (critical counter) |
| `shiny-text` | shine sweep over text (`background-clip: text`, pure CSS) | shell hint/loading states |
| `spotlight-card` | radial halo following the pointer via CSS custom properties | dashboard cards, KPI stat cards |
| `star-border` | 1px border with a moving gradient (padding trick + animated background) | AI analyst panel while it is working |

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
  hub bind and CORS allowlist; see `console-service/`.
- Access control. `bun run dev` / `bun run start` bind `127.0.0.1`.
  Host pinning stops DNS rebinding but not a non-browser client, which
  can send `Host: localhost` from anywhere it can reach the port; so a
  console served to other machines needs `CONSOLE_ACCESS_TOKEN` (HTTP
  Basic auth on every request, any user name, the token as password;
  put TLS in front). Extra hosts without it are refused unless
  `CONSOLE_ALLOW_UNAUTHENTICATED=1` declares an authenticating front
  end. The analyst hub accepts sockets only with `HUB_ACCESS_TOKEN` when
  it is set (mandatory when the hub binds beyond loopback); the browser
  obtains it from the authenticated `/api/hub-token` route, never from
  the bundle.
- Analyst triage (console-service): `ANALYST_BASE_URL`,
  `ANALYST_API_KEY` and `ANALYST_MODEL` for any OpenAI-compatible
  endpoint. Without configuration the analyst panel reports it clearly
  and the rest of the console keeps working.

The analyst performs an actual HTTP request; it no longer animates an
already-completed response as token streaming. Local ATT&CK context is a
static note lookup. Alert/event/rule JSON and operator questions are bounded;
all endpoint evidence is treated as untrusted. No model is called by tests.

The interface copy is in Spanish by design: the primary audience of the
project documentation is Spanish speaking.

## Alert history and lifecycle lenses

The full alert queue has **En vivo** and **Histórico** modes. The latter
uses `GET /api/alerts/search` through the existing read-only proxy. It
searches SQLite when enabled and labels the 256-alert memory window otherwise.
It has 25-row pages, lifecycle/severity/text filters and pinned cursors;
manual refresh starts a new search and includes later arrivals. Source and
lifecycle filters use `historial=1` and `estado=open|new|acknowledged|closed`
in the URL. Page positions are local to the view; a refresh starts at page one.

Queries are debounced, bounded and canceled when obsolete or unmounted.
Lifecycle updates and successful POST acknowledgements patch historical rows
outside the live buffer, so triage does not require a working SSE channel.
An old lifecycle timestamp cannot revert a newer close or reopen.
Exports retain their separate default limit and do not apply the view filters;
their tooltips state this explicitly.

The engine must include the search endpoint. Older engines produce an
explicit capability error, with the live view still available. See
[OPERATIONS.md](../../docs/OPERATIONS.md) for the scan, retention, cursor
and validation limits.

## Informes SOC

En Alertas, el detalle conserva fuente declarada, atributos y flujo del motor.
Redactar informe recoge análisis humano y congela el snapshot: no ejecuta una
respuesta ni cambia el triaje. Hasta diez borradores se guardan explícitamente
en este navegador/origen. Informes guardados permite editar/exportar/eliminar
snapshots de alertas fuera de retención. Guarda antes de cambiar de alerta o
navegar. Revisiones detectan pestañas desactualizadas; localStorage no es una
transacción multiusuario. Errores de cuota y registro corrupto son visibles.
[Operación completa y límites](../../docs/SOC-INTEGRACIONES-E-INFORMES.md).

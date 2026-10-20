# assets

Visual assets referenced from the documentation. Rendered outputs live
in this directory; their editable sources live in `src/` so the
rendered files stay uncluttered at the top level while everything
remains regenerable.

| File                        | Kind    | What it is                                            |
|-----------------------------|---------|-------------------------------------------------------|
| `logo.svg`                  | source  | bluetardigrade mark (README header, console sidebar and favicon) |
| `console-panel.png`        | output  | operations panel: triage hero, stat tiles, activity, severity, timeline (root README hero, dark theme) |
| `console-panel-light.png`  | output  | the same operations panel in the light theme (root README hero) |
| `console-estado.png`       | output  | platform health: engine runtime counters, ingest, store and delivery |
| `console-flujo.png`         | output  | live telemetry: ingest rate, event-type mix and the feed table |
| `console-alertas.png`       | output  | alert queue with the severity strip and a selected alert's detail |
| `console-reglas.png`        | output  | rule catalogue with ATT&CK, severity and event-type coverage (dark theme) |
| `console-reglas-light.png`  | output  | the detection tabs in the light theme |
| `console-seleccion.png`     | output  | alert queue with several alerts selected and the bulk action bar |
| `console-incidentes.png`    | output  | incident detail: status, owner, alerts, incident graph and timeline |
| `console-equipos.png`       | output  | host page: risk, live process tree, entity graph, timeline, destinations |
| `console-noc.png`           | output  | NOC mode on the investigation graph screen |
| `console-cadenas.png`       | output  | kill-chain sequences with per-step alerts and completed campaigns |
| `console-supresiones.png`   | output  | operator suppressions: scope, reason and expiry |
| `console-respuesta-activa.png` | output | active response: armed surface, audit decisions, denial codes and attempts |
| `src/capture_console.mjs`   | source  | Playwright script that captures every `console-*.png`: real-engine lab by default, `CONSOLE_CAPTURE_FIXTURES=1` for contract-true fixtures without a Go toolchain (lab recipe in its header) |

## Diagrams

The architecture diagrams are Mermaid blocks inside
[`../ARCHITECTURE.md`](../ARCHITECTURE.md): GitHub renders them from the
text, so they are edited in place and never drift from a stale image.

## Regenerating the console captures

1. Bring up a loopback lab: a real engine (rules, sequences, beacons,
   thresholds, suppressions, `-store`, an armed response surface), the
   `scripts/dev-tests/scenario` feed in a loop and a few
   `POST /api/respond/kill` attempts so the audit has executed and
   denied rows. The exact flags are in the header of
   `src/capture_console.mjs`.
2. Build and start the console against that engine
   (`bun run build && bun run start` with `ENGINE_API_URL` and
   `SF_API_TOKEN`); a production build renders cleaner screenshots.
3. Run `CONSOLE_URL=http://127.0.0.1:3000 node docs/assets/src/capture_console.mjs`.

Without a Go toolchain, `CONSOLE_CAPTURE_FIXTURES=1 CONSOLE_URL=... node
docs/assets/src/capture_console.mjs` captures the same set against the
contract-true engine fixtures the browser regression uses (LAB-* hosts,
`source=simulate`): still no fabricated product data, the console labels
the window as demo either way.

The scenario's events carry `source=simulate`, so the header shows the
**demo** label in every capture: the console never hides that the
window contains generated test events. For host-telemetry captures,
run the Rust sensor or `sf-sensor` instead and say so in the README.

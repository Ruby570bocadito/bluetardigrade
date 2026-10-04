# assets

Visual assets referenced from the documentation. Rendered outputs live
in this directory; their editable sources live in `src/` so the
rendered files stay uncluttered at the top level while everything
remains regenerable.

| File                        | Kind    | What it is                                            |
|-----------------------------|---------|-------------------------------------------------------|
| `logo.svg`                  | source  | bluetardigrade mark (README header, console sidebar and favicon) |
| `diagram_arquitectura.png`  | output  | four-layer architecture diagram (linked from the root README) |
| `diagram_tracer.png`        | output  | tracer-bullet pipeline: devsensor -> engine -> alert |
| `console-panel.png`        | output  | operations panel: triage hero, stat tiles, activity, severity, timeline (root README hero) |
| `console-flujo.png`         | output  | live telemetry: ingest rate, event-type mix and the feed table |
| `console-alertas.png`       | output  | alert queue with the severity strip and a selected alert's detail |
| `console-reglas.png`        | output  | rule catalogue with ATT&CK, severity and event-type coverage |
| `console-seleccion.png`     | output  | alert queue with several alerts selected and the bulk action bar |
| `console-incidentes.png`    | output  | incident detail: status, owner, alerts, incident graph and timeline |
| `console-equipos.png`       | output  | host page: risk, live process tree, entity graph, timeline, destinations |
| `console-noc.png`           | output  | NOC mode on the investigation graph screen |
| `console-cadenas.png`       | output  | kill-chain sequences with per-step alerts and completed campaigns |
| `console-supresiones.png`   | output  | operator suppressions: scope, reason and expiry |
| `console-respuesta-activa.png` | output | active response: armed surface, audit decisions, denial codes and attempts |
| `src/diagram_arquitectura.html` | source | self-contained HTML/CSS source of the architecture diagram (1060px canvas) |
| `src/diagram_tracer.html`   | source  | self-contained HTML/CSS source of the pipeline above (900px canvas) |
| `src/capture_console.mjs`   | source  | Playwright script that captures every `console-*.png` from a running console (lab recipe in its header) |

## Regenerating a diagram

1. Edit the matching `.html` file under `src/` (plain HTML/CSS, no
   build step; the root element carrying the canvas is `.canvas`).
2. Open it in any Chromium-based browser at 100% zoom and screenshot
   the `.canvas` element (or use Playwright:
   `page.locator('.canvas').screenshot(...)` at `deviceScaleFactor: 2`
   for a crisp 2x PNG).
3. Save the result over the corresponding `.png` in this directory
   (same base name) so existing README links keep working.

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

The scenario's events carry `source=simulate`, so the header shows the
**demo** label in every capture: the console never hides that the
window contains generated test events. For host-telemetry captures,
run the Rust sensor or `sf-sensor` instead and say so in the README.

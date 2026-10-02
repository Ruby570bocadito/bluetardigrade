# assets

Visual assets referenced from the documentation. Rendered outputs live
in this directory; their editable sources live in `src/` so the
rendered files stay uncluttered at the top level while everything
remains regenerable.

| File                        | Kind    | What it is                                            |
|-----------------------------|---------|-------------------------------------------------------|
| `logo.svg`                  | source  | bluetardigrade mark: tardigrade inside a shield (favicon, README, console) |
| `banner.svg`                | source  | README header banner (1280x340, mark inlined so GitHub's image proxy serves it standalone) |
| `diagram_arquitectura.png`  | output  | four-layer architecture diagram (linked from the root README) |
| `diagram_tracer.png`        | output  | tracer-bullet pipeline: devsensor -> engine -> alert |
| `console-panel.png`         | output  | console operations dashboard, live session (root README hero) |
| `console-flujo.png`         | output  | live telemetry feed view with the demo scenario flowing |
| `console-alertas.png`       | output  | console alert triage queue with live detections |
| `console-historico.png`     | output  | paged engine history view (SQLite/search filters) |
| `console-alertas-triaje.png`| output  | console alert detail with a real triage decision recorded |
| `console-reglas.png`        | output  | console rules view (root README) |
| `console-cadenas.png`       | output  | console kill-chain chains view (root README) |
| `console-supresiones.png`   | output  | console operator suppressions view (root README) |
| `console-live.gif`          | output  | ~16s loop of the alerts view while detections arrive (root README) |
| `console-busqueda.gif`      | output  | search interaction: typing `lsass` filters the alert queue live (root README) |
| `console-respuesta-activa.png` | output | active response view over a live armed engine: real audit queue with the executed/denied/followup classes (F1 pair on top, one `action_id` shared), arm and audit-health cards (added by 02-B, see `src/capture_respond.mjs`) |
| `console-respuesta-filtro.png` | output | active response view with the followups class filter active: 1 real followup record, honest `de 12 en la ventana` count (added by 02-B) |
| `console-respuesta-activa-fallback.png` | output | same view after a DEGRADED kill: tail of a real fd-exhaustion live-fire (pidfd_open EMFILE -> classic-kill fallback, target verified dead) plus the R2 fail-safe denial under the same exhaustion (added by 02-B; root README, Web console section) |
| `src/diagram_arquitectura.html` | source | self-contained HTML/CSS source of the architecture diagram (1060px canvas) |
| `src/diagram_tracer.html`   | source  | self-contained HTML/CSS source of the pipeline above (900px canvas) |
| `src/capture_console.mjs`   | source  | Playwright script that produces the `console-*` captures (see header for prerequisites) |
| `src/capture_respond.mjs`   | source  | Playwright script that produces the `console-respuesta-*` captures over a live armed engine (see header for prerequisites; added by 02-B) |
| `src/assemble_gif.py`       | source  | assembles `console-busqueda.gif` from the per-frame PNGs the capture script leaves in the temp dir |

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

1. Bring the stack up: engine, `web/console-service` and the console
   (a production build renders cleaner screenshots than dev mode: no
   dev-tools button).
2. Run `node src/capture_console.mjs` (prerequisites in the script
   header). The active-response shots come from their own harness:
   `node src/capture_respond.mjs` (see its header for prerequisites
   and the lab recipe it expects).
3. Assemble `console-busqueda.gif` from the per-frame PNGs the script
   leaves in the temp dir: `python3 src/assemble_gif.py <frames-dir>`.
   The current `console-*.png` set and `console-live.gif` were
   recaptured with the bluetardigrade rename round over a production
   console build fed by `sf-devsensor` (engine, console and a beacon
   loop driving the live view; frames at ~1.2s, GIF at 960px).

`console-respuesta-activa-fallback.png` (companion capture from the
02-B fd-exhaustion round; produced by that round's session driver, see
its acta) documents the DEGRADED kill mechanism with a real kernel
errno instead of a stub: the lab exhausts the armed engine's fd table
with idle TCP connections, delivers the kill over a connection accepted
before the exhaustion (so `pidfd_open` fails with `EMFILE`), and the
engine executes through the classic-kill fallback —
`fallback_reason=emfile` in the API response and the engine log, target
verified dead. Note what the JSONL does NOT show: by contract a
successful kill writes ONE pre-signal line without the mechanism, so
the tail rows read as plain executed attempts; the mechanism evidence
lives in the response and the log, and the `mechanism` / `pidfd:
<errno>` tags render only on the followup line of a committed send that
FAILED (the layer4->signal TOCTOU window — bounded at <200us on an
fsync-fast host, measured, not stubbed).

The captures show the console fed by the real engine replaying the
`sf-devsensor` demo scenario; the header chip labels the source
honestly (`sf-devsensor (demo)`). For host-telemetry captures, run
`sf-sensor` instead and label the README accordingly.

Keep the PDF as the single source of the full architecture document;
these PNGs are only summary visuals for the README.

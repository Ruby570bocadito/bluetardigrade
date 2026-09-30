# assets

Visual assets referenced from the documentation. Rendered outputs live
in this directory; their editable sources live in `src/` so the
rendered files stay uncluttered at the top level while everything
remains regenerable.

| File                        | Kind    | What it is                                            |
|-----------------------------|---------|-------------------------------------------------------|
| `diagram_arquitectura.png`  | output  | four-layer architecture diagram (linked from the root README) |
| `diagram_tracer.png`        | output  | tracer-bullet pipeline: devsensor -> engine -> alert |
| `console-panel.png`         | output  | console operations dashboard (root README, Web console section) |
| `console-alertas.png`       | output  | console alert triage queue (root README) |
| `console-reglas.png`        | output  | console rules view (root README) |
| `console-cadenas.png`       | output  | console kill-chain chains view (root README) |
| `console-busqueda.gif`      | output  | search interaction: typing `lsass` filters the alert queue live (root README) |
| `src/diagram_arquitectura.html` | source | self-contained HTML/CSS source of the architecture diagram (1060px canvas) |
| `src/diagram_tracer.html`   | source  | self-contained HTML/CSS source of the pipeline above (900px canvas) |
| `src/cover.html`            | source  | cover page used to produce `docs/arquitectura-tecnica-v0.1.pdf` |
| `src/cover-v0.2.html`       | source  | cover page used to produce `docs/arquitectura-tecnica-v0.2.pdf` |
| `src/cover-v0.3.html`       | source  | cover page used to produce `docs/arquitectura-tecnica-v0.3.pdf` |
| `src/cover-v0.4.html`       | source  | cover page used to produce `docs/arquitectura-tecnica-v0.4.pdf` (rendered by `scripts/arq_v04/render_cover.mjs`) |
| `src/cover-v0.5.html`       | source  | cover page used to produce `docs/arquitectura-tecnica-v0.5.pdf` (rendered by `scripts/arq_v04/render_cover.mjs`) |
| `src/capture_console.mjs`   | source  | Playwright script that produces the `console-*` captures (see header for prerequisites) |

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
   header). It writes the five PNGs into this directory.
3. Assemble `console-busqueda.gif` from the per-frame PNGs the script
   leaves in the temp dir (resize to ~1100px wide, adaptive palette,
   ~450ms per frame with a long hold on the final frame).

The captures show the console fed by the real engine replaying the
`sf-devsensor` demo scenario; the header chip labels the source
honestly (`sf-devsensor (demo)`). For host-telemetry captures, run
`sf-sensor` instead and label the README accordingly.

Keep the PDF as the single source of the full architecture document;
these PNGs are only summary visuals for the README.

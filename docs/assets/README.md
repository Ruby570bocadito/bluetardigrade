# assets

Visual assets referenced from the documentation. Sources and outputs
live side by side so a diagram can be regenerated with a single edit
plus a screenshot.

| File                      | Kind    | What it is                                            |
|---------------------------|---------|-------------------------------------------------------|
| `diagram_arquitectura.png`| output  | four-layer architecture diagram (linked from the root README) |
| `diagram_arquitectura.html`| source | self-contained HTML/CSS source of the diagram above (1060px canvas) |
| `diagram_tracer.png`      | output  | tracer-bullet pipeline: devsensor -> engine -> alert |
| `diagram_tracer.html`     | source  | self-contained HTML/CSS source of the pipeline above (900px canvas) |
| `cover.html`              | source  | cover page used to produce `docs/arquitectura-tecnica-v0.1.pdf` |

## Regenerating a diagram

1. Edit the `.html` source (plain HTML/CSS, no build step; the root
   element carrying the canvas is `.canvas`).
2. Open it in any Chromium-based browser at 100% zoom and screenshot
   the `.canvas` element (or use Playwright:
   `page.locator('.canvas').screenshot(...)` at `deviceScaleFactor: 2`
   for a crisp 2x PNG).

Keep the PDF as the single source of the full architecture document;
these PNGs are only summary visuals for the README.

# Plan de ronda — Pulimiento B (2026-10-05)

- **THEME-1/2/3** — tema claro/oscuro de la consola: script de arranque sin
  destello (`layout.tsx`), selector en la cabecera (`theme-toggle.tsx`, nuevo)
  con persistencia en `localStorage`, preferencia del sistema y `color-scheme`;
  paleta clara de superficies y de datos en `globals.css` (remap de la rampa
  zinc y de los acentos de estado bajo `html.light`, overrides del sistema de
  superficies y de los tokens viz/severidad/series/estados), adaptación al tema
  de `dot-grid.tsx` y `entity-graph.tsx` (colores fijos de oscuro a tokens).
- **Limpieza** — `globals.css` tiene los bloques de scrollbar y `::selection`
  duplicados (dos definiciones que compiten en cascada): se dejan una sola.
- **README** — `web/console/README.md` documenta «one emerald interaction
  accent» y «dark-mode locked»: deriva respecto al código (acento azul desde el
  rediseño neutro). Se corrige y se documenta el tema dual y el selector.
- **Validación** — nuevo `scripts/dev-tests/check_console_theme.py`: contraste
  WCAG de los pares clave de ambos temas y separación de la escala de
  severidad/series (CIEDE2000 con simulación CVD), para que la paleta clara
  esté validada igual que la oscura.
- Ficheros: `globals.css`, `layout.tsx`, `shell.tsx`, `theme-toggle.tsx` (nuevo),
  `dot-grid.tsx`, `entity-graph.tsx`, `web/console/README.md`,
  `scripts/dev-tests/check_console_theme.py` (nuevo), `changelog.d/`.

Nota: `TODO.md` y los planes del resto de carriles no existen todavía en
`origin` (ningún carril ha publicado rama ni `docs/agentes/`); las tareas se
derivan del rol asignado a este carril. Los informes de Pulimiento A y del
resto no están disponibles; se consultará en la próxima ronda.

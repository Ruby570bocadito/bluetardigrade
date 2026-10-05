# Plan de ronda — Implementación B (2026-10-05, ronda 3)

- Tarea del TODO: **REP-4** (gráficas en los informes: las mismas gráficas de la
  consola, exportables a PNG o SVG) sobre la vista «Informes» de la ronda 2, más el
  apunte pequeño del backlog: enlace «Informe del caso» desde la ficha de incidente
  al informe de incidente (`?view=informes&informe=incident&caso=<id>`).
- Ficheros: `web/console/src/components/console/reports-view.tsx` (sección de
  gráficas por kind, fuera de la hoja de impresión), `incidents-view.tsx` +
  `shell.tsx` (enlace al informe del caso), informe/roadmap.
- Por qué: es la única tarea de mi cola sin bloquear — AD-5/AD-6 y el cierre de
  SET-3 esperan la ronda en curso de IMP-A (plan 16h05: AD-1, AD-2 y campos de
  estado), REP-3 espera rutas de descargas y SET-1 la API de ajustes. REP-4 usa
  datos que el motor ya sirve desde REP-1 parte A.
- Diseño: las gráficas se renderizan con los mismos componentes de la consola
  (`ChartCard` + donut/barras/columnas apiladas), que ya traen leyenda, tabla gemela
  y el menú de exportación PNG/SVG/CSV de VIZ-6; quedan fuera de la hoja imprimible
  (tinta honesta en papel). El informe de incidente no inventa gráficas: su contenido
  es la cronología y las alertas. Sin solape: SEG-B declaró analista/reactbits;
  PUL-A motor; PUL-B plan 4a (axe/Lighthouse) no toca mi área; la fusión con la
  ronda zinc de PUL-B ya está resuelta y publicada en mi rama.

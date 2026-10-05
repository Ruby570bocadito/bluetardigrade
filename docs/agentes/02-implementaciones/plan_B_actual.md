# Plan de ronda — Implementación B (2026-10-05, ronda 3)

Nota: `TODO.md` sigue sin existir; tareas de `docs/ROADMAP.md` (candidatos de
gráficas del backlog de `roadmap_B.md`) más la deuda de docs que Pulimiento A
me asignó en su ronda 12h13. origin/main sin cambios (base `5e168ba`); la
única rama ajena es `carril/pulimiento-a` (docs de CLI, sin solape).

## Tareas cogidas (identificadores de ROADMAP / encargos)

1. **H5 gráficas — «Ciclo de vida por táctica»**: columnas apiladas en el
   dashboard (táctica ATT&CK × estado de triage nuevas/reconocidas/cerradas)
   con gemelo de tabla; función pura en `lib/soc-metrics.ts` + pruebas.
2. **H5 gráficas — «Evolución del riesgo por equipo»**: nueva gráfica de
   líneas multiserie (`components/charts/line-chart.tsx`, huecos honestos
   cuando no hay motor o el host sale del top-5) alimentada por muestreo
   real de `stats.hot_hosts` cada 10 s (10 min de ventana); lib
   `lib/risk-history.ts` + pruebas; paleta categórica con tope de 4 series.
3. **Deuda docs (encargo de PUL-A)**: la fila «Console» del inventario de
   `docs/ARCHITECTURE.md` dice «(no provider token streaming)» — stale desde
   mi ronda 2; la actualizo a streaming nativo con guardas de tiempo.

Fuera de alcance: vista de árbol global (pende del endpoint Go de
Implementación A, sin rama publicada) y verificación con proveedor/host real
(sin laboratorio en este entorno).

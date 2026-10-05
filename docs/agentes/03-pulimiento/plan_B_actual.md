# Plan de ronda — Pulimiento B (2026-10-05, ronda 3, ~15h05 Madrid)

Base: `a1bca4f` (main tras el cierre de la ronda 1, PR #20). Mi rama
`carril/pulimiento-b` recreada desde ahí (la anterior ya estaba fusionada).

## Tareas cogidas (encargo del responsable + TODO.md)

1. **THEME-2 (cierre total, acento zinc)**: la familia `--primary*`
   pasa de azul a **zinc** en los dos temas (el azul deja de ser acento
   de interacción) y migran las **6 clases `blue-*` crudas restantes**
   (`hover:text-blue-300` en `operations-overview.tsx` y
   `platform-status.tsx`, `text-blue-100` en `detection-hub.tsx` y
   `alert-actions.tsx`, `text-blue-400` y `text-blue-300` en
   `dashboard.tsx` — este último desbloqueado: la ronda 4 de IMP-B ya
   está fusionada). Con las 6 fuera se **retira el shim**
   `--color-blue-*` de `html.light`. También a zinc el cromo azul que
   no era token: `.icon-tile`, `.ambient-glow`, `.star-border`
   (`--sb-color`), scrollbar hover, `::selection`, `--ring`,
   `--sidebar-primary*` y los literales rgba de
   `entity-graph.tsx`/`dot-grid.tsx`/`star-border.tsx`/
   `spotlight-card.tsx` (los que decoran, siempre theme-aware). **No se
   toca el color de datos**: `--sev-*`, `--series-*`, `--seq-*`,
   `--status-*`, `--chart-*` y las rampas de heatmap quedan intactas.
   Contraste validado con `check_console_theme.py` (los suelos AA por
   rol no cambian; el checker es agnóstico de valores).
   Ficheros: `globals.css`, los 5 .tsx con azules crudos, 4 ficheros
   reactbits/charts con literales, `check_console_theme.py` (pares
   nuevos del acento zinc si procede).
2. **Dashboard en pestañas (base de POL-7)**: unificar el estilo de
   pestañas de la consola (hoy `detection-hub.tsx`, `fleet-parts.tsx`
   «Añadir equipos», `noc-mode.tsx`, `alerts-view.tsx` En vivo/Histórico
   y `chart-frame.tsx` usan variantes distintas) en un componente
   compartido con la misma píldora activa `bg-primary-tint/15 +
   text-primary-soft + ring-primary/25`, semántica `role=tablist/tab`
   con navegación de flechas y `prefers-reduced-motion`. Pule densidad
   del Panel: el hueco bajo «Alertas recientes» (grid `xl:grid-cols-2`
   con paneles de altas distintas en `dashboard.tsx` orden 12).
   **Sin cambiar funcionalidad**: mismos ids, deep links y handlers.
   Ficheros: `components/console/ui-tabs.tsx` (nuevo, kit base POL-7),
   `detection-hub.tsx`, `fleet-parts.tsx`, `noc-mode.tsx`,
   `alerts-view.tsx`, `dashboard.tsx` (solo el bloque de densidad),
   tests si aplica.
3. **POL-12 (consola, README y SECURITY.md)**: pase de coherencia
   documental del área: `SECURITY.md` al día (alcance, versión soportada
   y contacto coherentes con el árbol actual), `README.md` sin deriva
   (puertos, árbol de carpetas, enlaces y nombres), y mensajes/labels de
   la consola consistentes. POL-12 aún no existe en `TODO.md`: se
   propone su texto en el informe.
4. **POL-10**: capturas nuevas del dashboard en pestañas en los dos
   temas para el README, con el arnés de la casa
   (`tools/console-tests` + fixtures; si Chromium falla en este entorno
   como en rondas anteriores, se declara igual que POL-8/9 y se entrega
   el resto). Árbol de carpetas del README actualizado.

Limpieza de ronda: imports sin uso, restos temporales, `.gitignore`.

## Coordinación

- Publicada esta ronda: solo SEG-B (`.github/workflows`,
  `scripts/dev-tests/check_workflows.py`, Makefile, modelo de amenazas).
  **Solape: cero** — mis ficheros son consola/README/SECURITY.md.
  SECURITY.md: SEG-B no lo toca esta ronda (su plan no lo lista); lo
  reviso tras el fetch final por si acaso.
- IMP-A/IMP-B/PUL-A/SEG-A sin plan publicado aún al escribir esto: se
  re-verifica solape en el fetch previo al push.
- El pipeline de nonce CSP (asignación SEG-B, BAJA) sigue en cola para
  una ronda propia; esta ronda lo prioriza el responsable con zinc,
  pestañas, POL-12 y POL-10.

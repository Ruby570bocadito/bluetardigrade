# Plan de ronda — Implementación B (2026-10-05, ronda 2 del nuevo ciclo)

- Tareas del TODO (prioridades de la ronda 2 para este carril): **SIM-4** (pantalla de
  validación: batería, ejecución en curso, historial y tendencia; 501 = «no armada»),
  **REP-1** (pantalla del catálogo `/api/reports`, descarga CSV/JSON y vista imprimible),
  **informe de ruido** (`/api/noise` con acceso directo a «crear supresión») y **SIM-3**
  (colorear la matriz ATT&CK existente según validación por escenario). Además la
  reorganización del panel en **pestañas Resumen / Detección / Equipos y actividad**,
  corrección directa del feedback de la ronda 1 (todo apilado, ATT&CK repetido, accionable
  al final).
- Ficheros: nuevos `web/console/src/lib/simulation.ts`, `reports.ts`, `noise.ts` (+tests),
  `web/console/src/components/console/scenario-view.tsx`, `noise-view.tsx`,
  `reports-view.tsx` (+CSS module de impresión), `web/console/src/app/api/engine/[...path]/route.ts`
  (añadir `POST /api/scenarios/run` a la lista cerrada de escrituras), `dashboard.tsx`
  (pestañas + SIM-3), `attack-matrix.tsx`, `detection-hub.tsx`, `url-state.ts`,
  `console-commands.ts`, `keyboard-nav.ts`, `shell.tsx` y sus tests.
- Por qué: los tres endpoints que bloqueaban estas pantallas ya están en `main`
  (`/api/scenarios*` de la ronda SIM-4 parte A, `/api/reports*` y `/api/noise` de la ronda
  REP-1 parte A + API de ruido de IMP-A); la pantalla era la parte B pendiente. AD-5/AD-6
  siguen bloqueadas (AD-1 no está ni en `main` ni en la rama de IMP-A) y SET-3/REP-3/SET-1
  esperan campos y rutas de IMP-A: no se tocan esta ronda.
- Sin solape previsto: PUL-B excluyó `dashboard.tsx` de su barrido de blues; IMP-A solo
  toca Go/OpenAPI; PUL-A metadatos del spec; SEG-A/B revisión. Los ficheros compartidos
  (`TODO.md`, `PLAN-DETALLADO.md`, `CHANGELOG.md`, `openapi.yaml`) no se editan: fragmento
  en `changelog.d/IMP-B-*.md`.

# IMP-2 — estado

## Hecho (últimas 24 h)
- C-2 (TEAM-3 consola) completa y en main: lente de asignación en la cola
  («Mis alertas» / «Sin asignar»), chip de responsable en filas, bloque de
  asignación en el detalle (asignármela, asignar a otro, reasignar, quitar)
  y «Asignar» en lote desde la barra de selección con fallos por id.
  Commits 6d29f9c + 9b86d8b; validación local: 572 tests, tsc, next build.
- Decisión de diseño (contrato permitía ambas): los filtros de asignación
  se aplican en consola sobre el anillo en vivo y las páginas del histórico
  (el objeto Alert lleva el trío por REST y por SSE); así la cola se
  actualiza en tiempo real con `alert_lifecycle` y no hay segundas
  suscripciones. El merge del trío en `applyAlertLifecycle` es seguro con
  el guard de frescura: `Assign()` no mueve `at`, y ausencia de trío =
  sin asignar (omitempty del motor).
- Ritual: punto TEAM-3 fuera de TODO.md + entrada changelog.d/
  (console-alert-assignment.md). Claim liberado.

## En curso
- (nada — siguiente tarea tras DIR)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- PUL: el job `govulncheck, osv-scanner, cargo audit` aparece «cancelled»
  en tres corridas seguidas (superseded por pushes rápidos, p. ej.
  9b86d8b → 3bc9167). Con concurrency cancel-in-progress el escaneo de
  dependencias nunca llega a terminar en días movidos; conviene grupo de
  concurrency propio o cola sin cancelación (`.github/workflows/`).

## Propuestas para el roadmap
- F5 (siguiente en mi carril): seguir el kit POL-7 en el resto de vistas y
  tema claro, como apunta el ROADMAP.
- Añadir el filtro de asignación al lenguaje de búsqueda
  (`GET /api/alerts/search`, propuesta ya apuntada por M-1) y con ello
  lente de asignación persistida en la URL y compartible.
- Página más corta que `limit` en modo tienda con filtro de asignación:
  cuando el ciclo de vida migre a SQLite (hornada 2), la cola sin asignar
  puede paginar exacta sin ventana.

## Estado: VERDE
- CI de main vigilada en el push de C-2; suite local completa en verde
  antes de cada push (PROTOCOLO §1.6).

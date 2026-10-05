# Plan de ronda — Seguridad A (2026-10-05, ronda 7, ~19h20 Madrid)

Base: `46317ef` (mi ronda 6). Estado de los carriles al abrir: ninguna
punta ha cambiado desde el cierre de la ronda 6 (IMP-A sigue en su plan
`2c32013`, `internal/ad` no existe; SEG-B solo añadió el diseño SEC-2
docs-only `b0eaa60`, dirigido a IMP-A; PUL-B y PUL-A sin código nuevo
desde lo ya revisado). Sin encargos ALTA para este carril en los
informes nuevos de SEG-B (ronda 4) y PUL-B (16h40).

Con los carriles ajenos congelados, la ronda vuelve a mi pendiente de
más prioridad propia: los paquetes del motor que ninguna ronda anterior
auditó a fondo (rondas 1-4 cubrieron ingest/intel/rules/threshold/
beacon-load/suppress/sigma/enroll/scenario/scenrun/report/sensor).
Quedan sin lectura profunda la persistencia y las capas de decisión.

Tareas:

1. **Auditoría funcional de `internal/store`** (SQLite: esquema,
   migraciones, transacciones, reloj/retención, límites de consultas,
   cierre limpio) y **`internal/api`** (rutas REST: autenticación,
   validación de entrada, concurrencia del hub, bordes de paginación,
   writers de CSV/descargas). Bugs funcionales → corregir con test que
   falle antes y pase después.
2. **Auditoría funcional de `internal/correlate` + `internal/risk` +
   `internal/incident`** (lógica de detección: ventanas, bordes de
   recuento, uniones de reglas en cadena, estados de incidente) — si el
   tiempo de ronda lo permite; lo no cubierto pasa a la ronda 8.
3. **Obligatorio de ronda**: `-race -count=5` en los paquetes con
   goroutines que toque el código propio corregido; las ramas ajenas no
   cambian desde la ronda 6 (su barrido `-race` de esa ronda sigue
   vigente y se cita como evidencia, no se repite).

Ficheros que espero tocar: `internal/store/**`, `internal/api/**`,
`internal/{correlate,risk,incident}/**` (si toca corregir), sus tests,
`docs/agentes/04-seguridad/` y `changelog.d/` si corrijo algo ya
fusionado en main.

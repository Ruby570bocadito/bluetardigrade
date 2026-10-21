# claim: m4-consulta-bd

- ID: IMP-1 (motor Go)
- Fecha: 2026-10-21 19:30 UTC
- Tarea: M-4 (TODO.md F3 · TASKS.md hornada 3, libre; no consta en el
  ROADMAP de DIR — se propone su alta al cierre) — consulta de la base de
  datos SOLO LECTURA (la evidencia es append-only), límites de filas y de
  tiempo, para administradores y con cada consulta auditada. Habilita C-4.
- Rutas que voy a tocar (por fichero, para convivir con el claim activo
  `m2-ad7-login-ldaps` de IMP-1):
  - `internal/store/query_ro.go` + `internal/store/query_ro_test.go`
    (NUEVOS: handle SQLite de solo lectura mode=ro + query_only, tabla de
    auditoría `query_audit` con techo y prune)
  - `internal/api/db_query.go` + `internal/api/db_query_guard.go` +
    `internal/api/db_query_test.go` + `internal/api/db_query_guard_test.go`
    (NUEVOS: guard SQL de una sola sentencia SELECT, endpoint
    `POST /api/db/query`, tope de filas/tiempo, auditoría de cada intento)
  - `internal/api/hub.go` (campo del hub + registro de la ruta) — COMPARTIDO
    con el claim m2 (mismo patrón campo+ruta): cambios estrictamente
    aditivos, pull --rebase antes de cada push y conflicto resuelto
    conservando ambas intenciones
  - `cmd/engine/flags.go`, `cmd/engine/runtime.go`, `cmd/engine/run_api.go`
    (flag `-api-db-query` y su armado en el arranque) — COMPARTIDO con m2
    por el mismo motivo
  - `docs/api/openapi.yaml` (referencia del endpoint nuevo) — COMPARTIDO
  - `docs/agentes/estado/IMP-1.md`, `TASKS.md` (fila M-4), `TODO.md` (borrar
    punto al cerrar), `changelog.d/` (entrada al cerrar)
- Fuera de mi zona: `web/`, `rules/`, `sensor/`, `internal/ad/`, `docs/`
  (salvo `docs/api/`), resto de `internal/` fuera de `internal/store/` y
  `internal/api/`.
- Sin dependencias nuevas (todo con modernc.org/sqlite ya presente).

# claim: fix-st1003-db-query

- ID: IMP-1 (motor Go + sensor Rust)
- Fecha: 2026-10-21 20:16 UTC
- Tarea: la run de CI de la cabeza (7608e54) falla en el job «Go engine»:
  staticcheck ST1003 sobre el código de M-4 (identificadores con `Db`
  en vez de `DB`). La run de M-4 propia fue cancelada por supersesión y
  el fallo aflora ahora. Build roto para todos → fix mínimo (excepción
  §2, con claim por la regla de DIR sobre fixes de build roto).
- Cambio: renombrado mecánico de identificadores `DbQuery` → `DBQuery`
  (EnableDbQuery, handleDbQuery, auditDbQuery, apiDbQuery). Sin cambio
  de comportamiento ni de contrato (`POST /api/db/query` intacto).
- Rutas: `internal/api/db_query.go` (+ su test), `cmd/engine/run_api.go`,
  `cmd/engine/flags.go`.

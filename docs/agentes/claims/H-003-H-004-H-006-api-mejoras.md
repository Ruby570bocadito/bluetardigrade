# claim: H-003-H-004-H-006-api-mejoras

- ID: IMP-1
- Fecha: 2026-10-22 (hora UTC del commit)
- Tarea: hornada de los tres hallazgos BAJO de TEST ronda 1 dirigidos a
  IMP-1, sin cambio de contrato salvo donde el hallazgo lo pide:
  - H-003: contar y ack de la línea sobredimensionada en la fase de
    datos del ingest (hoy se cierra en silencio; `ingest_rejected`
    no se mueve).
  - H-004: `POST /api/db/query` con cuerpo sobre el tope debe dar el
    diagnóstico explícito de tamaño (mismo patrón que assign) en vez
    del mensaje genérico de JSON malformado; el código sigue siendo 400.
  - H-006: `sev` en /api/alerts deja de ignorarse en silencio: alias
    validado de `severity` (mismo enum, 400 con los valores válidos).
  - En la misma función de H-006: retirar el bloque `unassigned`
    triplicado que quedó en parseRecordFilter (código muerto idéntico
    x3, sin cambio de comportamiento).
- Rutas:
  - `internal/ingest/ingest.go` (+ test en el paquete)
  - `internal/api/db_query.go` (+ test en el paquete)
  - `internal/api/filters.go` (+ test en el paquete)
  - `docs/api/openapi.yaml` (parámetro `sev`, alias de `severity`) y
    referencia regenerada en `docs/OPERATIONS.md` (guard
    check_api_reference; viaja con el código según OWNERSHIP)
  - `changelog.d/` (una entrada por hallazgo)

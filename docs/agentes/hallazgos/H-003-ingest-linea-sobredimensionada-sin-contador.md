---
Tipo: mejora
Severidad: BAJO
Persona: Usuario malintencionado
Dirigido a: IMP-1
Estado: resuelto-pendiente-verificación
---
Pasos para reproducir: con el motor arrancado, enviar por TCP a
127.0.0.1:7777 una línea NDJSON de 2 MB (cap de línea: 1 MiB,
`internal/ingest/ingest.go`, `nSize = 1 << 20`) y consultar
`GET /api/stats` antes y después.
Resultado esperado: el descarte queda reflejado en algún contador.
Resultado real: `dropped: 2 | ingest_rejected: 0 | events_total: 1`
idénticos antes y después del envío: la línea sobredimensionada se
descarta en silencio. Solo la fase AUTH cuenta (`scanner.Err()` con
`errAuthLineTooLong`, ingest.go:443 incrementa `rejected`); la fase de
datos no tiene contador equivalente.
Sugerencia: incrementar un contador (p. ej. `ingest_rejected` o
`dropped` con causa) cuando `scanner.Err()` cierre la conexión en la
fase de datos.

Resolución (IMP-1, commit 128e74b): la línea sobredimensionada en fase de datos cuenta como ingest_rejected y ackea la causa antes de cerrar (test TestOversizedDataLineCounted)

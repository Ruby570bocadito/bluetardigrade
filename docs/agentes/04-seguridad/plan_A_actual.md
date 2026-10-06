# Plan de ronda — Seguridad A (2026-10-06, ronda 11, ~00h10 Madrid)

Base: `aad1aed` (mi ronda 10; sandbox reiniciado y reconstruido:
repo re-clonado, Go 1.26.0 reinstalado). `origin/main` sigue en
`35cd866`. Novedad al abrir: CUATRO carriles movieron.

- **IMP-A `bc91c7d`** (7 commits, ~6.1k líneas): publicó el cierre
  retenido — AD-1/AD-2/SET-3 (`internal/ad`: conector LDAPS de solo
  lectura, postura de dominio, estado de plataforma en `/api/stats`)
  y SEC-2 (`internal/secretfile`: sobres versionados, DPAPI
  LOCAL_MACHINE en Windows, plain 0600 en POSIX, `engine
  secret-write` por stdin) + `internal/api/ad.go` (+193) e
  `internal/store/ad.go` (+367). **Mi pendiente 1 por fin
  desbloqueado: esta es la tarea grande de la ronda.**
- **SEG-B `55c8b35`**: guardia anti-fórmulas en exportaciones CSV del
  lado consola (`chart-export.ts`, `alert-actions.tsx`).
- **IMP-B `5ecbcc4`**: i18n fase 1 (armazón bilingüe, consola-only,
  0 ficheros Go verificado por stat).
- **PUL-A `e66ece5`**: docs-only.

Tareas:

1. **Auditoría del código AD/SEC-2 de IMP-A** (prioridad 1 del
   roadmap): `internal/secretfile` (manejo de errores, modo 0600,
   Zero, paridad de texto plano, dpapi_other honesto),
   `internal/ad` (conector LDAPS: bind, timeouts, límites, re-lectura
   de credencial por sync y puesta a cero), `internal/api/ad.go` +
   `internal/store/ad.go` (auth, límites, concurrencia) y los deltas
   de `internal/ingest` y `internal/tlsutil`. Fix con test
   fail-before/pass-after por cada bug real.
2. **Obligatorio de ronda**: `-race -count=5` en los paquetes con
   goroutines que toca la punta de IMP-A (ad/secretfile/api/store/
   ingest según toque) sobre su carril; PUL-A docs-only y PUL-B sin
   mover (evidencia vigente); IMP-B consola-only.
3. **Revisión rápida de consolas ajenas si el presupuesto deja**:
   guardia CSV de SEG-B (¿cubre `=`/`+`/`-`/`@`, tab y CR?) y el
   armazón i18n de IMP-B (paridad de diccionarios, html lang,
   sincronía multi-pestaña). Mis dos hallazgos de la ronda 5:
   re-verificar contra `5ecbcc4`.

Cierre: checklist CI completo (reinstalando staticcheck si hace
falta), informe, roadmap, changelog solo si hay fix; push tras
`merge-tree` contra las cinco puntas.

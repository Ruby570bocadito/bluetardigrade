# claim: fix-st1000-package-docs

- ID: IMP-1 (motor Go + sensor Rust)
- Fecha: 2026-10-21 20:31 UTC
- Tarea: segunda oleada del job Go de CI en rojo — tras el fix ST1003
  (fd29623), el pase dos de staticcheck destapa tres ST1000: los
  comentarios de fichero de M-4 pegados a la cláusula `package` en
  internal/api/db_query.go, internal/api/db_query_guard.go y
  internal/store/query_ro.go. Mismo origen: la run de M-4 fue cancelada
  antes de que staticcheck la juzgara.
- Cambio: línea en blanco entre el comentario y `package` (el doc
  canónico de cada paquete ya vive en hub.go y store.go). Sin cambio de
  comportamiento. Verificado con staticcheck 2026.2.1 + Go 1.26.10 (el
  toolchain exacto de CI, ahora replicado en sandbox): pase 1 y pase 2
  en verde, sin más hallazgos detrás.
- Rutas: los tres ficheros citados.

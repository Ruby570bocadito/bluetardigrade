# claim: respond-scope-denial-log

- ID: SEG
- Fecha: 2026-10-22 (ronda 12)
- Tarea: barrido de internal/api sin revisión previa (forensic_read,
  export, alert_search, respond_write) mientras s2-yara-memoria está
  en vuelo (IMP-1). Los tres primeros limpios. Hallazgo BAJO en
  respond_write: el 403 por scope (cuenta limitada a grupos que
  intenta matar fuera de sus grupos) ocurre ANTES del manager — no
  llega al audit file (dominio de internal/respond) ni deja el
  log.Printf que los demás DENIED del propio handler sí dejan: un
  intento bien formado denegado por autorización en la superficie más
  destructiva no deja rastro en el engine. db_query (M-4) audita todas
  sus denegaciones — el estándar del paquete. Fix mínimo: el mismo
  log.Printf de la línea DENIED existente en la rama del scope; sin
  tocar internal/respond (la integración de denegaciones de consola en
  el audit file queda como propuesta de roadmap).
- Rutas que voy a tocar:
  - internal/api/respond_write.go (1 log line)
  - internal/api/respond_write_test.go (1 test de regresión)
  - changelog.d/respond-scope-denial-log.md (NUEVO)
  - docs/agentes/estado/SEG.md
- Verificación: go build/vet, test -race del paquete api.
- Sin solape: s2-yara-memoria (IMP-1) es sensor/; internal/api libre.

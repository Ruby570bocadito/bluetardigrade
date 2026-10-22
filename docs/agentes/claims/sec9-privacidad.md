# claim: sec9-privacidad

- ID: SEG
- Fecha: 2026-10-22 (sesión ronda 3)
- Rutas que voy a tocar:
  - internal/api/ (ad.go, domain_auth.go + tests): auditoría de lecturas de fichas de usuario y minimización del log de login
  - internal/store/ (ad.go, store.go + tests): tabla ad_read_audit y Prune de query_audit/ad_posture_history
  - cmd/engine/run_load.go: línea de log del prune
  - web/console/src/app/api/engine/[...path]/route.ts (+ test): cabecera X-SF-Account
  - TODO.md (retirar el punto SEC-9), changelog.d/, docs/agentes/estado/SEG.md

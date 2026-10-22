# claim: deps-audit-concurrency-comentario

- ID: PUL
- Reclamado: 2026-10-22 09:20 UTC
- Rutas: `.github/workflows/deps-audit.yml`, `docs/agentes/estado/PUL.md`
- Tarea: tablero PUL (quinta pasada de DIR) — ajustar el comentario del
  bloque concurrency a la realidad observada: con
  `cancel-in-progress: false` las runs EN CURSO completan, pero GitHub
  cancela las PENDIENTES intermedias y solo sobrevive la más nueva
  (observado hoy con cuatro pushes seguidos). Cambio de comentario
  únicamente, sin tocar la configuración.

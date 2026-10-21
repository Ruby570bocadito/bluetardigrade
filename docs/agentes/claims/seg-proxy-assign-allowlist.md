# claim: seg-proxy-assign-allowlist

- ID: SEG (seguridad y bugs)
- Fecha: 2026-10-21 19:40 UTC
- Tarea: bug hallado en la revisión transversal de TEAM-3 — el allowlist
  WRITES del proxy /api/engine
  (web/console/src/app/api/engine/[...path]/route.ts) no incluye las
  rutas de asignación del M-1: «Asignármela», reasignar, quitar y
  «Asignar» en lote reciben 405 read_only ANTES de llegar al motor. La
  asignación desde la consola está rota de punta a punta (motor PR #45
  sirve las rutas, la consola C-2 las llama, el proxy las rechaza).
- Rutas que voy a tocar:
  - `web/console/src/app/api/engine/[...path]/route.ts` — dos entradas en
    WRITES (analyst, 8 KiB espejo del motor, attributed) y el hint
    read_only actualizado
  - `web/console/src/app/api/engine/[...path]/route.test.ts` — regresión:
    reenvío de ambas rutas, 413 por cuerpo grande, atribución server-side
    (assignee preservado, by = cuenta), 403 a viewer
  - `changelog.d/` (entrada al cerrar) y `docs/agentes/estado/SEG.md`
- Sin solape con los claims activos m2-ad7-login-ldaps ni
  m4-consulta-bd (ambos en el motor Go; el fix vive en la consola Next).

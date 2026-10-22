- ID: IMP-2
- Fecha: 2026-10-22 07:20 UTC
- Tarea: C-4 — UI de consulta sobre POST /api/db/query: vista «Consulta BD»
  (solo admin, con aviso honesto para el resto), formulario SQL con
  max_rows/timeout_ms, tabla de resultados con meta (filas, ms, recorte),
  ejemplos sobre el esquema real y consultas recientes de sesión. Cliente
  lib/db-query.ts sobre engineCall. Bilingüe de nacimiento (dict dbQuery +
  nav/views), pines en el test de paridad.
- Rutas:
  - web/console/src/lib/db-query.ts (+ db-query.test.ts)
  - web/console/src/components/console/db-query-view.tsx
  - web/console/src/components/console/dashboard.tsx (solo tipo ConsoleView)
  - web/console/src/components/console/shell.tsx (icono, import y montaje)
  - web/console/src/lib/console-commands.ts (DESTINATION_IDS)
  - web/console/src/lib/i18n/dict-es.ts, dict-en.ts, i18n.test.ts
  - changelog.d/console-c4-consulta-bd.md (entrega)
  - docs/agentes/estado/IMP-2.md (al release)

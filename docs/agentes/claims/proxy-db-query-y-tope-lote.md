# claim: proxy-db-query-y-tope-lote

- ID: IMP-2
- Fecha: 2026-10-21 20:32 UTC
- Tarea: alinear la consola con las rutas que M-4 ya dejó en el motor:
  (1) POST /api/db/query en el allowlist WRITES del proxy (64 KiB, admin,
  petición de SEG en estado/SEG.md); (2) hint del 405 al día; (3) tope
  del lote de asignación 500→400: el cap de 8 KiB del motor es el techo
  real (~19 B/id) y un lote de 430-500 ids muere en 413 antes de llegar
  al 500. Sin solape con claim idea10-idiomas-panel (ficheros disjuntos).
- Rutas: `web/console/src/app/api/engine/[...path]/route.ts`,
  `web/console/src/lib/lifecycle.ts`,
  `web/console/src/lib/lifecycle.test.ts`,
  `changelog.d/console-db-query-proxy.md`,
  `changelog.d/console-batch-cap-400.md`

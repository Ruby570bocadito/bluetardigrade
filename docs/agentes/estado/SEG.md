# SEG — estado

## Hecho (últimas 24 h)
- Ronda 2, tarea 1: el allowlist WRITES del proxy /api/engine no incluía
  las rutas de asignación del M-1 — «Asignármela», reasignar, quitar y
  «Asignar» en lote recibían 405 read_only antes de llegar al motor
  (TEAM-3 roto de punta a punta). Fix mínimo: dos entradas (analyst, 8 KiB
  espejo del motor, attributed) y hint read_only actualizado. Regresión:
  reenvío de ambas rutas, 413, 403 a viewer, atribución server-side (by =
  cuenta, assignee intacto). Consola verde: 574 tests, tsc, build.
- Ronda 2, tarea 2: los dos últimos clientes salientes con redirects por
  defecto pasan a ErrUseLastResponse (patrón report/doctor/sumideros):
  getJSONInto envía el bearer del motor y Go solo limpia Authorization
  entre dominios (misma máquina con otro puerto la reenvía); apiHealthy,
  sin credencial, seguía un 3xx del puerto de ingest a URL ajena.
  Regresión: 302 es fallo definitivo y el destino recibe 0 peticiones.
  Suite Go completa verde (41 paquetes), vet y gofmt limpios.
- Sin hallazgos en la revisión extra de la ronda: flujo de asignación
  (alert_assign: cap 8 KiB, patrón hex, scope check antes de escribir;
  lifecycle: persistencia atómica 0600 y validación estricta; rule_tester:
  solo evalúa eventos contra el catálogo) y respond/kill (404 real si no
  armada, credencial del operador en constant-time con crypto/subtle,
  scope indistinguible entre host fuera de alcance e inexistente).

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- IMP-2: lifecycle.ts usa MAX_ASSIGN_BATCH_IDS=500, pero el cap de 8 KiB
  del motor deja el techo real en ~400 ids: un lote mayor recibe 400. O el
  cliente corta a 400, o petición a IMP-1 de subir el cap del batch.
- IMP-1/IMP-2: cuando aterricen las rutas en vuelo (POST /api/auth/domain
  de m2, POST /api/db/query de m4) harán falta entradas en el WRITES del
  proxy (rol admin) — lo mismo que acaba de pasar con la asignación.

## Propuestas para el roadmap
- (SEG) sec9-privacidad — minimizar PII en logins y líneas de tiempo,
  retención y auditoría de fichas.
- (SEG) sec2-dpapi — requiere Windows real; plan con Implementación A.

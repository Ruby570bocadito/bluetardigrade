# SEG — estado

## Hecho (últimas 24 h)
- Ronda 2: hallado y arreglado el bug que dejaba la asignación TEAM-3 rota
  de punta a punta: el allowlist WRITES del proxy /api/engine no incluía
  las rutas del M-1, así que «Asignármela», reasignar, quitar y «Asignar»
  en lote recibían 405 read_only antes de llegar al motor (motor PR #45
  las sirve, consola C-2 las llama, proxy las rechazaba). Fix mínimo: dos
  entradas en WRITES (analyst, 8 KiB espejo del motor, attributed) y hint
  read_only actualizado. Regresión: reenvío de ambas rutas, 413 por cuerpo
  grande, 403 a viewer, atribución server-side (by = cuenta, assignee
  intacto incluido el vacío). Suite consola verde: 574 tests, tsc, build.
- Revisión del resto del flujo de asignación sin más hallazgos:
  alert_assign (cap 8 KiB, patrón hex, scope check antes de escribir, 200
  con fallos por id), lifecycle (persistencia atómica 0600, validación
  estricta, evict FIFO), rule_tester (evalúa un evento contra el catálogo,
  32 KiB, sin parsear YAML del cliente), auth del motor centralizada
  (bearer + write-origin + scope) y del proxy (host pinning, cross-site,
  sesión, X-SF-Scope nunca del navegador).

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
- Detectado sin corregir (baja, sin credenciales en juego): apiHealthy
  (cmd/engine/runtime.go) y el cliente de escenarios mantienen la política
  de redirects por defecto; unificar si se tocan.

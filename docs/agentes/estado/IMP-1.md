# IMP-1 — estado

Dos instancias comparten este ID esta jornada (historial en git log).

## Hecho (últimas 24 h)

Sesión st1003 (fix del job Go de CI, cerrada): la run de la cabeza
fallaba por cinco ST1003 del código M-4 (DbQuery → DBQuery; su run
propia fue cancelada por supersesión). Renombrado mecánico en
db_query.go/hub.go/run_api.go/flags.go; contrato POST /api/db/query
intacto; suites de api/engine/store, build, vet y gofmt en verde (fd29623).

Sesión make-tabs (emergencia de build, cerrada): 0e20698 dejó las
recetas del Makefile con 8 espacios; sin .RECIPEPREFIX, `make` moría
en todos los targets (ci.yml nunca invoca make y no lo ve). Fix
e1dc5c6: tabs restaurados (diff -w vacío) y check_makefile_tabs.py en
el target ci local; el guard atrapó esta misma expansión en mi sesión.

Sesión m4 (M-4, cerrada): POST /api/db/query solo lectura con topes y
auditoría; contrato en openapi. — Sesión o2 (cerrada): pack AD (5
reglas, 119 total) + 5 escenarios sintéticos; gate verde.

## En curso
- (nada) — zona al día: m2/m4 en main, s2 en PR #48 en revisión.

## Bloqueado
- (nada)

## Peticiones
- A DIR: «Tareas por rol» aún marca m4-consulta-bd EN VUELO con claim
  activo; M-4 está cerrada (5e0eeea) — quitar la línea.

## Propuestas para el roadmap
- Alta de C-4 sobre POST /api/db/query (contrato ya en openapi).
- Con M-7 (WEF): pack AD por ID de evento (4625/4769/4662/4728/4732/4756/7045).

## Estado: VERDE — riesgos
- Tres solapamientos de instancia paralela en la jornada; claims con
  fecha UTC y re-check antes de cada push. El guard local de tabs ya
  demostró su valor.

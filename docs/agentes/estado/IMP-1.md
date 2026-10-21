# IMP-1 — estado

Dos instancias comparten este ID esta jornada (historial en git log).

## Hecho (últimas 24 h)

Sesión st100x (fix del job Go de CI, cerrada): la run de la cabeza
fallaba por staticcheck que la run de M-4 (cancelada por supersesión)
nunca juzgó: cinco ST1003 (DbQuery → DBQuery) y tres ST1000 (comentario
de fichero pegado a `package`, ahora detached). Ambos pases en verde
con el toolchain exacto de CI replicado en sandbox (Go 1.26.10).

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
- Cuatro solapamientos de instancia paralela en la jornada; claims con
  fecha UTC y re-check antes de cada push. staticcheck ya corre en el
  sandbox con el toolchain de CI: los fixes de estilo salen verificados.

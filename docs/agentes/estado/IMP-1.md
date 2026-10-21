# IMP-1 — estado

Dos instancias comparten este ID esta jornada (historial en git log).

## Hecho (últimas 24 h)

Sesión make-tabs (emergencia de build, cerrada): 0e20698 dejó las recetas
del Makefile con 8 espacios; sin .RECIPEPREFIX, `make` moría en «missing
separator» en todos los targets (ci.yml no lo ve: nunca invoca make).
Fix mínimo e1dc5c6: tabs restaurados (diff -w vacío; build/vet del árbol
con M-2 en verde) y check_makefile_tabs.py en el target ci local; el
guard ya atrapó esta misma expansión en mi propia sesión antes del push.
- Duplicado descartado: mi claim make-ci-api-reference-guard (19:55 UTC)
  chocó con su entrega (19:54:08); solo aporté cabecera y el guard local.

Sesión m4 (M-4, cerrada): POST /api/db/query + -api-db-query, SQL de solo
lectura con topes de filas/tiempo, handle ro + query_audit; contrato en openapi.

Sesión o2 (O-2, cerrada): pack AD de 5 reglas (119) + 5 escenarios
sintéticos; gate verde (doble arreglo 3d3ca80/a6df346 resuelto).

## En curso
- (nada) — zona al día: m2/m4 en main, s2 en PR #48 en revisión.

## Bloqueado
- (nada)

## Peticiones
- A DIR: «Tareas por rol» aún marca m4-consulta-bd EN VUELO con claim
  activo; M-4 está cerrada (5e0eeea) — quitar la línea.
- A DIR: anotar en TODO.md la entrega de O-2 (escenarios ya en main).

## Propuestas para el roadmap
- Alta de C-4 sobre POST /api/db/query (contrato ya en openapi).
- Con M-7 (WEF): pack AD por ID de evento (4625/4769/4662/4728/4732/4756/7045).

## Estado: VERDE — riesgos
- Tres solapamientos de instancia paralela en la jornada (escenarios,
  Makefile, m2 con un minuto de diferencia). Claims con fecha UTC y
  re-check antes de cada push: la ventana se cierra, pero existe.

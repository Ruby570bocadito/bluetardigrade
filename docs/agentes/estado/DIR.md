# DIR — estado

## Hecho (últimas 24 h)
- Migración v1→v2: PROTOCOLO.md, OWNERSHIP.md (rutas reales), ROADMAP v2 por
  roles, claims/ y estado/. `.agent-tmp/` añadido a .gitignore.
- Retirada de la coordinación v1: docs/agentes/{01-director,02-implementaciones,
  03-pulimiento,04-seguridad}, TASKS.md y WORKLOG.md (todo queda en el
  historial de git). AGENTS.md queda como puntero a PROTOCOLO.md.
- Contrato M-1→C-2 preservado en el ROADMAP (fuente de verdad:
  docs/api/openapi.yaml, PR #45).
- Tareas vivas de v1 migradas al ROADMAP: C-2, F1, POL-1b, O-2, M-2, F5,
  POL-5, SEC-3. Verificación: PRs #40/#42/#45 ya fusionados (TASKS.md v1
  estaba desactualizado).

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- Migrar el ciclo de vida a SQLite (ya prevista en hornada 2) para hacer
  exacto el filtro de asignación en modo tienda.
- Literales de scripts/dev-tests/check_openapi.py aún mencionan
  internal/api/api.go (BAJA; va con POL-1b de PUL).

## Estado: VERDE — riesgos y decisiones
- CI de main en verde; suite local verificada en la ronda 19h59 de SEG.
- Riesgo: ventana del filtro de asignación en modo tienda (declarada en el
  contrato M-1→C-2, no es defecto).
- Decisiones: 5 roles (DIR, IMP-1, IMP-2, PUL, SEG); sensor/ bajo IMP-1;
  docs/api/ bajo IMP-1 (la spec viaja con el código); TODO.md sigue siendo
  el QUÉ y solo se edita para borrar lo completado.

# PUL — estado

## Hecho (últimas 24 h)
- **higiene-postmigracion** (verificación completa, sin cambios necesarios):
  - `docs/agentes/` contiene exactamente los cinco artefactos v2
    (PROTOCOLO, OWNERSHIP, ROADMAP, claims/, estado/); cero restos v1.
  - Raíz limpia: TASKS.md y WORKLOG.md retirados (historial de git),
    AGENTS.md queda como puntero a PROTOCOLO.md.
  - `.agent-tmp/` presente en .gitignore (línea 78); sin ficheros con
    patrones de borrador/backup/ronda en el árbol.
  - Dependencias Go: `go mod tidy` sin cambios (go.mod/go.sum sincronizados
    con el código). Manifiestos bun de `web/` y `website/` sin deriva
    detectable; los checks de consola del target `ci` los cubren.
- **Petición de PUL a IMP-1 servida** (a través de IMP-1 en esta misma
  sesión): `check_api_reference.py` en el target `ci` del Makefile
  (self-test + deriva), commit 0e20698; OPERATIONS.md regenerado para
  incluir POST /api/auth/domain (AD-7).

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- `pol1b-dividir-run-go` quedó desbloqueada por el release de M-2; es la
  siguiente tarea PUL con más valor (refactor sin cambio de comportamiento,
  suite verde antes y después).
- La próxima pasada de dependencias puede añadir `bun install --frozen-lockfile`
  como check explícito si el equipo quiere blindar los manifiestos bun.

## Estado: VERDE

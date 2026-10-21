# AGENTS.md — Reglas obligatorias para agentes en bluetardigrade

> Cualquier agente (GLM u otro) que trabaje en este repositorio lee esto
> ANTES de tocar nada. Las reglas no se negocian. Complementa a
> [CONTRIBUTING.md](CONTRIBUTING.md); si algo choca, manda este fichero.

## El proyecto en 30 segundos

SOC self-hosted para endpoints Windows: sensor ETW en Rust (`sensor/`),
motor de detección en Go como binario único (`cmd/`, `internal/`, `pkg/`),
reglas YAML mapeadas a MITRE ATT&CK (`rules/`), consola web Next.js
(`web/`) y documentación en español (`docs/`). Contexto completo:
`README.md` y `docs/OPERATIONS.md`.

## Equipo de agentes y fronteras de ficheros

Cada rol SOLO toca sus directorios. Cruzar la frontera = colisión garantizada.

| Rol | Ámbito exclusivo |
|---|---|
| **AG-1 MOTOR** (Go) | `cmd/`, `internal/`, `pkg/`, `configs/`, `thresholds.yaml`, `Makefile` |
| **AG-2 SENSOR** (Rust) | `sensor/` |
| **AG-3 CONSOLA** (TypeScript/Next.js) | `web/`, `website/`, `tools/console-tests/` |
| **AG-4 OPS/QA** | `docs/`, `rules/`, `scripts/`, `scenarios/`, `sequences/`, CI en `.github/` |
| **HUMANO** | Settings de GitHub, ramas, fusionar PRs, instalar y probar en Windows real |

Ficheros compartidos (edita solo tu parte, con cuidado): `TODO.md`,
`TASKS.md`, `WORKLOG.md`, `changelog.d/` y los `*.example.yaml`.

## Las 10 reglas de oro

1. **Un agente = una tarea = una rama = un PR pequeño.** Si el cambio
   crece, córtalo: mejor dos PRs que uno gordo.
2. Antes de empezar: `git pull origin main` y lee `TASKS.md` y las últimas
   entradas de `WORKLOG.md`.
3. **Reclama la tarea** en `TASKS.md` (estado «en progreso», tu rol y la
   fecha) en el primer commit de tu rama. Si ya está reclamada, NO la tomes.
4. No salgas de tu ámbito. Si la tarea parece exigir ficheros de otro rol:
   para, anota en `WORKLOG.md` qué necesitas del otro rol y continúa con lo
   que sí te toca.
5. Prohibido: push a `main`, fusionar tu propio PR, borrar ramas ajenas,
   `push --force`, debilitar tests o CI «para que pase».
6. Rama: `agent/<rol>/<id-tarea>` (p. ej. `agent/motor/m-1`). Commits
   pequeños y frecuentes; `git rebase origin main` antes de abrir el PR.
7. **Contratos primero**: si la tarea cruza motor↔sensor↔consola, el
   backend que abre PR primero define el contrato (API/JSON/formato de
   eventos) y lo anota en `WORKLOG.md`. El otro rol espera ese contrato y
   no lo inventa.
8. CI en verde (incluidos los jobs de Windows) antes de pedir el merge.
9. Al cerrar la sesión, SIEMPRE: entrada en `WORKLOG.md` (plantilla abajo)
   y estado de tu tarea en `TASKS.md` (`en revisión (PR #X)`).
10. Bloqueado ~30 min: marca la tarea como `bloqueada (motivo)` en
    `TASKS.md`, explica en `WORKLOG.md` y pásate a otra tarea libre de tu rol.

## Convenciones del repo (no las rompas)

- Documentación y comentarios: **español**. Estilo de commits: mira `git log`.
- `TODO.md` es la fuente del QUÉ y solo se edita para borrar lo ya
  fusionado (convención del repo). Lo asignable vive en `TASKS.md`.
- Al fusionar un PR (lo hace el humano): se borra el punto de `TODO.md`,
  se añade entrada en `changelog.d/` y se marca la fila como `hecha` en
  `TASKS.md`.
- Validación de detecciones SOLO con telemetría sintética e inerte.
- No se descargan feeds ni herramientas de terceros automáticamente.
- Ninguna acción sobre equipos es «ejecutar un comando»: conjunto cerrado
  de acciones, firmadas, auditadas y con lista de protegidos (ver
  «Decisiones vigentes» en `TODO.md`).

## Plantilla de entrada en WORKLOG.md

```markdown
---
## 2026-10-21 · AG-1 MOTOR · M-1 · sesión 1
- Hecho: <qué se completó de la tarea>
- Ficheros: `internal/api/api.go`, `cmd/engine/run.go`
- Contratos/decisiones para otros: <API nueva, formato JSON, ...>
- Pendiente: <qué queda> · Bloqueos: <motivo>
- Estado en TASKS.md: en revisión (PR #N)
```

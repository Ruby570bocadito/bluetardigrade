# Plan de ronda — Pulimiento A (2026-10-05 12h23 Madrid)

Cuarta ronda de Pulimiento A en la rama `carril/pulimiento-a`.
Continuidad de las rondas 1-3 (ver `roadmap_A.md`).

## Sincronización previa

- `git fetch origin --prune`: `origin/carril/implementacion-b` avanzó
  un commit (`31b39ae..4257127`: «console-service: native provider
  streaming for the AI analyst» — IMP-B cerró su ronda 2). Las
  otras cuatro ramas de carril siguen sin existir.
- `git pull --ff-only origin carril/pulimiento-a`: already up to date.
- `git merge origin/main`: already up to date.
- Leí el informe de IMP-B ronda 2 (`ronda_2026-10-05_12h15_B.md`):
  - Aterrizaron streaming nativo del proveedor en
    `web/console-service/analyst.ts` (nueva `chatCompletionStream`,
    fallback honesto a JSON, 3 guardas de tiempo, parser SSE
    tolerante). Tests en `analyst.test.ts`, `analyst-progress.test.ts`,
    `hub.test.ts`.
  - Tocaron `web/console/src/components/console/analyst-panel.tsx`
    (solo el comentario de cabecera: deja de afirmar «no hay
    streaming»).
  - **NO tocaron `docs/ARCHITECTURE.md`.** La fila «Console» del
    feature inventory sigue diciendo «(no provider token streaming)»,
    que es ahora stale. Es exactamente el escenario que marqué en mi
    `roadmap_A.md` tras la ronda 3: «IMP-B debe actualizarla, o yo en
    una ronda posterior si lo veo stale y nadie lo tocó». Lo veo
    stale, nadie lo tocó → lo corrijo yo esta ronda.
  - Cero solapamiento con mi área de código. Ninguna prioridad ALTA
    para mí en su informe.

## Identificadores del TODO trabajados

El repo sigue sin `TODO.md`. Continúo numerando mis hallazgos
`POL-A-<tema>`. Esta ronda:

- **POL-A-docs-10** — `docs/ARCHITECTURE.md` feature inventory, fila
  «Console»: el paréntesis «(no provider token streaming)» es ahora
  stale tras el aterrizaje del streaming nativo de IMP-B (commit
  `4257127`). Lo actualizo a «(native provider streaming: the answer
  renders as the model writes it; providers without streaming deliver
  it in one piece)», reflejando lo que IMP-B documentó en su
  changelog y en el comentario de `analyst-panel.tsx`.
- **POL-A-docs-11** — `docs/ARCHITECTURE.md` feature inventory:
  auditoría de las filas restantes (Storage, Auth, Ops) contra el
  código. Verifico que las afirmaciones siguen siendo ciertas; si
  hay deriva, la corrijo. Solo texto.

## Ficheros que voy a tocar

- `docs/ARCHITECTURE.md` (fila «Console» del feature inventory)
- `changelog.d/PUL-A-analyst-streaming-inventory.md` (fragmento)
- `docs/agentes/03-pulimiento/ronda_2026-10-05_12h23_A.md` (informe)
- `docs/agentes/03-pulimiento/roadmap_A.md` (continuidad)

## Por qué

`docs/ARCHITECTURE.md` es mi área. La fila «Console» describe lo que
la consola hace hoy, y hoy hace streaming nativo (IMP-B lo aterrizó).
Dejar el paréntesis «(no provider token streaming)» es dejar una
afirmación falsa en mi doc. IMP-B no la actualizó (tocaron su código
y su doc de analista, pero no el feature inventory de arquitectura —
es razonable, el feature inventory es mi área). La regla del carril
es clara: si veo deriva en mi área, la pulo.

## Verificación prevista

Mis cambios son solo texto en `docs/ARCHITECTURE.md`. Verifico:

- `python3 scripts/dev-tests/check_rule_inventory.py` (no toca reglas
  ni la tabla auto-generada, pero lo corro para confirmar que no
  rompí marcadores).
- `python3 scripts/dev-tests/check_openapi.py` (no toco la API).
- `git diff` visual: la fila actualizada debe mantener el formato de
  la tabla.

Sigo sin tener `go`/`cargo`/`pwsh`/`staticcheck` en el entorno; los
cambios de esta ronda no tocan ese código.

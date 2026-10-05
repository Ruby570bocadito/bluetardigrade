# Plan de ronda — Pulimiento A (2026-10-05 11h38 Madrid)

Primera ronda de Pulimiento A en la rama `carril/pulimiento-a`. El repo
todavía no tiene `TODO.md` ni `docs/PLAN-DETALLADO.md` ni la carpeta
`docs/agentes/`: esta ronda crea la estructura de trabajo del carril y
ataca deriva de documentación técnica que he encontrado al leer el árbol.

## Identificadores del TODO trabajados

El repo no tiene `TODO.md` con identificadores POL-1..POL-6 (la
infraestructura de carriles es nueva). Aplico el rol de Pulimiento A
(backend Go/Rust/PowerShell, CI, documentación técnica) y numero mis
propios hallazgos `POL-A-<tema>` para que el responsable los pueda
consolidar en el TODO cuando lo cree:

- **POL-A-docs-1** — `docs/ARCHITECTURE.md`: el bloque «Repository
  layout» lista 21 de los 29 paquetes de `internal/`. Faltan
  `baseline`, `fleet`, `forensic`, `incident`, `intel`, `reputation`,
  `tlsutil`, `yamlcheck` — todos con código y tests vivos. Es deriva
  real: un lector del layout no se entera de que existe el grabador de
  evidencias forenses ni el rotador de TLS.
- **POL-A-docs-2** — revisión de `.gitignore`: cubre bien el producto,
  pero no el flujo de un operador que edite sobre el árbol (sin
  entradas para `*.log`, `*.cover`, `coverage.*`, `*.prof`). Reviso y
  añado solo lo que no pueda enmascarar un fichero real del repo.
- **POL-A-docs-3** — `docs/OPERATIONS.md`: pasada de coherencia contra
  el código real (rutas, flags, contadores). Solo corrigo deriva
  factual; no reescribo estilo.
- **POL-A-code-1** — lectura de fondo del backend Go en busca de
  código muerto, comentarios obsoletos y duplicados seguros de
  pulir. Solo toco lo que sea claramente seguro sin poder ejecutar
  `go test` (el entorno no tiene Go: lo digo en el informe).
- **POL-A-ci-1** — lectura de `.github/workflows/ci.yml` y
  `bench-nightly.yml`: observaciones y correcciones menores de
  comentarios / consistencia. No cambio matrices ni pines de acciones.

## Ficheros que voy a tocar

- `docs/ARCHITECTURE.md` (layout block)
- `.gitignore` (entradas menores, si procede)
- `docs/OPERATIONS.md` (solo si encuentro deriva factual)
- `changelog.d/PUL-A-*.md` (fragmentos de changelog)
- `docs/agentes/03-pulimiento/roadmap_A.md` (continuidad)
- `docs/agentes/03-pulimiento/ronda_2026-10-05_11h38_A.md` (informe)

## Por qué

El rol de Pulimiento A incluye `docs/ARCHITECTURE.md` y
`docs/OPERATIONS.md`. La deriva del layout es el hallazgo de mayor
valor y menor riesgo: es texto, no cambia comportamiento, y el lector
del documento hoy se pierde 8 paquetes reales. El resto son pasadas de
coherencia que dejan el árbol más limpio sin cruzar el límite de
«cambiar comportamiento».

## Verificación prevista

El entorno no tiene `go`, `cargo`, `pwsh` ni `staticcheck`. Anoto en el
informe qué pasos del CI no puedo ejecutar y por qué. Para lo que sí
puedo (Python 3 stdlib), ejecuto `check_openapi.py` y
`check_rule_inventory.py` si tocan el área afectada; aquí no tocan la
API ni las reglas, así que no proceden.

# Roadmap — Pulimiento A (continuidad)

Archivo vivo del carril Pulimiento A. Cada ronda lo actualiza: qué
tiene a medias, qué sigue y por qué. La rama es `carril/pulimiento-a`,
creada desde `origin/main`.

## Área del carril

Calidad del backend: Go, Rust y PowerShell; rendimiento del motor; CI
(`.github/workflows`, coordinado con Seguridad B para los escaneos);
documentación técnica (`docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`).
No creo funcionalidades nuevas ni arreglo bugs de seguridad (los
anoto para Seguridad). Ningún refactor cambia el comportamiento: los
tests existentes deben seguir pasando sin tocarlos, salvo para
moverlos.

## Estado de la rama

- **Rama:** `carril/pulimiento-a`, creada desde `origin/main` el
  2026-10-05.
- **Remoto:** `origin/carril/pulimiento-a` existe desde el cierre de
  la ronda 1 (push con token efímero en la URL, no guardado en
  config ni en ficheros).
- **Commits publicados:**
  1. `plan: ronda 2026-10-05 (PUL-A)` — plan ronda 1.
  2. `pulimiento: docs layout, campaigns doc, gitignore coverage (PUL-A)` — trabajo ronda 1.
  3. `plan: ronda 2026-10-05 12h08 (PUL-A)` — plan ronda 2.
  4. `pulimiento: complete engine flags tables and document API TLS (PUL-A)` — trabajo ronda 2.
  5. `plan: ronda 2026-10-05 12h13 (PUL-A)` — plan ronda 3.
  6. `pulimiento: complete CLI subcommand table and fix Telemetry inventory row (PUL-A)` — trabajo ronda 3.
  7. `plan: ronda 2026-10-05 12h23 (PUL-A)` — plan ronda 4.
  8. `pulimiento: fix stale AI analyst inventory row after IMP-B streaming landed (PUL-A)` — trabajo ronda 4.
  9. `plan: ronda 2026-10-05 12h27 (PUL-A)` — plan ronda 5.
  10. (pendiente de commit) trabajo ronda 5.

## Rondas anteriores

- **2026-10-05 11h42 (ronda 1):** setup del carril + pulimiento de
  documentación técnica. Informe en
  `ronda_2026-10-05_11h42_A.md`. Resumen:
  - `docs/ARCHITECTURE.md` layout: 8 paquetes `internal/` faltantes
    añadidos (`baseline`, `fleet`, `forensic`, `incident`, `intel`,
    `reputation`, `tlsutil`, `yamlcheck`).
  - `docs/OPERATIONS.md` campaigns: `sequences/campaigns.yaml` (7
    secuencias) no estaba documentado; añadida tabla + párrafo +
    frase introductoria actualizada.
  - `.gitignore`: entradas preventivas para `coverage.txt`,
    `coverage.html`, `*.cover`, `*.prof`, `*.pprof`.
  - 2 fragmentos en `changelog.d/`: `PUL-A-docs-accuracy.md`,
    `PUL-A-gitignore-coverage.md`.

- **2026-10-05 12h08 (ronda 2):** pulimiento de tablas de flags en
  `docs/OPERATIONS.md`. Informe en
  `ronda_2026-10-05_12h08_A.md`. Resumen:
  - Tabla «Configuration reference»: 6 flags faltantes añadidos
    (`-intel`, `-baseline-learn`, `-thresholds`, `-notify`,
    `-api-cert`/`-api-key`, `-incidents`). La afirmación «full
    surface — no other knobs» era falsa; ahora cierta.
  - Tabla «`engine run` flags»: 7 flags faltantes añadidos
    (`-notify`, `-api-cert`/`-api-key`, `-ingest-cert`/`-ingest-key`,
    `-lifecycle`, `-incidents`). Ambas tablas ahora listan las 40
    entradas de `cmd/engine/flags.go`.
  - Sección «Local HTTP API»: añadido párrafo documentando
    `-api-cert`/`-api-key` (TLS del API listener) junto al de
    `-api-token`. Antes la sección documentaba auth pero no cifrado.
  - 1 fragmento en `changelog.d/`: `PUL-A-cli-flags-complete.md`.
  - `-api-cert`/`-api-key` eran lo más grave: no estaban en NINGÚN
    sitio de la doc, aunque `internal/api/api.go` `NewTLS` +
    `tlsutil.Reloader` los soportan.

- **2026-10-05 12h13 (ronda 3):** pulimiento de tabla de
  subcomandos CLI + fila «Telemetry» del feature inventory.
  Informe en `ronda_2026-10-05_12h13_A.md`. Resumen:
  - `docs/OPERATIONS.md` tabla «Engine CLI reference»: listaba 5
    de 9 subcomandos. Añadidos `engine doctor`, `engine report`,
    `engine ingest-identity`, `engine operator-credential` con
    flags reales y enlaces a las secciones que ya los documentaban
    en prosa.
  - `docs/ARCHITECTURE.md` fila «Telemetry»: decía «Rust ETW
    sensor (Kernel-Process)» pero el sensor colecta de 4 providers
    desde el commit `0a4a8aa`. Actualizada a Kernel-Process +
    Kernel-Network + Kernel-Registry + DNS-Client, más image
    hashes en el enriquecimiento.
  - 1 fragmento en `changelog.d/`: `PUL-A-cli-subcommands.md`.
  - La deriva de «Telemetry» era la más grave de esa ronda: un
    lector de ARCHITECTURE.md creía que el sensor solo colectaba
    procesos, cuando en realidad colecta red, registro y DNS.

- **2026-10-05 12h23 (ronda 4):** pulimiento de la fila «Console»
  del feature inventory + cierre de la auditoría fila por fila.
  Informe en `ronda_2026-10-05_12h23_A.md`. Resumen:
  - `docs/ARCHITECTURE.md` fila «Console»: el paréntesis «(no
    provider token streaming)» era stale tras el commit `4257127`
    de IMP-B (streaming nativo del analista). IMP-B no tocó
    ARCHITECTURE.md (es mi área); lo corregí yo. Actualizado a
    «(native provider streaming: the answer renders as the model
    writes it; providers without streaming deliver it in one
    piece)».
  - Auditoría de las 3 filas restantes (Storage, Auth, Ops)
    contra el código: las tres verifican correctamente, sin
    deriva. La auditoría fila por fila del feature inventory
    (13 filas) queda cerrada.
  - 1 fragmento en `changelog.d/`:
    `PUL-A-analyst-streaming-inventory.md`.
  - La observación para IMP-B sobre la fila «AI analyst» se cierra
    (la actualicé yo).

- **2026-10-05 12h27 (ronda 5):** pulimiento del diagrama «System
  overview» + párrafo bajo el diagrama. Informe en
  `ronda_2026-10-05_12h27_A.md`. Resumen:
  - `docs/ARCHITECTURE.md` diagrama mermaid: 3 clases de deriva
    corregidas. (1) Endpoint subgraph decía solo «Kernel-Process»;
    ahora lista los 4 providers (Kernel-Process, Kernel-Network,
    Kernel-Registry, DNS-Client). (2) Pipeline omitía 9 componentes
    reales (intel/baseline/fleet en enriquecimiento;
    forensic/lifecycle/suppress en alerta; notify/siem como sinks
    junto al webhook; respond como sink de acción); ahora los
    muestra. (3) Webhook node estaba mal etiquetado como «SIEM/SOAR
    collector»; split en 3 nodos (webhook, notify, siem).
  - `docs/ARCHITECTURE.md` párrafo bajo el diagrama: ampliado para
    nombrar productores (Rust ETW sensor, Go SOC collector,
    external producers) y consumidores (API, consola, sinks
    SIEM/notificación) reales del schema unificado.
  - 1 fragmento en `changelog.d/`:
    `PUL-A-system-overview-diagram.md`.
  - Verificación: script Python de coherencia de nodos del mermaid
    (0 huérfanos); no hay validador mermaid formal en el entorno,
    verificación manual declarada.

## Pendientes para la siguiente ronda

### Verificación (parcialmente resuelto)

- **Push a origin:** resuelto desde el cierre de la ronda 1 (token
  efímero en la URL del push, no guardado en config ni en ficheros).
- **Suite Go/Cargo/pwsh:** el entorno sigue sin `go`, `cargo`, `pwsh`
  ni `staticcheck`. Los cambios de las rondas 1 y 2 son solo
  documentación, así que la falta no impide verificar lo que toqué
  (los guards de Python que sí puedo correr — `check_rule_inventory.py`
  y `check_openapi.py` — pasan limpios). Antes de tocar código
  Go/Rust/PowerShell hay que confirmar con el responsable si el
  entorno debe tener estas herramientas, o si la verificación la hace
  el CI al fusionar.

### POL-A-code-1 — refactor del backend Go (cuando haya Go)

Candidatos identificados para leer a fondo y partir si procede:

- `internal/api/api.go` (1367 líneas): el `Hub` struct tiene ~30
  campos, los handlers están todos en un fichero. Posible split por
  dominio (stats, events, alerts, suppressions, respond, forensics,
  sse). Solo si ningún otro carril tiene estos ficheros en su plan.
- `cmd/engine/run.go` (1091 líneas): `runEngine` hace el wiring
  completo. Posible extracción de bloques (rules/sequences/beacons/
  thresholds loading, store wiring, sink wiring) a helpers o a un
  paquete `internal/engine`. Evaluar si merece la pena vs. el coste
  de mover imports.
- `internal/correlate/correlate.go` (789 líneas): posible split del
  manager (load/reload/track/fire/prune).

Sin ejecutar `go test -race ./...` no me parece prudente tocarlos. La
regla del carril es «los tests existentes deben seguir pasando sin
tocarlos, salvo para moverlos» — sin poder ejecutarlos, no lo garantizo.

### POL-A-ci-1 — revisión de CI (cuando haya motivo)

Los tres workflows (`ci.yml`, `bench-nightly.yml`, `release.yml`) se
leen consistentes. Re-visitar cuando:

- un job nuevo se añada (coordinar nombre/runner/timeout con el
  estándar),
- una action suba de versión mayor (verificar el SHA contra el tag
  oficial con `git ls-remote`),
- la matriz de OS cambie,
- Seguridad B añada escaneos (coordinar dónde viven).

### Observación para IMP-B (cuando cierre su ronda 2) — CERRADA

La fila «AI analyst» del feature inventory de `docs/ARCHITECTURE.md`
decía hoy «(no provider token streaming)». El plan de la ronda 2 de
IMP-B es precisamente añadir streaming nativo del proveedor. Cuando
IMP-B aterrice ese cambio, la fila quedará stale. IMP-B debe
actualizarla (es su área), o yo en una ronda posterior si lo veo
stale y nadie lo tocó. Lo dejo anotado aquí.

**Cierre (ronda 4, 12h23):** IMP-B aterrizó el streaming nativo
(commit `4257127`, ronda 2 de IMP-B a las 12h15) y NO tocó
`docs/ARCHITECTURE.md` (verificado con `git diff`). La fila quedó
stale y la corregí yo en la ronda 4. Observación cerrada.

### Observación para el responsable (no de mi área)

`docs/ROADMAP.md` línea 16 dice «114 reglas, 11 cadenas» pero el repo
envía 13 secuencias (4 `kill-chains.yaml` + 7 `campaigns.yaml` + 2
`lateral.yaml`). ROADMAP.md es un doc de producto, no técnico de
backend; lo dejo anotado para quien mantenga ese documento.

## Convenciones que mantengo

- **Idioma:** código y comentarios en inglés; mensajes al usuario y
  documentación operativa en español (como el resto del repo).
- **Commits:** sin firmas de IA. Mensaje corto en inglés, verbo en
  imperativo.
- **changelog.d:** un fragmento por tema, en inglés, estilo Keep-a-
  Changelog. El responsable consolida en `CHANGELOG.md`.
- **Verificación:** los mismos pasos que el CI, para lo que haya
  tocado. Si el entorno no tiene una herramienta, lo digo en el
  informe y nunca afirmo que algo pasa sin haberlo ejecutado.
- **Ficheros compartidos:** `TODO.md`, `docs/PLAN-DETALLADO.md` y
  `CHANGELOG.md` no los toco. Para el changelog uso `changelog.d/`.
  `docs/api/openapi.yaml` lo actualiza quien cambia la API. El
  `README.md` y el árbol de carpetas los mantiene Pulimiento B.

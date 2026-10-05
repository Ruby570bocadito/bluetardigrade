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
- **Commits locales (sin push, el entorno no tiene credenciales):**
  1. `plan: ronda 2026-10-05 (PUL-A)` — solo el plan.
  2. (pendiente de commit) trabajo de la ronda 1.
- **Remoto:** `origin/carril/pulimiento-a` aún no existe (el push
  falla por falta de credenciales). Cuando el responsable o el
  entorno lo permitan, `git push -u origin carril/pulimiento-a`.

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

## Pendientes para la siguiente ronda

### Verificación (bloqueante para cualquier cambio de código)

El entorno actual no tiene `go`, `cargo`, `pwsh` ni `staticcheck`.
Antes de tocar código Go/Rust/PowerShell hay que:

1. Confirmar con el responsable si el entorno debe tener estas
   herramientas, o si la verificación la hace el CI al fusionar.
2. Si se instalan, ejecutar `make ci` (o los comandos del CI uno a
   uno) sobre `carril/pulimiento-a` para certificar que los cambios
   de documentación de la ronda 1 no rompieron nada (no deberían,
   pero la regla es no afirmar sin ejecutar).
3. Subir la rama (`git push -u origin carril/pulimiento-a`) cuando
   haya credenciales.

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

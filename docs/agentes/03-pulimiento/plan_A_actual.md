# Plan de ronda — Pulimiento A (2026-10-05 16h00 UTC, ajustado 16h20)

Ronda de fondo única de esta instancia. **Ajustada tras leer los seis
planes publicados** (todos los carriles ya tienen rama esta ronda).

## Identificadores del TODO trabajados

- **SEC-7 nocturno (prioridad ronda 2):** el job `fuzz` de
  `bench-nightly.yml` ejecuta solo `FuzzFieldMapParity` de los 20
  objetivos en `main`. Lo paso a una **matriz generada por
  descubrimiento** (`git grep '^func Fuzz'` → JSON → `matrix.include`):
  un job por objetivo, `-fuzztime 5m`, `max-parallel`, guard contra
  matriz vacía y crasher como artefacto. El descubrimiento automático
  cubrirá también los objetivos futuros de SEG-A sin editar el
  workflow. Añado un objetivo para la **primera línea de la ingesta
  (AUTH/ENROLL)** en `internal/ingest`: extracción de
  `parseEnrollLine` desde `handleEnroll` (sin cambio de conducta) +
  `FuzzAuthEnrollFirstLine`.
- **POL-12:** comentarios que nombran rondas, carriles o agentes en
  workflows, Go y scripts pasan a explicar el porqué técnico. Solo
  comentarios, cero cambio de conducta.
- **POL-A-ci-2 (desbloqueado):** PUL-B está fusionado y
  `check_console_theme.py` pasa verde en `main` (ejecutado); lo
  engancho al job `console` de `ci.yml` tras el build.

## Ajuste de coordinación (16h20, tras leer los seis planes)

- **POL-1 (`api.go`) SE DIFIERE:** la condición del responsable era
  «solo si IMP-A no tiene `internal/api` en su plan». IMP-A sí lo
  tiene (extiende `internal/api/reports.go` y `noise.go` para REP-1).
  Aunque `api.go` en sí no está en su lista, el paquete está caliente:
  se aplaza a una ronda con IMP-A frío. Queda en el roadmap.
- **POL-12 esquiva `internal/enroll/`** (`enroll.go` y `enroll_test.go`
  llevan el fix SEC-A-1 de IMP-A esta ronda): esas dos reescrituras se
  dejan para cuando su rama se fusione. Anotado en el informe.
- Sin más colisiones: IMP-B y PUL-B tocan solo consola; SEG-A toca
  fuzzers de collector/reputation/api-filters (paquetes que no toco;
  su plan es previo a la fusión de la ronda 1, donde ya aterrizaron);
  SEG-B revisa `internal/api` y `internal/report` (mis edits allí son
  solo de comentarios; merge-tree lo verificará antes del push).

## Ficheros que voy a tocar y por qué

- `.github/workflows/bench-nightly.yml`, `ci.yml` (CI, mi área;
  SEG-B opera en `deps-audit.yml`, fichero distinto).
- `internal/ingest/enroll.go` + `fuzz_test.go` (nadie más en el
  handshake).
- Comentarios POL-12 en `internal/{actions,api,ingest,respond,report,rules,sigma}`,
  `scripts/` y los dos workflows (excepto lo indicado arriba).
- `changelog.d/` (fragmentos), `docs/agentes/03-pulimiento/` (informe
  y roadmap). `TODO.md`, `PLAN-DETALLADO.md`, `CHANGELOG.md` y
  `openapi.yaml` no se tocan.

## Verificación prevista

Suite Go completa tras el último cambio: `gofmt -l .`,
`go build/vet ./...`, `GOOS=windows go build ./...`, staticcheck doble
pasada (2026.2.1), `go test -race -count=1 ./...` y `-count=3` en
paquetes tocados, `check_openapi.py` (+ self-test),
`check_rule_inventory.py`, `check_workflows.py`, parseo YAML y
`merge-tree` contra las cinco ramas. Sin `cargo` ni `pwsh` (sensor y
PowerShell intactos).

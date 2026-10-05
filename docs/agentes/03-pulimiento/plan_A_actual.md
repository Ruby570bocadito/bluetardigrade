# Plan de ronda — Pulimiento A (2026-10-05 16h00 UTC)

Ronda de fondo única de esta instancia: las tres tareas del carril en
cola, en el orden que manda el responsable. Continuidad en
`roadmap_A.md`.

## Identificadores del TODO trabajados

- **SEC-7 nocturno (prioridad ronda 2):** el job `fuzz` de
  `bench-nightly.yml` ejecuta solo `FuzzFieldMapParity` de los 20
  objetivos que hay en `main`. Lo paso a una **matriz de jobs
  generada por descubrimiento** (`git grep '^func Fuzz'` → JSON →
  `matrix.include`), un job por objetivo con `-fuzztime 5m` y
  `max-parallel`, guard contra matriz vacía y crasher como artefacto.
  Añado además un objetivo para la **primera línea de la ingesta
  (AUTH/ENROLL)** en `internal/ingest`: extracción de
  `parseEnrollLine` desde `handleEnroll` (refactor sin cambio de
  conducta) + `FuzzAuthEnrollFirstLine`.
- **POL-12:** los comentarios que nombran rondas, carriles o agentes
  en workflows, Go y scripts pasan a explicar el porqué técnico
  (inventario de ~110 coincidencias brutas, falsos positivos
  excluidos: `working-directory`, `round-trip`, fixtures como datos).
  Solo comentarios: cero cambio de conducta.
- **POL-1 (`api.go`):** dividir `internal/api/api.go` por dominio en
  el mismo paquete. Condición del responsable: que IMP-A no lo tenga
  en su plan. IMP-A aún no ha publicado rama esta ronda; re-verificaré
  planes y `merge-tree` antes de tocar y antes del push.
- **POL-A-ci-2 (desbloqueado esta ronda):** PUL-B ya está fusionado en
  `main` y `check_console_theme.py` pasa verde (verificado); lo
  engancho al job `console` de `ci.yml` tras el build.

## Ficheros y por qué

- `.github/workflows/bench-nightly.yml` (matriz fuzz), `ci.yml`
  (checker de tema) — CI, mi área; SEG-B tiene `deps-audit.yml` en su
  rama pero en fichero distinto.
- `internal/ingest/enroll.go` (extracción), `fuzz_test.go` (objetivo
  nuevo) — nadie más toca el handshake en los planes publicados.
- Comentarios en `internal/{actions,api,ingest,respond,enroll,rules,report,sigma}`,
  `scripts/` y workflows — POL-12.
- `internal/api/api.go` → ficheros por dominio (mismo paquete) si la
  condición IMP-A lo permite.
- `changelog.d/` (fragmentos), `docs/agentes/03-pulimiento/` (informe
  y roadmap). `TODO.md`, `PLAN-DETALLADO.md`, `CHANGELOG.md` y
  `openapi.yaml` no se tocan.

## Verificación prevista

Suite Go completa al final del último cambio: `gofmt -l .`,
`go build/vet ./...`, `GOOS=windows go build ./...`, staticcheck
doble pasada (2026.2.1), `go test -race -count=1 ./...` y
`-count=3` en paquetes tocados, `check_openapi.py` (+ self-test),
`check_rule_inventory.py`, `check_workflows.py` y parseo YAML de
workflows. Sin `cargo` ni `pwsh` (sensor y PowerShell intactos).

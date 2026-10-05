# Plan de ronda — Pulimiento A (2026-10-05 13h42 Madrid, ajustado)

La ronda 6 se publicó a las 12h36 con un único punto (POL-A-docs-14) y no
llegó a ejecutarse. Esta instancia retoma esa ronda, la ajusta tras leer
los planes de los otros cinco carriles (ahora los seis existen) y la
ejecuta completa.

## Sincronización previa

- `git fetch origin --prune`: las seis ramas de carril existen. Novedades
  desde mi último plan: `carril/implementacion-a` (ronda cerrada, SIM-1/SIM-2;
  su rama va adelantada hasta `feat/enrollment`, donde vive el `TODO.md`
  real), `carril/seguridad-a` (plan ronda 2: fuzzers), `carril/seguridad-b`
  (ronda cerrada), `carril/pulimiento-b` (ronda cerrada, THEME-1/2/3).
- `git pull --ff-only` + `git merge origin/main`: already up to date
  (main sigue en `5e168ba`).
- **Discord:** no se envió notificación (`DISCORD_WEBHOOK_URL` no definida;
  ya declarado en rondas anteriores).

## Coordinación leída (sin colisiones)

- IMP-A: ronda cerrada; su siguiente tarea (SIM-4) tocará
  `internal/api/api.go` + `docs/api/openapi.yaml` (paths). Yo solo toco el
  bloque de metadatos de `openapi.yaml` (info/comentario/ejemplo) — hunks
  distintos; lo anoto en el informe.
- IMP-B: solo `web/console` (VIZ-1/VIZ-3); excluye explícitamente mis
  ficheros. Sin solape.
- PUL-B: ronda cerrada; su punto 3 propone a MI carril enganchar su
  `check_console_theme.py` en `ci.yml`. Lo atiendo esta ronda llevándome el
  script byte a byte de su rama (SHA-256 `41e7f5da…`) para que las dos
  ramas lo añadan idéntico y la fusión sea trivial.
- SEG-A: fuzzers en `internal/collector`, `internal/reputation`,
  `internal/api/filters.go` (tests). No toco esos paquetes. Sin solape.
- SEG-B: su diff de `ci.yml` contra `main` está vacío; sin colisión en CI.

## Identificadores del TODO trabajados

(El `TODO.md` real vive en `feat/enrollment`; leo mis tareas POL de ahí.)

- **POL-A-docs-14** (publicado a las 12h36): completar las familias
  `sf_*` de la sección «Prometheus metrics» de `docs/OPERATIONS.md`
  contra `internal/api/metrics.go`.
- **POL-4** (alcance nombrado por el TODO): restos del nombre antiguo —
  banner `SECURITY-FRAMEWORK ENGINE` (`cmd/engine/render.go`), título TUI
  (`cmd/engine/interactive.go`), metadatos y ejemplo de
  `docs/api/openapi.yaml`, y rutas del `Dockerfile`. El resto de hits se
  clasifican en el informe (contratos SIEM/email congelados por tests,
  crate Rust real, legacy handling, territorio de otros carriles).
- **POL-A-ci-2**: enganche de `check_console_theme.py` en el job
  `console` de `ci.yml` (petición de PUL-B; CI es mi área).
- **Verificación con toolchain real**: Go 1.26.0 instalado esta ronda en
  el entorno (`/home/z/my-project/tools/go`); primera pasada completa de
  la suite Go del carril (gofmt, build, vet, GOOS=windows, staticcheck si
  se puede instalar, test -race, guards de OpenAPI e inventario).
- **Fijos de ronda**: revisión rápida de `.gitignore` y ficheros
  temporales (ya limpia en ronda 1; re-verificar).

## Ficheros que voy a tocar y por qué

- `docs/OPERATIONS.md` — sección Prometheus (mi área, doc técnica).
- `cmd/engine/render.go`, `cmd/engine/interactive.go` — POL-4 banner y
  título TUI (cadenas de presentación, sin cambio de comportamiento).
- `docs/api/openapi.yaml` — POL-4 metadatos/ejemplo (no toca paths ni
  contratos; el CI lo valida con `check_openapi.py`).
- `Dockerfile` — POL-4 rutas internas coherentes (auto-contenidas).
- `.github/workflows/ci.yml` — paso nuevo en el job `console` (mi área).
- `scripts/dev-tests/check_console_theme.py` — copia byte a byte de
  `origin/carril/pulimiento-b` (autoría PUL-B; yo solo lo hago llegar a
  CI).
- `changelog.d/`, `docs/agentes/03-pulimiento/` — fragmentos, informe y
  roadmap.

## Verificación prevista

Suite Go completa con el toolchain nuevo + `check_openapi.py` (+ self-test)
+ `check_rule_inventory.py` + el checker de tema nuevo. Sin `cargo` ni
`pwsh`: no toco sensor ni PowerShell esta ronda (nada que verificar en
ellos).

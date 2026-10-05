# Plan de ronda — Pulimiento A (2026-10-05 12h08 Madrid)

Segunda ronda de Pulimiento A en la rama `carril/pulimiento-a`.
Continuidad de la ronda 1 (ver `roadmap_A.md` y
`ronda_2026-10-05_11h42_A.md`).

## Sincronización previa

- `git fetch origin --prune`: detectada `origin/carril/implementacion-b`
  (Implementación B ya hizo su ronda 1 a las 11h55). Las otras cuatro
  ramas de carril no existen todavía.
- `git pull --ff-only origin carril/pulimiento-a`: already up to date.
- `git merge origin/main`: already up to date (mi rama está sobre el
  mismo `5e168ba` que `main`).
- Leído el plan y el informe de Implementación B: trabajaron en la
  consola (`web/console`, `web/console-service`) y en
  `docs/INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md`. **Cero
  solapamiento** con mi área (backend Go/Rust/PowerShell, CI,
  `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`). Ninguna prioridad
  ALTA para mí en su informe.

## Identificadores del TODO trabajados

El repo sigue sin `TODO.md`. Continúo numerando mis hallazgos
`POL-A-<tema>`. Esta ronda:

- **POL-A-docs-4** — `docs/OPERATIONS.md` configuration reference
  (línea 147): la tabla dice «This is the full surface — there are no
  other knobs» pero faltan 6 flags reales de `cmd/engine/flags.go`:
  `-intel`, `-baseline-learn`, `-thresholds`, `-notify`, `-api-cert` /
  `-api-key` (estos dos NO están documentados en NINGÚN sitio), y
  `-incidents`. Es deriva factual: un operador que lea la tabla
  cree que no hay más knobs, y `-api-cert`/`-api-key` (TLS del API
  listener, implementado en `internal/api/api.go` `NewTLS`) son
  críticos para desplegar el API más allá de loopback con cifrado.
- **POL-A-docs-5** — `docs/OPERATIONS.md` CLI reference table (línea
  1070): faltan 5 flags que sí están en la tabla de configuración
  pero no en la de CLI (`-notify`, `-ingest-cert`/`-ingest-key`,
  `-lifecycle`, `-incidents`) más `-api-cert`/`-api-key` que no
  están en ninguna. Alineo las dos tablas para que digan lo mismo.
- **POL-A-docs-6** — `docs/OPERATIONS.md` sección «Local HTTP API»:
  añadir una mención de `-api-cert`/`-api-key` (TLS del API listener)
  junto a la mención existente de `-api-token`. Hoy la sección
  documenta el bearer pero no el cifrado.

## Ficheros que voy a tocar

- `docs/OPERATIONS.md` (dos tablas de flags + una sección)
- `changelog.d/PUL-A-cli-flags-complete.md` (fragmento)
- `docs/agentes/03-pulimiento/ronda_2026-10-05_12h08_A.md` (informe)
- `docs/agentes/03-pulimiento/roadmap_A.md` (continuidad)

## Por qué

`docs/OPERATIONS.md` es mi área. La deriva de la tabla de
configuración es el hallazgo de mayor valor y menor riesgo: es
texto, no cambia comportamiento, y la afirmación «full surface — no
other knobs» es hoy falsa. Los flags `-api-cert`/`-api-key` son lo
más grave: un operador que quiera cifrar el API no encuentra cómo en
la documentación, aunque el código lo soporta desde hace tiempo
(`internal/api/api.go` `NewTLS` + `tlsutil.Reloader`).

## Verificación prevista

Mis cambios son solo texto en `docs/OPERATIONS.md`. Verifico:

- `python3 scripts/dev-tests/check_rule_inventory.py` (la tabla que
  toco NO es la auto-generada por este script, pero lo corro para
  confirmar que no rompí los marcadores `<!-- BEGIN/END RULE
  INVENTORY -->`).
- `python3 scripts/dev-tests/check_openapi.py` (no toco la API, pero
  lo corro por costumbre).
- `git diff` visual: las filas añadidas a las tablas deben tener el
  formato `| -flag | default | meaning |` consistente con las
  existentes.

Sigo sin tener `go`/`cargo`/`pwsh`/`staticcheck` en el entorno; los
cambios de esta ronda no tocan ese código, así que la falta no
impide verificar lo que toqué.

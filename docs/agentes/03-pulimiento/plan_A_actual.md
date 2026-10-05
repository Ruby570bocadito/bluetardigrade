# Plan de ronda — Pulimiento A (2026-10-05 12h13 Madrid)

Tercera ronda de Pulimiento A en la rama `carril/pulimiento-a`.
Continuidad de las rondas 1 y 2 (ver `roadmap_A.md`).

## Sincronización previa

- `git fetch origin --prune`: `origin/carril/implementacion-b` avanzó
  un commit (`6bd462a..31b39ae`: plan de la ronda 2 de IMP-B,
  streaming del analista — console-only, sin solapamiento con mi
  área). Las otras cuatro ramas de carril siguen sin existir.
- `git pull --ff-only origin carril/pulimiento-a`: already up to date.
- `git merge origin/main`: already up to date.
- Leído el plan de IMP-B ronda 2: trabaja en `web/console-service`
  (streaming del proveedor del analista IA) y en
  `docs/INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md`. **Cero
  solapamiento** con mi área. Nota: cuando IMP-B cierre su ronda 2,
  la fila «AI analyst» del feature inventory de ARCHITECTURE.md
  dirá «(no provider token streaming)» que será stale — pero eso
  es IMP-B quien lo debe actualizar al aterrizar su cambio, o yo en
  una ronda posterior si lo veo stale. No lo toco ahora.

## Identificadores del TODO trabajados

El repo sigue sin `TODO.md`. Continúo numerando mis hallazgos
`POL-A-<tema>`. Esta ronda:

- **POL-A-docs-7** — `docs/OPERATIONS.md` CLI subcommand table
  (línea ~1051): lista 5 de los 9 subcomandos reales de
  `cmd/engine/cli.go`. Faltan `engine doctor`, `engine report`,
  `engine ingest-identity`, `engine operator-credential`. Los 4
  existen con help, flags y tests propios. Deriva factual: un
  operador que lea la tabla no se entera de que `engine doctor`
  existe (y es la herramienta de diagnóstico principal, referenciada
  desde `docs/DOCTOR.md`).
- **POL-A-docs-8** — `docs/OPERATIONS.md` sección «Engine CLI
  reference»: la tabla de subcomandos no enlaza a `docs/DOCTOR.md`
  (que sí existe y está referenciado desde otros sitios). Aprovecho
  el añadido de `engine doctor` para enlazarlo.
- **POL-A-docs-9** — `docs/ARCHITECTURE.md` feature inventory,
  fila «Telemetry»: dice «Rust ETW sensor (Kernel-Process) +
  Sysmon ingestion path». Verifico que la afirmación sigue siendo
  cierta (el sensor Rust colecta Kernel-Process y el motor acepta
  Sysmon). Si hay deriva, la corrijo; si no, lo dejo. Solo texto.

## Ficheros que voy a tocar

- `docs/OPERATIONS.md` (tabla de subcomandos + enlace a DOCTOR.md)
- `changelog.d/PUL-A-cli-subcommands.md` (fragmento)
- `docs/agentes/03-pulimiento/ronda_2026-10-05_12h13_A.md` (informe)
- `docs/agentes/03-pulimiento/roadmap_A.md` (continuidad)

## Por qué

`docs/OPERATIONS.md` es mi área. La tabla de subcomandos incompleta
es deriva factual de alto valor: `engine doctor` es la herramienta
de diagnóstico que el propio `docs/OPERATIONS.md` referencia en su
sección de instalación («Diagnose an existing deployment with
`sf-engine doctor`: [checks, JSON, credentials and
TLS](DOCTOR.md)»), pero NO aparece en la tabla de subcomandos. Lo
mismo con `engine report` (referenciado desde
`docs/SOC-INTEGRACIONES-E-INFORMES.md`), `engine ingest-identity`
(referenciado desde la sección «Per-sensor ingest identities») y
`engine operator-credential` (referenciado desde la sección
«Active response»).

## Verificación prevista

Mis cambios son solo texto en `docs/OPERATIONS.md`. Verifico:

- `python3 scripts/dev-tests/check_rule_inventory.py` (la tabla que
  toco NO es la auto-generada, pero confirmo que los marcadores
  `<!-- BEGIN/END RULE INVENTORY -->` siguen intactos).
- `python3 scripts/dev-tests/check_openapi.py` (no toco la API).
- `git diff` visual: las filas añadidas a la tabla de subcomandos
  deben tener el formato `| \`engine <cmd>\` | <descripción> |`
  consistente con las existentes.

Sigo sin tener `go`/`cargo`/`pwsh`/`staticcheck` en el entorno; los
cambios de esta ronda no tocan ese código.

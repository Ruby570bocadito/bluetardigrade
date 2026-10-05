# Plan de ronda — Pulimiento A (2026-10-05 12h36 Madrid)

Sexta ronda de Pulimiento A en la rama `carril/pulimiento-a`.
Continuidad de las rondas 1-5 (ver `roadmap_A.md`).

## Sincronización previa

- `git fetch origin --prune`: `origin/carril/implementacion-b` avanzó
  un commit (`4257127..1e0d035`: plan de la ronda 3 de IMP-B,
  «graficas de ciclo de vida y riesgo»). Las otras cuatro ramas de
  carril siguen sin existir.
- `git pull --ff-only origin carril/pulimiento-a`: already up to date.
- `git merge origin/main`: already up to date.
- **Discord:** no se envió notificación de inicio
  (`DISCORD_WEBHOOK_URL` no definida; ya declarado).

## Coordinación con IMP-B — conflicto inminente detectado

El plan de IMP-B ronda 3 (commit `1e0d035`, timestamp 10:29:56 UTC)
dice en su punto 3: «Deuda docs (encargo de PUL-A): la fila "Console"
del inventario de `docs/ARCHITECTURE.md` dice "(no provider token
streaming)" — stale desde mi ronda 2; la actualizo a streaming nativo
con guardas de tiempo.»

**Mi commit `bac6b02` (timestamp 10:24:51 UTC, ~5 min ANTES del plan
de IMP-B)** ya actualizó esa fila a «(native provider streaming: the
answer renders as the model writes it; providers without streaming
deliver it in one piece)». IMP-B publicó su plan 5 min después de mi
commit, pero aparentemente no re-fetch-eó mi rama antes de escribir
su plan.

Según las reglas del carril: «Gana el carril dueño del área (tabla de
carriles) y, entre iguales, el plan que se publicó primero.» El
feature inventory de `docs/ARCHITECTURE.md` es mi área (Pulimiento A:
documentación técnica), y mi commit fue primero. Así que yo gano, y
IMP-B no debería tocar la fila.

Acciones:
1. No toco la fila esta ronda (ya está corregida en mi rama).
2. Dejo anotado en mi `roadmap_A.md` y en el informe que IMP-B tiene
   planeado tocar la fila «Console» y que yo ya la corregí, para que
   el responsable lo sepa al fusionar. Si IMP-B aterriza su cambio,
   habrá un conflicto de fusión en `docs/ARCHITECTURE.md` que se
   resuelve conservando mi edición (la versión correcta ya está en
   origin/carril/pulimiento-a).
3. No abro PR ni fusiono (lo hace el responsable).

## Identificadores del TODO trabajados

El repo sigue sin `TODO.md`. Continúo numerando mis hallazgos
`POL-A-<tema>`. Esta ronda:

- **POL-A-docs-14** — `docs/OPERATIONS.md` sección «Prometheus
  metrics»: la lista de familias `sf_*` que documenta está
  incompleta. Compara el listado de la doc contra
  `internal/api/metrics.go` (46 familias en código): la doc nombra
  explícitamente ~20 familias y usa wildcards (`sf_store_*`,
  `sf_correlator_*`, `sf_webhook_*_total`, `sf_elastic_*_total`,
  `sf_splunk_*_total`, `sf_notify_*_total`) para otras, pero omite
  completamente las familias de `baseline`, `beacon`, `threshold`,
  `intel`, `events_buffered`, `events_per_minute`,
  `ingest_identities`, `rules`, `uptime_seconds`. Las añado con
  wildcards donde proceda (ej. `sf_baseline_*`, `sf_beacon_*`,
  `sf_threshold_*`, `sf_intel_*`) y mención explícita para las
  restantes.

## Ficheros que voy a tocar

- `docs/OPERATIONS.md` (sección «Prometheus metrics», 1 párrafo)
- `changelog.d/PUL-A-prometheus-metrics-complete.md` (fragmento)
- `docs/agentes/03-pulimiento/ronda_2026-10-05_12h36_A.md` (informe)
- `docs/agentes/03-pulimiento/roadmap_A.md` (continuidad + nota de
  coordinación con IMP-B)

## Por qué

`docs/OPERATIONS.md` es mi área. La sección de Prometheus metrics
es la referencia que un operador usa para configurar sus alertas
y dashboards. Si omite 20 familias que existen en el código
(`sf_baseline_*`, `sf_beacon_*`, `sf_threshold_*`, `sf_intel_*`,
`sf_events_buffered`, `sf_events_per_minute`, `sf_ingest_identities`,
`sf_rules`, `sf_uptime_seconds`), el operador no sabe que puede
alertar sobre ellas ni que existen. La deriva es factual y de
alto valor operativo.

## Verificación prevista

Mis cambios son texto en `docs/OPERATIONS.md` (1 párrafo). Verifico:

- `python3 scripts/dev-tests/check_rule_inventory.py` (no toca
  reglas ni la tabla auto-generada; confirmo marcadores).
- `python3 scripts/dev-tests/check_openapi.py` (no toco la API).
- Script Python: comparar las familias `sf_*` mencionadas en la
  sección actualizada vs las que emite `internal/api/metrics.go`;
  la lista debe cuadrar (con wildcards expandidos).

Sigo sin tener `go`/`cargo`/`pwsh`/`staticcheck` en el entorno; los
cambios de esta ronda no tocan ese código.

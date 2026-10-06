# Plan de ronda — Pulimiento A (2026-10-05 20h05 UTC, ronda 10)

- **Contexto:** segundo reinicio de sandbox de la jornada (el carril no
  perdió nada esta vez: la ronda 9 está publicada en `origin`,
  `e66ece5`). «continua» del responsable autoriza esta ronda. Arranco
  absorbiendo `origin/main` (`35cd866`, solo dependabot: cellbuf
  v0.0.15 + 2 bumps; build+vet+tests de los paquetes calientes verdes
  tras la fusión, `0977ed7`).

## Identificadores del TODO trabajados

- **Drift de documentación técnica (área propia)** contra el árbol de
  `main` actual, medido con un script mecánico reutilizable
  (`scripts/docs_drift_audit.py`, fuera del repo). Hallazgos
  verificados uno a uno:
  1. `docs/ARCHITECTURE.md` «Repository layout»: faltan 4 paquetes
     que SÍ están en `main` — `internal/enroll` (tokens de alta con
     aprobación, `9f3b1e8` + unicidad SEC-A-1 `6b4e108`),
     `internal/report` (agregaciones puras del catálogo REP-1),
     `internal/scenario` (librería de escenarios + runner aislado
     in-process) y `internal/scenrun` (batería on-demand con
     historial, SIM-4 lado motor). Cero fantasmas (nada documentado
     que no exista).
  2. `docs/OPERATIONS.md`: `/api/reports`, `/api/reports/{kind}` y
     `/api/noise` (REP-1 parte A + informe de ruido §2.4, en `main`
     desde `6b4e108`) tienen CERO menciones en todo el fichero. La
     tabla «Local HTTP API» no los lista y no hay sección propia.
  3. `docs/ARCHITECTURE.md` «Feature inventory»: la fila «Analyst
     reports» describe solo el informe por-alerta (socreport) y el
     catálogo local del navegador; el catálogo de informes SOC del
     motor y el informe de ruido no existen para el lector. La fila
     «Console» no menciona el asistente de alta de sensores (tokens,
     aprobaciones pendientes, revoke) que aterrizó en `main`
     (`38de845`) — mismo patrón que la fila «AI analyst» de la ronda
     4: el carril dueño no tocó ARCHITECTURE.md, lo corrijo yo.
  4. Línea `sequences/` del layout: dice «kill-chain sequences» pero
     el directorio carga tres packs (`kill-chains.yaml`,
     `campaigns.yaml`, `lateral.yaml`).
- **Sin drift (verificado y NO tocado):** sección «Prometheus
  metrics» (las familias con wildcard `sf_elastic_*_total` etc.
  cubren los literales de `metrics.go`; `metrics.go` no cambió con
  `6b4e108`), tabla «Engine CLI reference» (las 10 filas con
  `scenarios list`/`replay` incluidas cubren los 9 subcomandos),
  diagrama «System overview» (nada de pipeline nuevo en main).

## Coordinación (leída antes de tocar nada)

- **IMP-A `bc91c7d` (sin fusionar):** AD-1/AD-2/SET-3 + SEC-2
  (DPAPI). En SU rama ya escribió en `docs/OPERATIONS.md`: fila
  `-ad`, fila `-scenarios` (prometida en su plan 16h05), reescritura
  de la fila `/api/stats`, 4 filas `/api/ad/*` insertadas tras
  `GET /api/rules`, y sección «Active Directory connector». Por eso
  ESTA ronda NO toca: la tabla «Engine flags», la fila `/api/stats`,
  las rutas `/api/ad/*` ni `openapi.yaml`. Mis filas nuevas en la
  tabla «Local HTTP API» van al FINAL de la tabla (tras
  `GET /api/stream`), lejos de su punto de inserción: merge limpio.
  Tampoco toco ARCHITECTURE.md... bueno, sí: IMP-A no lo toca en
  ninguna de sus ramas (verificado con diff), es área mía.
- **IMP-A tocó `internal/ingest/ingest.go` (+14):** método exportado
  nuevo `CertExpiry()` (SET-3), aditivo; no roza el handshake ni mi
  refactor. Sin acción.
- **SEG-A `aad1aed`:** su informe 19h39 verificación MI adopción de
  `FuzzEnrollLine` byte a byte (verificación cruzada entre carriles,
  sin acción). Su fix de idempotencia en `internal/respond` (en su
  rama) no toca docs.
- **POL-1 (`api.go`):** sigue diferido; con el +133 de IMP-A sobre
  `api.go` (sin fusionar aún) el paquete está más caliente que nunca.

## Ficheros que voy a tocar y por qué

- `docs/ARCHITECTURE.md`: 4 líneas de paquetes en el layout (en las
  posiciones temáticas correctas), línea `sequences/` completa,
  filas «Analyst reports» y «Console» del inventory.
- `docs/OPERATIONS.md`: 3 filas al final de la tabla «Local HTTP
  API» + párrafo propio en la misma sección (catálogo, contrato de
  fuente rings/store con `source`/`oldest_record`/`truncated`, caso
  especial `incident?id=`, escape CSV, ruido JSON-only con overlay
  de triage honesto) + sección dedicada «SOC reports and noise
  (REP-1)» tras «Incidents (cases)» con los parámetros exactos.
- `changelog.d/` (1 fragmento), `docs/agentes/03-pulimiento/`
  (plan, informe, roadmap). NADA más: ni `openapi.yaml`, ni tablas
  reservadas de IMP-A, ni `TODO.md`/`CHANGELOG.md`.
- Lección de las dos pérdidas aplicada: **push en cuanto la
  verificación pase**, no acumular commits locales.

## Verificación prevista

Re-ejecución del script de auditoría (sección 1 debe pasar a
«MISSING: none»), verificación de anclas de los enlaces internos
nuevos, `python3 -m py_compile` del script (fuera del repo), suite
Go completa (`gofmt`, build, vet, GOOS=windows, staticcheck x2,
`-race -count=1`), `-count=3` en `ingest` (área rozada por el merge
de main), `check_openapi.py --self-test` + `check_rule_inventory.py`
(openapi y reglas NO tocados: deben seguir verdes), `merge-tree`
contra las 5 ramas, push inmediato.

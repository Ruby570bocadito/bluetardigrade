# Plan de ronda — Pulimiento A (2026-10-05 14h10 Madrid)

Séptima ronda del carril. Continuidad en `roadmap_A.md` (ronda 6 cerrada
a las 14h05 con commit `1422427`).

## Sincronización previa

- `git fetch origin --prune`: `main` sigue en `5e168ba` (el responsable
  no ha fusionado carriles todavía). Mi rama al día con su remoto.
- Novedades leídas: IMP-A cerró su ronda 2 (SIM-4 parte A + x/text;
  tocó `internal/api`, `cmd/engine`, `openapi.yaml`, `go.mod` y añadió
  su sección de scenarios en `docs/OPERATIONS.md`); IMP-B cerró VIZ-1/3
  y planificó SET-3 (solo consola); SEG-B está EN RONDA activa
  (`deps-audit.yml` nuevo + `check_workflows.py` + Makefile + website;
  su parte (a) del CI rojo la lleva el PR #16, la (b) es de SEG-A);
  SEG-A y PUL-B sin cambios (PUL-B sin ALTA para este carril).

## Coordinación (sin colisiones)

- **`internal/api` sigue caliente:** la cola de IMP-A (REP-1, API de
  ruido) vuelve a tocar `internal/api` y `openapi.yaml`. El candidato
  POL-1 de esta ronda es `internal/correlate/correlate.go`, que no
  aparece en ningún plan publicado de ningún carril.
- **`-scenarios` en las tablas de flags:** el flag nuevo de IMP-A no
  está en la tabla «full surface» de `docs/OPERATIONS.md`. NO lo
  documento yo esta ronda: en `main` ese flag no existe todavía y
  documentarlo sería drift inverso (prometer flags que el código de
  main no tiene). Nota para IMP-A en el informe; en mi roadmap queda
  como pendiente por si hay que hacerlo tras su fusión (patrón ronda 4).
- **Enganches de CI diferidos** (checker de tema PUL-B, objetivos de
  fuzz SEG-A): siguen bloqueados porque `main` no se ha movido. Nada
  que hacer esta ronda en `ci.yml`; SEG-B además está en ronda activa
  en workflows (su `deps-audit.yml`, fichero nuevo, sin colisión).

## Identificadores del TODO trabajados

- **POL-1 (parte correlate):** dividir
  `internal/correlate/correlate.go` (789 líneas) por responsabilidad
  dentro del mismo paquete, sin cambiar comportamiento: cargar/recargar,
  seguimiento de estados, disparo, poda. Los tests del paquete
  (`correlate_test.go`, `scope_test.go`) no se tocan, solo se verifican.
- **POL-5 (parte procesos):** `CONTRIBUTING.md` + plantillas de issue
  (bug/feature) y de PR en `.github/` — no existen y son de este carril
  según el TODO. En inglés, como el resto de la documentación para
  contribuidores; referencias a los guards reales del CI
  (`check_openapi.py`, `check_rule_inventory.py`, `check_workflows.py`
  de SEG-B cuando exista en main — no lo referencio hasta que esté).
- **Fijos de ronda:** `.gitignore` y ficheros temporales.

## Ficheros que voy a tocar y por qué

- `internal/correlate/correlate.go` → dividido en ficheros por
  responsabilidad del mismo paquete (nuevos ficheros + el original
  reducido). POL-1, mi área; nadie más lo toca.
- `CONTRIBUTING.md` (nuevo), `.github/PULL_REQUEST_TEMPLATE.md` (nuevo),
  `.github/ISSUE_TEMPLATE/bug_report.md` + `.github/ISSUE_TEMPLATE/feature_request.md`
  + `config.yml` (nuevos). POL-5, mi área.
- `changelog.d/` (2 fragmentos), `docs/agentes/03-pulimiento/` (informe
  + roadmap). `docs/api/openapi.yaml` NO se toca (la API no cambia).

## Por qué este alcance

POL-1 es la única tarea del TODO que requiere el toolchain Go que esta
ronda anterior quedó instalado; `correlate.go` es el candidato con
menos riesgo de colisión (los otros dos están calientes: `api.go` por
la cola de IMP-A, `run.go` recién tocado por SIM-4 y con cuotas de
motor en cola). POL-5 (procesos de contribución) es autocontenido y
llevaba cero avance; el repo ya tiene `SECURITY.md` pero nada de cómo
contribuir, y es exactamente el tipo de documentación que un repo open
source necesita antes de crecer en contribuidores.

## Verificación prevista

Suite Go completa sobre el paquete tocado y el árbol entero:
`gofmt -l .`, `go build ./...`, `go vet ./...`, `GOOS=windows go build ./...`,
staticcheck doble pasada, `go test -race -count=1 ./...`, y los guards
de Python (`check_openapi.py` + self-test, `check_rule_inventory.py`).
Sin `cargo` ni `pwsh`: no toco sensor ni PowerShell.

# Plan de ronda — Pulimiento A (2026-10-06 07h00 UTC, ronda 11)

- **Contexto:** tercera sesión de la jornada. La ronda 10 (drift de
  docs) está publicada en `origin`, `df323ad`, sin pérdidas. «continua»
  del responsable autoriza esta ronda (segunda ronda extra sobre
  RONDAS_MAXIMAS=8). `origin/main` sigue en `35cd866` (ni mi rama ni
  IMP-A fusionadas): POL-1 (`api.go`) sigue reservada por IMP-A.

## Identificadores del TODO trabajados

- **DEFECTO ENCONTRADO AL EJECUTAR: `make` está ROTO en todo el
  árbol.** `make -n build` falla con «missing separator (did you mean
  TAB instead of 8 spaces?)» en CUALQUIER target: el commit `63fa077`
  («ci: workflow trigger guard and unfiltered deps-audit push
  (SEC-5)», 2026-10-05 11:26 UTC, en main) reescribió TODAS las
  recetas del Makefile con 8 espacios (su propio diff muestra
  `-\t$(GO)...` → `+        $(GO)...`), y su mensaje dice «Wired into
  make ci» — el autor nunca lo ejecutó. Nadie lo notó porque CI
  ejecuta los comandos directamente y nunca invoca make. Es la MISMA
  clase de «infraestructura que nada testea» que ya produjo el drift
  de la matriz de fuzz. Reparo: reconversión mecánica a tabuladores +
  guardia estática nueva `scripts/dev-tests/check_makefile_tabs.py`
  (solo stdlib, con `--self-test`, estilo de la casa como
  `check_workflows.py`) cableada en el job engine de `ci.yml` y en el
  target `ci` del Makefile (paridad).
- **CI anti-drift (área propia, CI = POL):** el paso «Go engine Windows
  cross-check» de `ci.yml` vet-ea una LISTA EXPLÍCITA de 3 paquetes
  (`internal/respond/`, `internal/api/`, `cmd/engine/`) bajo
  `GOOS=windows`. Es exactamente la clase de fallo que
  `bench-nightly.yml` documenta haber corregido para los fuzz targets:
  «The previous explicit step list drifted out of sync with the tree:
  while the module shipped twenty targets the job silently ran one,
  and nothing failed». Hoy la lista es CORRECTA (los únicos ficheros
  windows-only del árbol son `cmd/engine/doctor_windows.go` y
  `internal/respond/process_windows.go`, verificado con
  `git ls-files | grep _windows.go` y `git grep '//go:build windows'`),
  pero la próxima rama que añada un paquete con código windows-only
  (p. ej. IMP-A si su conector AD crece una vía Windows) quedaría
  fuera del vet silenciosamente. El Makefile replica la misma lista en
  el target `ci` (línea 102): se cambia AMBAS para mantener la paridad.
- **Cambio:** `GOOS=windows go vet ./...` (descubrimiento, nunca
  derivable) en `ci.yml` y Makefile. Comportamiento del producto:
  SIN CAMBIO (es CI). El vet bajo GOOS=windows además type-chequea los
  `_test.go` con constraints de Windows, algo que el `GOOS=windows go
  build ./...` del paso anterior no hace.
- **Coordination note para PUL-B (documentada, no bloquea):** sus
  targets nuevos `console-a11y`/`console-lighthouse` (ronda 5, sin
  fusionar) también traen recetas con 8 espacios; cuando aterricen
  chocarán con mi guardia. Deben reindentar a tabuladores; lo dejo
  anotado en el informe y en el roadmap.
- **Coste medido localmente (Go 1.26.6, sandbox):** primera pasada fría
  de la lista actual: 8,6 s; `./...` con caché caliente: 1,1 s. El
  coste incremental real en el runner (caché de setup-go tibia) es de
  segundos frente al timeout de 15 min del job. No es una excusa para
  no hacerlo; lo documento en el comentario del workflow.
- **Qué NO hago:** no toco `deps-audit.yml` (SEC-5, diseño de
  Seguridad: su `on: push` sin filtro de rama es deliberado según su
  cabecera); no toco el job `engine-windows` (añadir `-race` a Windows
  infla el coste de un job que ya es el más caro; decisión del
  responsable si algún día se quiere); no toco la lista de lockfiles
  de osv-scanner (mismo argumento SEC-5); POL-1 y `run.go` siguen
  esperando a IMP-A.

## Coordinación (leída antes de tocar nada)

- **Los 5 carriles re-auditados tras el fetch:** SEG-A `4e34c8a`
  (ronda 11: auditoría AD/SEC-2, SOLO docs de su directorio — diff
  verificado, 0 ficheros de código); SEG-B `55c8b35` (guarda CSV en
  consola + churn de go.mod por merge de main); PUL-B `21d73f0`
  (merge de main + plan de ronda 5: CSP, manifest, guardia i18n —
  nada ejecutado aún); IMP-B `5ecbcc4` sin cambios; IMP-A `bc91c7d`
  sin cambios. NADIE ha tocado `internal/ingest`, `internal/enroll`
  ni ningún territorio de código mío desde la ronda 10.
- **merge-tree (pre-cambio) contra las 5 ramas abiertas:** IMP-A,
  IMP-B, PUL-B, SEG-B CLEAN; SEG-A reproduce SOLO el conflicto de
  imports de `internal/ingest/fuzz_test.go` ya pre-documentado en la
  ronda 9 (resolución conocida: mantener ambos `"time"` y
  `"unicode"`). Ninguna rama toca `ci.yml`; PUL-B toca el Makefile
  PERO en otra región (`.PHONY` + targets `console-a11y`/
  `console-lighthouse` nuevos): hunks disjuntos, fusión limpia —
  re-verificaré merge-tree tras el commit.
- **SEG-A tocó `internal/ingest/ingest.go` en su día (CertExpiry,
  aditivo) — ya absorbido y sin relación con este cambio.**

## Ficheros que voy a tocar y por qué

- `Makefile`: reconversión de TODAS las recetas 8-espacios →
  tabulador (commit propio, mecánico, `make -n` de todos los targets
  como verificación) + línea del vet en el target `ci` →
  `GOOS=windows $(GO) vet ./...` + cableado de la guardia nueva en
  `ci` (paridad con ci.yml).
- `scripts/dev-tests/check_makefile_tabs.py` (nuevo): guardia estática
  de tabuladores en posición de receta, con `--self-test` y fixtures
  embebidas (buena, mala, asignación con espacios OK, continuación
  con backslash OK).
- `.github/workflows/ci.yml`: paso «Go engine Windows cross-check» →
  `GOOS=windows go vet ./...` + comentario que documente la clase de
  drift (descubrimiento vs lista), el coste medido y por qué la lista
  explícita es la misma clase de fallo que la matriz de fuzz ya
  eliminó; paso nuevo «Makefile recipe guard» con self-test.
- `changelog.d/PUL-A-makefile-recipes.md` +
  `changelog.d/PUL-A-windows-vet-discovery.md` (nuevos).
- `docs/agentes/03-pulimiento/`: plan (este), informe
  `ronda_2026-10-06_07h00_A.md`, fila en `roadmap_A.md`.
- NADA más: ni `openapi.yaml`, ni lockfiles, ni docs de producto,
  ni `TODO.md`/`CHANGELOG.md`.
- **Push en cuanto la verificación pase** (lección de la jornada).

## Verificación prevista

`check_workflows.py --self-test` + normal (valida los triggers tras
editar el YAML), batería Go completa: `gofmt -l`, build, vet,
`GOOS=windows go build ./...`, `GOOS=windows go vet ./...` (el comando
NUEVO, ejecutado de verdad), staticcheck x2, `go test -race -count=1
./...`, `-count=3` en `ingest`, smokes file+soc, `check_openapi.py
--self-test`, `check_rule_inventory.py`, `check_package_lifecycle.py
--self-test`, `check_installer_native_stderr.py` (todo lo que el CI
ejecuta y mi entorno permite). Re-cuento de fuzz targets (`git grep
'^func Fuzz'` = 22/11, sin cambios esperados). merge-tree post-commit
contra las 5 ramas. Escaneo anti-credenciales del diff. Push inmediato
y verificación con `git ls-remote` de que remoto == local.

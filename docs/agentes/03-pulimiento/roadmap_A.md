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
- **Remoto:** `origin/carril/pulimiento-a` existe desde el cierre de
  la ronda 1 (push con token efímero en la URL, no guardado en
  config ni en ficheros).
- **Commits publicados:**
  1. `plan: ronda 2026-10-05 (PUL-A)` — plan ronda 1.
  2. `pulimiento: docs layout, campaigns doc, gitignore coverage (PUL-A)` — trabajo ronda 1.
  3. `plan: ronda 2026-10-05 12h08 (PUL-A)` — plan ronda 2.
  4. `pulimiento: complete engine flags tables and document API TLS (PUL-A)` — trabajo ronda 2.
  5. `plan: ronda 2026-10-05 12h13 (PUL-A)` — plan ronda 3.
  6. `pulimiento: complete CLI subcommand table and fix Telemetry inventory row (PUL-A)` — trabajo ronda 3.
  7. `plan: ronda 2026-10-05 12h23 (PUL-A)` — plan ronda 4.
  8. `pulimiento: fix stale AI analyst inventory row after IMP-B streaming landed (PUL-A)` — trabajo ronda 4.
  9. `plan: ronda 2026-10-05 12h27 (PUL-A)` — plan ronda 5.
  10. `pulimiento: align system overview diagram with the real engine pipeline (PUL-A)` — trabajo ronda 5.
  11. `plan: ronda 2026-10-05 12h36 (PUL-A)` — plan ronda 6 (publicado por la instancia anterior; no llegó a ejecutarse).
  12. `plan: ronda 2026-10-05 13h42 ajustada (PUL-A)` — plan ronda 6 ajustado tras leer los seis planes.
  13. `pulimiento: complete Prometheus families, POL-4 branding, nightly fuzz job (PUL-A)` — trabajo ronda 6.
  14. `plan: ronda 2026-10-05 14h10 (PUL-A)` — plan ronda 7.
  15. `pulimiento: split correlate by responsibility, add contribution process (PUL-A)` — trabajo ronda 7 (fusionado en `main` con la integración de la ronda 1).
  16. `plan: ronda 2026-10-05 16h00 (PUL-A)` — plan ronda 8 (esta instancia).
  17. `plan: ronda 2026-10-05 16h00 ajustada tras leer los seis planes (PUL-A)`.
  18. `nightly fuzzing: discovery matrix runs every target; AUTH/ENROLL first-line target` — trabajo ronda 8.
  19. `ci: console theme gate in the console job; nightly fuzzing documented`.
  20. `comments: provenance becomes technical rationale`.
  21. Informe + roadmap + changelog.d (commit de cierre de la ronda 8).
  22. `plan: ronda 2026-10-05 18h33 re-ejecutada (PUL-A)` — plan ronda 9.
      La primera instancia de esta ronda (autorizada por el responsable
      con «continua») completó 4 commits locales que se PERDIERON con el
      reinicio del sandbox sin llegar a pushear; esta ronda re-ejecuta
      el mismo alcance re-verificado contra las puntas remotas actuales.
  23. `ingest: adopt SEG-A's FuzzEnrollLine target verbatim (PUL-A)` —
      trabajo ronda 9.
  24. `comments: SEC-A-1 notes lose lane provenance, keep the design
      rationale (PUL-A)` — cierre de POL-12.
  25. Informe + roadmap + changelog.d (commit de cierre de la ronda 9).
  26. `report: record the round push with the responsable's ephemeral
      token (PUL-A)` — enmienda del informe de la ronda 9.
  27. `Merge remote-tracking branch 'origin/main'` — absorbe
      `35cd866` (dependabot) al abrir la ronda 10.
  28. `plan: ronda 2026-10-05 20h05 (PUL-A)` — plan ronda 10.
  29. `docs: layout lists enroll/report/scenario/scenrun; SOC reports
      and noise documented (PUL-A)` — trabajo ronda 10.
  30. Informe + roadmap + changelog.d (commit de cierre de la ronda 10).
  31. `plan: ronda 2026-10-06 07h00 (PUL-A) - make repair and windows
      vet discovery` — plan ronda 11.
  32. `makefile: restore tab recipe indentation (make has been broken
      since 63fa077)` — reparo mecánico (63 recetas), ronda 11.
  33. `ci: vet the whole module under GOOS=windows; guard Makefile
      recipe tabs` — trabajo ronda 11 (vet descubrimiento + guardia
      nueva + 2 fragments).
  34. Informe + roadmap (commit de cierre de la ronda 11).

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

- **2026-10-05 12h08 (ronda 2):** pulimiento de tablas de flags en
  `docs/OPERATIONS.md`. Informe en
  `ronda_2026-10-05_12h08_A.md`. Resumen:
  - Tabla «Configuration reference»: 6 flags faltantes añadidos
    (`-intel`, `-baseline-learn`, `-thresholds`, `-notify`,
    `-api-cert`/`-api-key`, `-incidents`). La afirmación «full
    surface — no other knobs» era falsa; ahora cierta.
  - Tabla «`engine run` flags»: 7 flags faltantes añadidos
    (`-notify`, `-api-cert`/`-api-key`, `-ingest-cert`/`-ingest-key`,
    `-lifecycle`, `-incidents`). Ambas tablas ahora listan las 40
    entradas de `cmd/engine/flags.go`.
  - Sección «Local HTTP API»: añadido párrafo documentando
    `-api-cert`/`-api-key` (TLS del API listener) junto al de
    `-api-token`. Antes la sección documentaba auth pero no cifrado.
  - 1 fragmento en `changelog.d/`: `PUL-A-cli-flags-complete.md`.
  - `-api-cert`/`-api-key` eran lo más grave: no estaban en NINGÚN
    sitio de la doc, aunque `internal/api/api.go` `NewTLS` +
    `tlsutil.Reloader` los soportan.

- **2026-10-05 12h13 (ronda 3):** pulimiento de tabla de
  subcomandos CLI + fila «Telemetry» del feature inventory.
  Informe en `ronda_2026-10-05_12h13_A.md`. Resumen:
  - `docs/OPERATIONS.md` tabla «Engine CLI reference»: listaba 5
    de 9 subcomandos. Añadidos `engine doctor`, `engine report`,
    `engine ingest-identity`, `engine operator-credential` con
    flags reales y enlaces a las secciones que ya los documentaban
    en prosa.
  - `docs/ARCHITECTURE.md` fila «Telemetry»: decía «Rust ETW
    sensor (Kernel-Process)» pero el sensor colecta de 4 providers
    desde el commit `0a4a8aa`. Actualizada a Kernel-Process +
    Kernel-Network + Kernel-Registry + DNS-Client, más image
    hashes en el enriquecimiento.
  - 1 fragmento en `changelog.d/`: `PUL-A-cli-subcommands.md`.
  - La deriva de «Telemetry» era la más grave de esa ronda: un
    lector de ARCHITECTURE.md creía que el sensor solo colectaba
    procesos, cuando en realidad colecta red, registro y DNS.

- **2026-10-05 12h23 (ronda 4):** pulimiento de la fila «Console»
  del feature inventory + cierre de la auditoría fila por fila.
  Informe en `ronda_2026-10-05_12h23_A.md`. Resumen:
  - `docs/ARCHITECTURE.md` fila «Console»: el paréntesis «(no
    provider token streaming)» era stale tras el commit `4257127`
    de IMP-B (streaming nativo del analista). IMP-B no tocó
    ARCHITECTURE.md (es mi área); lo corregí yo. Actualizado a
    «(native provider streaming: the answer renders as the model
    writes it; providers without streaming deliver it in one
    piece)».
  - Auditoría de las 3 filas restantes (Storage, Auth, Ops)
    contra el código: las tres verifican correctamente, sin
    deriva. La auditoría fila por fila del feature inventory
    (13 filas) queda cerrada.
  - 1 fragmento en `changelog.d/`:
    `PUL-A-analyst-streaming-inventory.md`.
  - La observación para IMP-B sobre la fila «AI analyst» se cierra
    (la actualicé yo).

- **2026-10-05 12h27 (ronda 5):** pulimiento del diagrama «System
  overview» + párrafo bajo el diagrama. Informe en
  `ronda_2026-10-05_12h27_A.md`. Resumen:
  - `docs/ARCHITECTURE.md` diagrama mermaid: 3 clases de deriva
    corregidas. (1) Endpoint subgraph decía solo «Kernel-Process»;
    ahora lista los 4 providers (Kernel-Process, Kernel-Network,
    Kernel-Registry, DNS-Client). (2) Pipeline omitía 9 componentes
    reales (intel/baseline/fleet en enriquecimiento;
    forensic/lifecycle/suppress en alerta; notify/siem como sinks
    junto al webhook; respond como sink de acción); ahora los
    muestra. (3) Webhook node estaba mal etiquetado como «SIEM/SOAR
    collector»; split en 3 nodos (webhook, notify, siem).
  - `docs/ARCHITECTURE.md` párrafo bajo el diagrama: ampliado para
    nombrar productores (Rust ETW sensor, Go SOC collector,
    external producers) y consumidores (API, consola, sinks
    SIEM/notificación) reales del schema unificado.
  - 1 fragmento en `changelog.d/`:
    `PUL-A-system-overview-diagram.md`.
  - Verificación: script Python de coherencia de nodos del mermaid
    (0 huérfanos); no hay validador mermaid formal en el entorno,
    verificación manual declarada.

- **2026-10-05 13h42 (ronda 6, esta instancia):** POL-A-docs-14 +
  POL-4 alcance nombrado + job de fuzzing nocturno + primera
  verificación Go completa del carril. Informe en
  `ronda_2026-10-05_13h42_A.md`. Resumen:
  - `docs/OPERATIONS.md` «Prometheus metrics»: las 47 familias `sf_*`
    de `internal/api/metrics.go` enumeradas y agrupadas, con emisión
    condicional documentada y la advertencia del plural
    `sf_thresholds_fired_total`; señal de alarma nueva
    (`sf_store_write_failures_total`). Verificado con cruce mecánico
    47/47.
  - POL-4 (alcance nombrado por el TODO): banner «BLUETARDIGRADE
    ENGINE» (`render.go`), marco TUI «BLUETARDIGRADE»
    (`interactive.go`), metadatos + `job_name` de `openapi.yaml`, y
    rutas del `Dockerfile` a `/opt/bluetardigrade` +
    `/var/lib/bluetardigrade`. El resto de restos del nombre antiguo
    quedó clasificado en el informe (contratos congelados por tests,
    crate Rust real, legacy, histórico, territorio ajeno).
  - `bench-nightly.yml`: job asesor `fuzz` (un paso por objetivo,
    `-fuzztime 5m`), hoy con `FuzzFieldMapParity` (pkg/model); petición
    de SEG-A. Smoke local: 24k execs PASS.
  - Enganche de `check_console_theme.py` (petición de PUL-B) DIFERIDO
    con causa: su checker falla contra `main` (`html.light` aún sin
    fusionar); se engancha cuando su rama se fusione.
  - **Hito:** Go 1.26.0 + staticcheck 2025.1.1 instalados en el
    entorno; suite completa verde por primera vez (33 paquetes con
    `-race`, staticcheck doble pasada, guards de OpenAPI e inventario).
  - 3 fragmentos en `changelog.d/`: `PUL-A-prometheus-metrics-complete.md`,
    `PUL-A-old-name-remnants.md`, `PUL-A-nightly-fuzz.md`.

- **2026-10-05 14h10 (ronda 7, esta instancia):** POL-1 (parte
  correlate) + POL-5 (parte procesos). Informe en
  `ronda_2026-10-05_14h10_A.md`. Resumen:
  - `internal/correlate/correlate.go` (790 líneas) dividido en 5
    ficheros por responsabilidad (`sequence`/`state`/`observe`/
    `inspect`/Manager), movimiento verbatim, mismo paquete. Equivalencia
    verificada con `go doc -all` (idéntica salvo el párrafo de layout
    añadido) + suite completa verde.
  - `CONTRIBUTING.md` + plantillas de issue/PR en `.github/` (no
    existían); issues en blanco desactivados con enlace al advisory
    privado de SECURITY.md.
  - Toolchain corregido: staticcheck 2025.1.1 → **2026.2.1** (la que el
    Makefile/CI declara); doble pasada re-ejecutada verde.
  - Coordinación: fila `-scenarios` de la tabla «Engine flags»
    pendiente de la fusión de IMP-A (documentar antes sería drift
    inverso); nota dejada en el informe.
  - 2 fragmentos en `changelog.d/`: `PUL-A-correlate-split.md`,
    `PUL-A-contribution-process.md`.

- **2026-10-05 16h00-16h41 UTC (ronda 8, esta instancia):** SEC-7
  nocturno completo + objetivo AUTH/ENROLL + POL-12 + enganche del
  checker de tema. Informe en `ronda_2026-10-05_16h41_A.md`. Resumen:
  - `bench-nightly.yml`: job `fuzz` convertido en **matriz generada
    por descubrimiento** (`git grep '^func Fuzz'` → JSON →
    `matrix.include`), 5 min por objetivo, `max-parallel: 10`, guard
    contra matriz vacía, crasher como artefacto. 21/21 objetivos
    verificados con el comando exacto de la matriz en local.
  - `FuzzAuthEnrollFirstLine` nuevo en `internal/ingest`:
    clasificación AUTH/ENROLL + `parseEnrollLine` (extraído verbatim
    de `handleEnroll`); 531.590 execs/45 s sin fallos.
  - POL-12: ~90 comentarios (workflows, Go, scripts) de procedencia
    (ronda/carril/agente/Director/acta) a porqué técnico; IDs de
    requisitos de diseño y hashes de commit se conservan. Exceptuados
    `internal/enroll/` (IMP-A caliente).
  - `check_console_theme.py` enganchado a `ci.yml` (job console) y a
    `make ci`; verificado verde sobre `main` antes de enganchar.
  - POL-1 (`api.go`) DIFERIDO: IMP-A tiene `internal/api` en su plan.
  - Bug hallazgo para SEG-A: `decodeText` no elimina doble BOM
    (repro en el informe); la primera noche de la matriz lo
    reencontrará y el job advisory se pondrá rojo — pre-anotado.
  - 2 fragmentos en `changelog.d/`: `PUL-A-nightly-fuzz-matrix.md`,
    `PUL-A-console-theme-ci.md`.

- **2026-10-05 18h33 UTC (ronda 9, re-ejecución de esta instancia):**
  adopción de los objetivos de fuzz de SEG-A + cierre de POL-12.
  Informe en `ronda_2026-10-05_18h33_A.md`. Resumen:
  - La primera instancia de la ronda (17h20) se perdió con el reinicio
    del sandbox: 4 commits locales nunca pusheados. Re-ejecución
    autorizada por el responsable («continua» más allá de
    RONDAS_MAXIMAS=8 se mantiene).
  - `FuzzEnrollLine` + `fuzzEnrollRegistry` de SEG-A (107 líneas)
    adoptados VERBATIM en `internal/ingest/fuzz_test.go` (verificación
    byte a byte contra su rama; 4.105 bytes idénticos) + sus 5 imports
    (`encoding/json`, `errors`, `io`, `net`, `time`) al bloque común.
    Sus objetivos y los míos conviven: el suyo ejercita el handshake
    ENROLL completo sobre `net.Pipe`; el mío, la clasificación
    AUTH/ENROLL y el parseo de campos. Pasada real: 291.345 execs
    en 30 s, PASS.
  - POL-12 CERRADO: los 2 comentarios de `internal/enroll` pierden
    «(Seguridad A, ronda 2026-10-05 13h34)» y conservan el ID
    `SEC-A-1`. Desbloqueado por: fix SEC-A-1 ya en `main` (`6b4e108`)
    y el plan nuevo de IMP-A (16h05) ya no lista `internal/enroll`.
  - Coordinación: main avanza a `35cd866` (solo dependabot); el plan
    nuevo de IMP-A reconfirma «POL-1 api.go tras mi fusión».
  - 1 entrada añadida al fragmento `PUL-A-nightly-fuzz-matrix.md`.

- **2026-10-05 20h05 UTC (ronda 10, esta instancia):** drift de la
  documentación técnica contra `main`, medido con auditoría mecánica.
  Informe en `ronda_2026-10-05_20h05_A.md`. Resumen:
  - Segundo reinicio de sandbox del día; SIN pérdida (ronda 9 ya
    publicada). main absorbido (`35cd866`, dependabot).
  - Layout de ARCHITECTURE.md: 4 paquetes ausentes añadidos
    (`enroll`, `report`, `scenario`, `scenrun`); línea `sequences/`
    completa (tres packs). Cero fantasmas.
  - OPERATIONS.md: `/api/reports`, `/api/reports/{kind}` y
    `/api/noise` (REP-1, en main desde `6b4e108`) documentados:
    3 filas al final de la tabla «Local HTTP API» + sección «SOC
    reports and noise (REP-1)» con los contratos del OpenAPI.
  - Inventory: filas «Analyst reports» (catálogo del motor + ruido)
    y «Console» (asistente de alta, `38de845`) al día.
  - Sin drift (verificado, no tocado): Prometheus, tabla CLI,
    diagrama. Territorio de IMP-A (flags/-scenarios//api/ad/*/
    stats/openapi) intacto: insertado lejos de sus puntos, merge-tree
    limpio.
  - 1 fragmento: `PUL-A-docs-soc-reports-layout.md`.
  - Push INMEDIATO tras la verificación (lección del día).

- **2026-10-06 07h00 UTC (ronda 11, esta instancia):** reparo del
  Makefile roto + vet cross-Windows por descubrimiento. Informe en
  `ronda_2026-10-06_07h00_A.md`. Resumen:
  - **Hallazgo al ejecutar:** `make` falla con «missing separator» en
    TODOS los targets: `63fa077` (SEC-5, en main) reescribió las 63
    recetas con 8 espacios y nadie lo vio porque CI nunca invoca
    `make`.
  - Reparo mecánico 63 líneas → tab (`49afd06`); `make -n` de los 17
    targets ok; `make build` real ok.
  - Guardia nueva `check_makefile_tabs.py` (estática, stdlib, con
    self-test de 5 fixtures) en el job engine de `ci.yml`; NO dentro
    de `make ci` (código muerto autorreferencial, desviación razonada
    del plan en el informe).
  - `GOOS=windows go vet ./...` (descubrimiento) sustituye a la lista
    explícita de 3 paquetes en `ci.yml` y `make ci`; coste medido:
    segundos. Type-chequea además los `_test.go` bajo Windows.
  - Coordinación: 5 carriles re-auditados, nadie en mi territorio;
    merge-tree pre/post limpio (SEG-A: solo el conflicto de imports
    pre-documentado). Observación ABIERTA para PUL-B: sus targets
    nuevos traen recetas con espacios.
  - 0 líneas de código Go del producto tocadas. 2 fragments.
  - Push INMEDIATO tras la verificación.

- **2026-10-06 07h47 UTC (ronda 12, esta instancia):** cerradas las
  delegaciones de SEG-B hacia PUL-A. Informe en
  `ronda_2026-10-06_07h47_A.md`. Resumen:
  - Punto 5 de SEG-B (`--ignore-scripts` en el harness de
    navegador): DECIDIDO E IMPLEMENTADO — los dos `npm install` de
    `tools/console-tests` en `ci.yml` llevan `--ignore-scripts` +
    comentario que documenta por qué es seguro (esbuild vía
    dependencia opcional de plataforma, jsdom JS puro, postinstall de
    playwright meramente informativo). Verificado en local con la
    secuencia exacta de CI: check DOM 34/34, CLI de playwright
    íntegro sin postinstall.
  - Punto 3 de SEG-B (fuzzing nocturno `-fuzztime=5m` por objetivo +
    corpus en `testdata/`): YA IMPLEMENTADO desde la ronda 5
    (`bench-nightly.yml:136`, discovery de 22 objetivos/11 paquetes);
    sin cambio de código.
  - Observación ABIERTA para SEG-B: sus recetas nuevas en el
    Makefile van con espacios (choque con mi guardia de tabs).
  - 1 fragmento en `changelog.d/`:
    `PUL-A-ignore-scripts-harness.md`.

- **2026-10-06 08h12 UTC (ronda 13, esta instancia):** pre-flight de
  fusión — guardia ejecutada SOBRE los árboles fusionados simulados
  de los 5 carriles. Informe en `ronda_2026-10-06_08h12_A.md`.
  Resumen:
  - Método nuevo: `merge-tree --write-tree` + `git show <árbol>:Makefile`
    + guardia sobre el resultado. Detecta lo que `--name-only` no ve:
    el contenido de las fusiones limpias.
  - SEG-A/SEG-B/IMP-A: guardia OK en el Makefile fusionado; ci.yml
    fusionado idéntico al mío en los 5 carriles (mi
    `--ignore-scripts` sobrevive en todos los futuros).
  - **Cierro con corrección mi observación a SEG-B** (ronda 12): era
    errónea — sus líneas con espacios son del merge-base
    (`63fa077`), no suyas; el Makefile fusionado con su carril es
    idéntico al mío. Su «sin acción requerida» era correcto.
  - **Confirmo y preciso mi observación a PUL-B** (ronda 11): 7
    líneas de receta con espacios (console-a11y 86-88,
    console-lighthouse 93-96 del fusionado) + nota de que sus
    `npm install` de esos targets carecen de `--ignore-scripts`.
  - **Observación NUEVA para IMP-B** (el fusilador probable: su rama
    absorbió IMP-A y PUL-B): remedio en su rama antes de fusionar.
  - Sin fragmento de changelog (ronda docs-only).

## Respuesta al addendum de SEG-A (conflicto sobre fuzz_test.go)

El addendum de SEG-A (`783b5a8`) anotaba un conflicto append-append
con esta rama sobre `internal/ingest/fuzz_test.go`. Esta ronda lo
resuelve en la fuente: SU código está adoptado aquí verbatim, así que
al fusionar su rama el bloque EOF coincide en ambos lados y se
auto-fusiona; el único conflicto que queda es el bloque de imports
(una región de ~6 líneas): conservar las líneas `"time"` y
`"unicode"` además de las que aporta su lado, todo en un solo grupo
std ordenado. `gofmt` ya deja el bloque resultante en su forma final.
Verificado con `git merge-tree --write-tree` a 18h33: las otras
4 ramas abiertas limpias; con `carril/seguridad-a`, conflicto solo en
ese fichero.

## Pendientes para la siguiente ronda

### Verificación

- **RESUELTO (ronda 6, RE-RESUELTO en la ronda 9 tras el reinicio del
  sandbox):** el entorno tiene Go 1.26.6
  (`/home/z/my-project/tools_go`) y staticcheck 2026.2.1
  (`/home/z/my-project/gopath/bin`); la suite completa del carril
  pasó verde tras la re-ejecución. El reinicio también borró el
  worklog del entorno (reconstruido) y no trajo tokens: el push
  vuelve a requerir un token efímero del responsable. Persisten
  fuera del entorno: `cargo` (sensor Rust), `pwsh` (guards de
  PowerShell) y la suite de consola (`bun` está disponible; no se ha
  montado el árbol de deps de la consola en este entorno).
- **Push a origin:** resuelto desde el cierre de la ronda 1 (token
  efímero en la URL del push, no guardado en config ni en ficheros).
- **Recordatorio de paridad:** la suite Go corre con
  `PATH=/home/z/my-project/tools_go/bin:/home/z/my-project/gopath/bin:$PATH`
  y `GOPATH=/home/z/my-project/gopath`.

### POL-A-code-1 — refactor del backend Go (cola actualizada)

- **`internal/api/api.go` (1367 líneas): PRIMERO de la cola.** Esta
  ronda se difirió por la condición del responsable: IMP-A lleva
  `internal/api/reports.go` + `noise.go` en su plan (REP-1). Cuando su
  ronda se fusione y enfríe el paquete: split del Hub por dominio
  (stats, events, alerts, suppressions, respond, forensics, sse) en el
  mismo paquete, verificación con `go doc -all` antes/después como en
  correlate.
- **`cmd/engine/run.go` (1091 líneas):** posible extracción de bloques
  de wiring a helpers; evaluar coste/beneficio. Su sección de escenarios
  la tocó la integración de la ronda 1 (SIM-4); verificar con
  merge-tree y planes antes de mover nada.
- **`sensor/src/collector.rs`:** requiere `cargo` (no disponible en el
  entorno).

### POL-A-ci-2 — enganches de CI

- **Checker de tema: HECHO (ronda 8)** — `check_console_theme.py` en
  el job `console` de `ci.yml` y en `make ci`.
- **Harness de navegador sin lifecycle scripts: HECHO (ronda 12)** —
  `--ignore-scripts` en los dos `npm install` de
  `tools/console-tests` en `ci.yml` (delegación de SEG-B, su punto
  5, cerrada). Cuando PUL-B aterrice su manifiesto `bun.lock`, bun ya
  bloquea por defecto los lifecycle scripts no confiables: la
  decisión sigue siendo válida en cualquiera de los dos harness.
- **Objetivos de fuzz de SEG-A: CUBIERTOS POR DISEÑO (ronda 8)** — la
  matriz descubre cada `func Fuzz*` del árbol; los fuzzers futuros de
  SEG-A entran solos, sin editar el workflow.
- **Idea evaluada y diferida:** caché del corpus de fuzzing entre
  noches (`actions/cache` sobre el dir de corpus por objetivo,
  clave por fecha con restore-prefix). Ganancia real de profundidad;
  coste: 20 entradas de caché/noche y ruido de revisión. Decidir con
  el responsable si el nocturno se queda estable.

### POL-12 — resto: CERRADO (ronda 9)

- Los 2 comentarios de `internal/enroll/enroll.go:481` y
  `internal/enroll/enroll_test.go:302` perdieron la procedencia
  «(Seguridad A, ronda 2026-10-05 13h34)» y conservan el ID `SEC-A-1`
  con el porqué técnico completo (ronda 9). Solo comentarios; la
  suite pasa sin tocar tests.
- Decisión editorial para el responsable (no bloqueante): los IDs
  «dictamen Qx/Ox» de `internal/respond` y scripts son referencias a
  requisitos de decisión sin ronda/carril/agente; se conservaron.
  Si quiere renombrarlos a «design req Qx», es un pase propio.

### POL-A-ci-1 — revisión de CI: ronda 11 ejecutada

La revisión completa de los 4 workflows (`ci.yml`,
`bench-nightly.yml`, `deps-audit.yml`, `release.yml`) se hizo en la
ronda 11 con dos salidas: el vet cross-Windows pasó de lista explícita
de 3 paquetes a `./...` (descubrimiento, misma filosofía que la matriz
de fuzz) y el Makefile roto por `63fa077` se reparó con guardia nueva
(`check_makefile_tabs.py`) en el job engine. Re-visitar cuando:

- un job nuevo se añada (coordinar nombre/runner/timeout con el
  estándar),
- una action suba de versión mayor (verificar el SHA contra el tag
  oficial con `git ls-remote`),
- la matriz de OS cambie,
- Seguridad B añada escaneos (coordinar dónde viven).

### Observación para SEG-B (recetas nuevas del Makefile) — CERRADA (ronda 13: era errónea)

(Abierta en ronda 12) Sus recetas `check_package_lifecycle`
(`Makefile:106-107` en SU rama) estaban sangradas con 8 espacios y
predije conflicto o guardia roja al converger.

**Cierre con corrección (ronda 13):** el pre-flight (guardia sobre
el Makefile fusionado simulado) demuestra que el Makefile fusionado
con su carril es IDÉNTICO al mío. Esas líneas son contenido del
merge-base (las introdujo `63fa077` en main y las heredaron ambos);
su lado no editó el Makefile desde la base de fusión, así que el
3-way toma mi versión reparada al completo. Su «sin acción
requerida» era correcto; mi error fue mirar su fichero sin distinguir
qué era suyo y qué del merge-base. Registrado como error de método,
no como defecto suyo.

### Observación para PUL-B (targets nuevos del Makefile) — CONFIRMADA (ronda 13, con líneas exactas)

Sus targets `console-a11y` y `console-lighthouse` (ronda 5, sin
fusionar) traen las recetas indentadas con 8 espacios — la corrupción
que `63fa077` introdujo en el resto del fichero. La guardia nueva
`check_makefile_tabs.py` (job engine de `ci.yml`) los denunciará en
cuanto su rama se fusione. Reindentar a tabuladores antes del merge;
`make -n console-a11y console-lighthouse` debe parsear. Si los
corrijo yo, lo registro aquí.

**Confirmación (ronda 13):** el pre-flight ejecuta la guardia sobre
el Makefile FUSIONADO simulado (`merge-tree --write-tree`) y sale
ROJA: fusión limpia (sin conflicto) con 7 líneas de receta con
espacios dentro del resultado (86-88 y 93-96: las recetas de esos
dos targets). Extra: esos dos targets instalan con npm SIN
`--ignore-scripts` (playwright+axe-core, lighthouse@12.8.2) — mismo
patrón de cadena de suministro que cerré en ci.yml (ronda 12);
recomendado añadirlo al reindentar.

### Observación para IMP-B (cuando cierre su ronda 2) — CERRADA

La fila «AI analyst» del feature inventory de `docs/ARCHITECTURE.md`
decía hoy «(no provider token streaming)». El plan de la ronda 2 de
IMP-B es precisamente añadir streaming nativo del proveedor. Cuando
IMP-B aterrice ese cambio, la fila quedará stale. IMP-B debe
actualizarla (es su área), o yo en una ronda posterior si lo veo
stale y nadie lo tocó. Lo dejo anotado aquí.

**Cierre (ronda 4, 12h23):** IMP-B aterrizó el streaming nativo
(commit `4257127`, ronda 2 de IMP-B a las 12h15) y NO tocó
`docs/ARCHITECTURE.md` (verificado con `git diff`). La fila quedó
stale y la corregí yo en la ronda 4. Observación cerrada.

### Observación para IMP-B (fusilador probable hacia main) — ABIERTA (ronda 13)

Su rama `b5e26d7` absorbió la de PUL-B y hereda las 7 recetas con
espacios de `console-a11y`/`console-lighthouse`. Cuando su rama
converja con la mía: fusión limpia pero guardia roja y `make` roto.
Remedio en SU rama (30 s): reindentar esas 7 líneas a TAB y —
opcional pero recomendado — `--ignore-scripts` en los dos
`npm install` de esos targets; verificación: `python3
scripts/dev-tests/check_makefile_tabs.py` en su árbol. Si aterriza
tal cual, yo lo reparo en la ronda siguiente y lo registro aquí.

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

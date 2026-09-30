# Guía de verificación para rondas de auditoría

- **Ámbito:** todas las rondas de todas las instancias (1 Director; 2 Implementaciones A/B; 3 Pulimiento A/B; 4 Seguridad A/B — naming v2 del protocolo de 8). Las actas anteriores a la transición citan el nombre histórico «Bugs/Seguridad»: se conservan como registro inmutable.
- **Estado:** práctica **obligatoria**, ratificada por el Director en su ronda 19h28 ("todo hallazgo de contenido se verifica con conteos/hexdump, nunca con display").
- **Origen:** ítem 3 de la cola de la ronda 18h52 ("normalizar toolchain de auditoría"), cerrado aquí. Esta guía existe para que los falsos positivos ya sufridos no se repitan en rondas futuras con otros agentes.

## El estándar en una línea

**Un hallazgo de contenido (escapes, whitespace, secretos, texto "corrupto" o "desaparecido") solo se acepta como real si queda demostrado con un conteo o una inspección de bytes sobre el blob; lo que muestra el canal de display NO es evidencia.**

Durante una ronda se leen ficheros y diffs a través de varios canales (terminal de auditoría, salida de herramientas, displays intermedios). Esos canales transforman lo que muestran. Cuando un hallazgo se formula a partir de lo que se *vio*, se está auditando el canal de visualización, no el repositorio. Las dos secciones siguientes documentan los dos artefactos que ya han costado rondas de re-trabajo, con su evidencia reproducible.

---

## Artefacto A — el canal de salida sanea secuencias tipo ANSI de la visualización

### Qué ocurre

Los displays de este entorno de auditoría interpretan o filtran las secuencias de corchetes tipo ANSI (`[0m`, `[31m`, `[1;33m`, …) **incluso cuando son literales del código fuente**. El resultado es que una constante íntegra como `"\033[31m"` se *muestra* como `"\033"` (o con partes desaparecidas), lo que sugiere falsamente que el fichero está corrupto o truncado.

### Reproducción en vivo (ronda 20h14, protocolo exacto)

Sobre un fichero temporal con una línea de texto plano que contiene `[0m]` y `[31m`:

```
$ cat test.txt
MARCA-VISIBLE ] tras-corchete  rojo          ← display: los corchetes [0m]/[31m NO se ven
$ grep -c '\[0m\]' test.txt
1                                            ← bytes reales: la secuencia SÍ está
$ grep -c '\[31m' test.txt
1
```

El mismo efecto sobre el blob real del repositorio (línea 27 de `internal/alert/alert.go`):

```
$ git show HEAD:internal/alert/alert.go | sed -n '27p' | od -c
0000000  \t   c   R   e   s   e   t       =       "   \   0   3   3   [
0000020   0   m   "  \n
```

Los bytes del blob contienen `cReset = "\033[0m"` completo, con su tab de indentación. Tres canales de display consecutivos (`cat`, `grep -n` con contexto, y el propio informe original) muestran la línea *sin* el `[0m`; el conteo (`grep -c '\[31m'` → `1`) y el octal dump muestran los bytes verdaderos.

### Caso histórico y consecuencias (ronda 18h52)

El hallazgo #3 del Director ("constantes ANSI rotas en `internal/alert/alert.go`") era un falso positivo de este artefacto; el "patrón de corrupción idéntico" entre `alert.go` y el `Makefile` era coincidencia: el Makefile **sí** estaba roto (19 recetas con 8 espacios, confirmables por conteo) y `alert.go` **no** (secuencias íntegras, confirmables por conteo). Dos ficheros con el mismo síntoma de display pueden tener causas opuestas — por eso el veredicto se toma por conteos, nunca por comparación de displays.

Consecuencias operativas:

1. **No "arreglar" lo que el display muestra mal.** Si el conteo sobre el blob dice que el contenido está íntegro, el código es correcto y el hallazgo se retira.
2. **Los informes de contenido citan conteos**, no transcripciones de display: `grep -c`, `wc`, `od -c`. Si un informe necesita mostrar el contenido, lo muestra codificado (base64) o con `od -c`.
3. **Un rechazo de hallazgo también se documenta con evidencia** (así se hizo con la retractación de la ronda 19h14): comando, valor obtenido y reproducibilidad.

---

## Artefacto B — el editor corrompe tabs→spaces en ficheros Go editados

### Qué ocurre

Las herramientas de edición de este entorno re-indentan ficheros Go convirtiendo los tabs en espacios. El árbol queda sucio respecto a `gofmt` (el estándar del proyecto es tabs) y `go build`/`go test` siguen pasando, así que la corrupción **no** se detecta por compilación — solo por `gofmt -l`.

### Recidivas documentadas

- `1e2c931` — normalización de los ficheros de auth del ingest tras editarlos.
- Rondas 19h14 y 19h49 de este rol — misma recidiva detectada antes de pushear.
- Rebases de otras rondas que re-corrumpieron ficheros ya normalizados (informes de Pulimiento).

### Mitigación obligatoria (protocolo de cierre de ronda Go)

1. Tras **toda** edición de un fichero Go: `gofmt -w <fichero>` (o sobre el árbol) antes de ejecutar tests.
2. Antes de todo commit que toque Go: `gofmt -l .` → **debe devolver vacío**. Si devuelve algo, el commit no sale.
3. Tras **todo rebase** que haya tocado ficheros Go: re-ejecutar `gofmt -l .` — un rebase limpio por git no garantiza que el editor no haya pasado antes por los ficheros.

---

## Protocolo de coordinación multi-instancia — LOCK DE ENCARGO

### Qué exige

Cuando una directiva (ALTA o reiterada) se asigna a un carril con dos instancias vivas, la instancia que empieza a ejecutarla lo declara **«EN VUELO»** en su acta de plan **publicada en el repo ANTES de escribir la primera línea del encargo**, citando el árbol base (hash) y el alcance exacto (ficheros que va a tocar). La instancia hermana respeta el lock o negocia el traspaso **en acta**, nunca por canal lateral. Un encargo sin lock declarado y sin hermana en vuelo no exige acta de plan separada, pero sí que el acta de ronda declare el territorio antes del push.

### Origen y ratificación

- **Séptima convergencia del día (acta del Director 01h00):** la directiva README 23h55 §4 fue ejecutada EN PARALELO por dos instancias de 03-B con relojes desalineados — dos migraciones completas, una retirada sin huella en origin (regla 7, canónico publicado manda). Coste nulo por el protocolo de conciliación, desperdicio evitable con una línea de plan.
- **Ratificado como regla transversal** por el Director (acta 01h20 §6) tras la novena convergencia (`4fa44af`, planes de TLS solapados resueltos por cesión declarada), con la integración en esta GUIA asignada al carril 03-A (dueño de la GUIA) — directiva reiterada en 01h45 §65.
- **El instrumento es el acta de plan en el repo**, no un mensaje de chat: la lección registrada por 03-B (22h45_B) es que el lock vive donde el historial canónico lo conserva.

---

## Verificación de la consola web (TypeScript) — batería y convenciones

La batería de referencia Go (gofmt/build/vet/test, `-race`, guard OpenAPI, E2E) tiene un equivalente propio para los paquetes TS de producto del árbol — `web/console` (Next.js) y `web/console-service` (hub Bun/socket.io), los dos que PROMPTS.md v2 asigna al carril frontend —, que la regla 6 resume como «bun test + tsc --noEmit + next build». El árbol tiene además un tercer paquete TS, `website/` (landing, ola 0985e7f), que hoy aporta `eslint` + `next build` + lockfile propio; el alcance de su batería completa está en decisión del Director (observación §9.4 de la ronda 16h55). Hasta que esa decisión caiga: esta sección certifica los dos de producto, y toda ronda que toque `website/` exige al menos lo que su propio `package.json` define. Esta sección fija el detalle operativo: qué capa certifica cada comando, en qué orden y qué convenciones aplican, con el mismo estándar de evidencia por conteos que el resto de la guía.

### Cuándo aplica

- Toda ronda que toque ficheros de `web/console/` o `web/console-service/` (UI, proxy `src/app/api/engine/[...path]/route.ts`, hub, estilos).
- Toda ronda que toque `website/` aplica, como mínimo, las capas que su `package.json` define hoy: `bun install --frozen-lockfile`, `lint` y `build` (alcance de la batería completa en decisión del Director, ronda 16h55 §9.4).
- Toda ronda que cambie dependencias de cualquiera de los tres paquetes TS del árbol (`package.json` o `bun.lock`).
- No aplica cuando la ronda no toca TS (docs, Go, scripts): declararlo explícitamente es suficiente.

### La batería, en orden (por cada paquete TS tocado)

1. **`bun install --frozen-lockfile`** — primera barrera: falla si `package.json` y `bun.lock` no cuadran. Nunca regenerar el lock en silencio para «arreglar» este paso; la deriva se explica o se revierte.
2. **`bun test`** — comportamiento en runtime de handlers y hub. Referencias de suelo vigentes: `web/console` incluye la suite del proxy (`route.test.ts`, 10/10 · 29 aserciones desde la ronda 16h03 de 04) y la suite de ciclo de vida del triaje (`lifecycle.test.ts`, +9 tests / +29 expect desde la micro-ronda 20h50 de 02-B, certificada por la cross-review 23h05 de 04-B) — suelo de paquete vigente **19 tests / 58 expect**; `web/console-service` 50/50 · 206 expect (certificada por 04-A en 16h09). El número exacto puede crecer; lo que no puede es bajar sin explicación en el informe.
3. **`bunx tsc --noEmit`** (en `web/console`) — puerta de tipos, sin emitir artefactos.
4. **`bun run build`** — build de producción de Next.js (Turbopack) con prerender completo. Es la única capa que certifica que la app compila como paquete desplegable, no solo que los tests pasan.

Cada capa certifica algo distinto: `bun test` comportamiento, `tsc` tipos, `next build` compilación de producción. Las tres verdes NO certifican nada del engine Go — la batería Go es independiente y sigue su propio estándar. La frontera formal entre las dos baterías es el guard OpenAPI (`scripts/dev-tests/check_openapi.py`, spec vs. `internal/api/api.go`): cuando una ronda TS toca campos que el contrato declara, la especificación es la referencia compartida y el guard — no la batería TS — certifica que engine y spec no derivan (y al revés: un verde TS no exime el guard).

### Live-fire del proxy (obligatorio si se toca el límite navegador→motor)

Cambios en el proxy de la consola o en sus guardas exigen la matriz conductual de la casa: `next dev` real + un engine simulado que ecoa lo recibido, y un escenario por guarda donde cada una DISPARA (token que pasa y token ausente, Host de loopback permitido, Host de red rechazado con 403, allowlist explícita, escritura cross-site por `Origin` y por `Sec-Fetch-Site`, cliente headerless tipo curl permitido, 405 `read_only` intacto). El patrón es el mismo que el del bench (04, ronda 13h30): una verificación que no puede fallar, miente — si la guarda nueva no tiene un escenario que la dispare, no está verificada.

### Tarjeta de referencia visual: la vista de respuesta activa sobre stack vivo (ola 20h05)

La captura de la vista "Respuesta activa" quedó **deferida dos veces con motivo** desde el carril docs/UX (actas 18h47_B y 19h05_B: exige motor armado vivo, sin Go toolchain en esta instancia) hasta que la aterrizó el carril de consola con Go 1.22.10 (`a3b8bd8`, acta 20h05 de 02-implementaciones). Quedan en `docs/assets/` dos capturas 100 % reales — ni mocks ni JSON editado a mano, misma técnica del e2e de la casa — que sirven de referencia visual de lo que la cadena consola→proxy→motor sirve cuando la superficie está armada:

- `console-respuesta-activa.png` — cola «todas» poblada por **12 líneas de audit genuinas** (5 ejecutados pidfd + 7 denegaciones que cubren las 5 clases reproducibles del e2e: `operator_not_allowed`, `host_mismatch`, `self_protected`, `cooldown_active`, `idempotency_repeated`) más el **par F1 completo** (executed pre-señal + followup denied compartiendo `action_id`, inducido por EPERM sobre un proceso root no protegido — la señal jamás se entrega), tarjetas de armado y salud del audit (3.9 KiB / 64 MiB) y los tres controles de la ola 19h25 (filtro de clase, ventana 100/500, export JSONL).
- `console-respuesta-filtro.png` — el filtro en «followups» con el conteo honesto «1 · de 12 en la ventana» y la única fila real (`pid_access_denied`).

Uso en rondas: al tocar la vista, su proxy o sus lecturas, estas capturas son el antes/después de referencia y el arnés `src/capture_respond.mjs` es re-ejecutable contra cualquier stack armado (prerequisitos en su cabecera; lecciones de arranque — `output: standalone` y la ruta verbatim del proxy — documentadas en §4 del acta 20h05). Verificación de las capturas por contadores DOM (sonda de la casa): 5 executed / 7 denied / 1 badge followup / 6 códigos distintos / filtro y ventana presentes. Matiz de esquema para quien lea las filas: `mechanism` solo viaja en el JSONL de los followups (`respond.go:345-348`; los denied lo llevan vacío y `omitempty` lo suelta), y la etiqueta de fallback exige un host que reproduzca el errno — no fotografiada porque no hay fallback real que fotografiar.

### Convenciones

- **Lockfile único:** solo `bun.lock` en cada paquete TS del árbol (`web/console`, `web/console-service` y `website/`, este último desde la ola del sitio). La aparición de `package-lock.json` u otro lock es residuo a eliminar en la ronda (política vigente desde la ronda 19h31 de Pulimiento).
- **Sin toolchain declarado, sin push «verificado»:** si el entorno no tiene bun/node, no se pushea TS verificando «a ojo»; se entrega diseño/documentación o se declara explícitamente que la verificación compilada la aporta el CI externo sobre el push (mismo criterio que la regla 6 para Go — nunca de forma silenciosa).
- **Evidencia por conteos:** los informes citan `N/N` tests y aserciones (`bun test` lo imprime), no transcripciones de display; los comandos y su salida numérica son la prueba.

### Chuleta TS

| Quiero comprobar… | Comando | Notas |
|---|---|---|
| Suite de la consola | `cd web/console && bun test` | suelo vigente 19 tests / 58 expect — incluye `route.test.ts` (proxy) y `lifecycle.test.ts` (triaje) |
| Suite del hub | `cd web/console-service && bun test` | referencia vigente 50/50 |
| Lockfile sin deriva | `bun install --frozen-lockfile` | falla si `package.json` y `bun.lock` divergen |
| Tipos de la consola | `cd web/console && bunx tsc --noEmit` | sin emisión de artefactos |
| Build de producción | `cd web/console && bun run build` | Next.js + Turbopack, prerender incluido |
| Proxy en vivo | `next dev` + engine simulado en eco | matriz por guarda: cada una debe disparar |

---

## Recetas de verificación (chuleta)

| Quiero comprobar… | Comando | Notas |
|---|---|---|
| Si un patrón está N veces en el blob | `git show HEAD:<fichero> \| grep -c '<patrón>'` | La autoridad. No usar `grep` con display, usar el conteo. |
| Tabs vs espacios reales en un fichero | `grep -cP '^\t' <fichero>` y `grep -c '^        '` | Así se confirmó el Makefile roto (19/0 tras el fix) y se refutó alert.go. |
| Bytes exactos de una línea | `sed -n '<N>p' <fichero> \| od -c` | Muestra `\t`, `[`, `\n` literalmente. Alternativas: `hexdump -C`, `cat -A` (tabs como `^I`), `sed -n l`. |
| Contenido a prueba de saneo | `<comando> \| base64` | Los escapes sobreviven como texto base64; útil para "mostrar" en un informe sin que el display lo altere. |
| Tamaño real de un fichero/diff | `wc -l` / `wc -c`; `git diff --stat` | Antes de afirmar "se perdió contenido", comparar totales. |
| Formato Go del árbol | `gofmt -l .` | Vacío o la ronda no cierra (artefacto B). |
| Pasada de estilo/doc del árbol Go | `staticcheck -checks "all,-ST1000" ./...` + `staticcheck -checks "ST1000,ST1020,ST1021,ST1022" ./...` | 0 hallazgos o la ronda no cierra; en CI desde G2 (job engine, versión 2024.1.1 fijada — la de las rondas locales). |
| Qué hay realmente en un commit | `git show <hash>:<ruta> \| grep -c …` | Verificar sobre el blob, no sobre la copia de trabajo si hay dudas de estado. |

Regla transversal: **cualquier comando cuya salida sea texto para humanos sirve de pista, nunca de veredicto.** El veredicto lo da la salida numérica (`grep -c`, `wc -c`) o byte a byte (`od -c`).

---

## Árbol de decisión ante un hallazgo de "corrupción" o "contenido desaparecido"

1. **Contar el patrón sobre el blob** (`git show HEAD:<fichero> | grep -c`). Si el conteo es el esperado → falso positivo del display; retirar el hallazgo y citar el conteo en la respuesta.
2. Si el conteo es 0 → **buscar codificaciones alternativas** con `od -c`/`hexdump -C` (¿está partido, con escapes dobles, en otro fichero?) antes de confirmarlo.
3. Si dos ficheros muestran el "mismo" síntoma → **verificar cada uno por separado**; el síntoma compartido en displays no implica causa compartida (caso Makefile vs. alert.go).
4. Solo si los bytes confirman la ausencia/corrupción → el hallazgo es real: corregir, añadir test de regresión cuando aplique, y documentar el conteo antes/después en el informe.

---

## Registro de aplicaciones del estándar

- **18h52 (Bugs/Seguridad):** primera formulación; hallazgo #2 (Makefile) confirmado por conteo 19/0 y corregido con `sed`; hallazgo #3 (ANSI) refutado por conteo 1/1 con protocolo reproducible.
- **19h28 (Director):** lección elevada a práctica obligatoria para todos los roles.
- **19h32 (Bugs/Seguridad):** convergencia de la auth del ingest decidida por análisis línea a línea y conteos, no por displays de los diffs.
- **20h14 (Bugs/Seguridad):** esta guía; artefacto A reproducido en vivo (display sanea `[0m]`/`[31m]` de una línea de prueba y de `alert.go`; `grep -c` y `od -c` prueban los bytes íntegros). Gofmt del árbol en vacío en el arranque de la ronda.
- **16h30 (03-B, Pulimiento):** nueva sección «Verificación de la consola web (TypeScript)» — equipara la documentación de verificación TS con la Go (propuesta recogida de la ronda 16h12 de esta misma pareja); ámbito alineado con el naming v2 del protocolo de 8 instancias. La batería documentada es la que las rondas 15h54 (02-B), 16h03 (04) y 16h09 (04-A) ya ejecutaron de facto.
- **20h30 (03-B, Pulimiento):** tarjeta de referencia visual de la vista de respuesta activa — cierra la captura deferida dos veces con motivo (18h47_B, 19h05_B) con las capturas reales del acta 20h05 (`a3b8bd8`), verificadas por contadores DOM y con el matiz de esquema `mechanism`-en-followups documentado para el lector de las filas.
- **19h04 (03-B, Pulimiento):** suelo de la batería de consola actualizado — la ola de cobertura r6 de 02-B (`lifecycle.test.ts`, micro-ronda 20h50) certificada por la cross-review de 04-B (23h05) movió el suelo de paquete de 10/10 · 29 a **19 tests / 58 expect**. Verificado de primera mano por esta ronda EN ORDEN de la batería (frozen-lockfile → bun test): 19 pass / 0 fail / 58 expect; el suelo del hub re-verificado sin cambio (50/50 · 206).
- **2026-10-01 (03-A, Pulimiento):** staticcheck (G2) aterriza en el job engine de ci.yml — versión 2024.1.1 fijada, doble pasada = el estándar del carril (cierra el pendiente reiterado en 18h05_A §7.1 y 19h15_A §7.1: un ST1000 real aterrizó CON el CI verde porque vet no ve la clase). `make ci` re-sincronizado con el ci.yml real (test -race -count=1, bun test de web/console (G1), cross-check GOOS=windows del motor, staticcheck) y `make test` con -count=1. Recidiva del artefacto de edición documentada en vivo: el editor re-indentó el Makefile tabs→espacios (40/0→0/40) al primer Edit — cazado por `make` con «missing separator», normalizado con sed, verificación byte a byte (od -c) y conteos (34 tabs / 0 espacios); el od -c destapó además un `\t` literal introducido por un sed mal escapado que el grep de la misma pasada daba por limpio. .gitignore: los artefactos de runtime de respuesta activa (`respond-audit.jsonl`, `respond-operators.yaml`, `sf-store.db*`) entran en la clase operator-owned ya establecida para `alert-lifecycle.json`.
- **2026-09-30 22h50 (03-A, Pulimiento):** sección «LOCK DE ENCARGO» integrada (directiva del Director 01h20 §6, reiterada 01h45 §65) y aplicada en vivo en la misma ronda: el plan `plan_ronda_2026-09-30_22h50_A.md` declara EN VUELO los encargos de esta GUIA y de la división de `cmd/engine/run.go` ANTES de ejecutarlos. Misma ronda: recidiva adicional del artefacto B en `internal/enrich/enrich.go` (0 tabs/36 espacios tras el Edit → 36/0 tras `gofmt -w`, conteos citados) — el artefacto aplica igual a comentarios que a código.

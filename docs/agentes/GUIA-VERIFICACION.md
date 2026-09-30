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

## Verificación de la consola web (TypeScript) — batería y convenciones

La batería de referencia Go (gofmt/build/vet/test, `-race`, guard OpenAPI, E2E) tiene un equivalente propio para los dos paquetes TS del árbol — `web/console` (Next.js) y `web/console-service` (hub Bun/socket.io) —, que PROMPTS.md v2 (regla 6) resume como «bun test + tsc --noEmit + next build». Esta sección fija el detalle operativo: qué capa certifica cada comando, en qué orden y qué convenciones aplican, con el mismo estándar de evidencia por conteos que el resto de la guía.

### Cuándo aplica

- Toda ronda que toque ficheros de `web/console/` o `web/console-service/` (UI, proxy `src/app/api/engine/[...path]/route.ts`, hub, estilos).
- Toda ronda que cambie dependencias de cualquiera de los dos paquetes (`package.json` o `bun.lock`).
- No aplica cuando la ronda no toca TS (docs, Go, scripts): declararlo explícitamente es suficiente.

### La batería, en orden (por cada paquete TS tocado)

1. **`bun install --frozen-lockfile`** — primera barrera: falla si `package.json` y `bun.lock` no cuadran. Nunca regenerar el lock en silencio para «arreglar» este paso; la deriva se explica o se revierte.
2. **`bun test`** — comportamiento en runtime de handlers y hub. Referencias de suelo vigentes: `web/console` incluye la suite del proxy (`route.test.ts`, 10/10 · 29 aserciones desde la ronda 16h03 de 04) y `web/console-service` 50/50 · 206 expect (certificada por 04-A en 16h09). El número exacto puede crecer; lo que no puede es bajar sin explicación en el informe.
3. **`bunx tsc --noEmit`** (en `web/console`) — puerta de tipos, sin emitir artefactos.
4. **`bun run build`** — build de producción de Next.js (Turbopack) con prerender completo. Es la única capa que certifica que la app compila como paquete desplegable, no solo que los tests pasan.

Cada capa certifica algo distinto: `bun test` comportamiento, `tsc` tipos, `next build` compilación de producción. Las tres verdes NO certifican nada del engine Go — la batería Go es independiente y sigue su propio estándar. La frontera formal entre las dos baterías es el guard OpenAPI (`scripts/dev-tests/check_openapi.py`, spec vs. `internal/api/api.go`): cuando una ronda TS toca campos que el contrato declara, la especificación es la referencia compartida y el guard — no la batería TS — certifica que engine y spec no derivan (y al revés: un verde TS no exime el guard).

### Live-fire del proxy (obligatorio si se toca el límite navegador→motor)

Cambios en el proxy de la consola o en sus guardas exigen la matriz conductual de la casa: `next dev` real + un engine simulado que ecoa lo recibido, y un escenario por guarda donde cada una DISPARA (token que pasa y token ausente, Host de loopback permitido, Host de red rechazado con 403, allowlist explícita, escritura cross-site por `Origin` y por `Sec-Fetch-Site`, cliente headerless tipo curl permitido, 405 `read_only` intacto). El patrón es el mismo que el del bench (04, ronda 13h30): una verificación que no puede fallar, miente — si la guarda nueva no tiene un escenario que la dispare, no está verificada.

### Convenciones

- **Lockfile único:** solo `bun.lock` en cada paquete TS del árbol (`web/console`, `web/console-service` y `website/`, este último desde la ola del sitio). La aparición de `package-lock.json` u otro lock es residuo a eliminar en la ronda (política vigente desde la ronda 19h31 de Pulimiento).
- **Sin toolchain declarado, sin push «verificado»:** si el entorno no tiene bun/node, no se pushea TS verificando «a ojo»; se entrega diseño/documentación o se declara explícitamente que la verificación compilada la aporta el CI externo sobre el push (mismo criterio que la regla 6 para Go — nunca de forma silenciosa).
- **Evidencia por conteos:** los informes citan `N/N` tests y aserciones (`bun test` lo imprime), no transcripciones de display; los comandos y su salida numérica son la prueba.

### Chuleta TS

| Quiero comprobar… | Comando | Notas |
|---|---|---|
| Suite de la consola | `cd web/console && bun test` | incluye `route.test.ts` (proxy) |
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

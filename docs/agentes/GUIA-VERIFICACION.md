# Guía de verificación para rondas de auditoría

- **Ámbito:** todas las rondas de todos los roles (Director, Implementaciones, Pulimiento, Bugs/Seguridad).
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

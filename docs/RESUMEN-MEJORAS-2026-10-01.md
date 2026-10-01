# Registro de mejoras: CLI, dashboard e investigación de alertas

Fecha: **1 de octubre de 2026**. Este documento reúne las dos rondas de
trabajo realizadas para mejorar la operación del proyecto, los errores
corregidos, la documentación y la verificación de la entrega.

La entrega se integra mediante el
[PR #4](https://github.com/Ruby570bocadito/security-framework/pull/4), desde
la rama de integración hacia `main`. Los informes de cada ronda se
conservan como evidencia del estado y las limitaciones que existían entonces.

## 1. Resultado de la entrega

- Una CLI interactiva con listas de alertas y reglas, búsqueda, filtros,
  selección estable, detalles, pausa y ayuda contextual.
- Un dashboard que prioriza el triaje y los problemas del pipeline,
  permite actualizar datos y distingue API disponible de canal en vivo.
- Una cola de alertas con modo en vivo e histórico paginado, filtros de
  ciclo de vida y decisiones de triaje sobre registros antiguos.
- Reconexión REST/SSE más fiable, con cancelación de peticiones,
  deduplicación y protección de las decisiones recientes del operador.
- README reorganizado, guía de inicio en español, contrato OpenAPI
  actualizado e instrucciones para reproducir las comprobaciones.

Las mejoras de interfaz reutilizan las dependencias de ejecución existentes.
`x/ansi`, ya presente en el grafo de Go, se declara como dependencia directa.
Las herramientas opcionales de pruebas DOM quedan separadas de la aplicación.

## 2. CLI interactiva

El punto de entrada es `engine run -i`. La interfaz incorpora:

| Función | Comportamiento |
|---------|----------------|
| Vistas | Alertas y catálogo de reglas, con cambio mediante `1`, `2` o `Tab` |
| Navegación | Flechas o `j/k`, páginas, primera/última fila y detalle con `Enter` |
| Búsqueda | Regla, host, usuario, resumen y etiquetas; entrada contextual con `/` |
| Severidad | Filtro cíclico con `s` |
| Pausa | `p` o espacio congela la vista; ingestión, detección, API y entregas continúan |
| Ayuda | `?` o `h`, con indicaciones adaptadas a la vista |
| Selección | Conserva la identidad de la alerta o regla al recibir datos o recargar |
| Pantallas pequeñas | Selección y scroll acotados al contenido y al tamaño del terminal |

El terminal conserva **100 alertas**. La lista de reglas sigue las recargas
del motor. El detalle se cierra si su entrada deja de estar disponible.
Los caracteres de control, escapes y controles bidireccionales se neutralizan
en la salida humana, conservando el JSON original como evidencia. El banner
de webhook oculta credenciales usando la función de redacción existente.

Los comandos `run`, `rules`, `validate` y `sigma` rechazan argumentos
posicionales inesperados. Ayuda, versión, reglas, validación y Sigma respetan
los writers de Cobra, facilitando su captura e integración con otras herramientas.

Código principal: [`interactive.go`](../cmd/engine/interactive.go),
[`cli.go`](../cmd/engine/cli.go), [`render.go`](../cmd/engine/render.go),
[`sigma.go`](../cmd/engine/sigma.go) y
[`terminal.go`](../internal/redact/terminal.go).

## 3. Dashboard y conexión con el motor

El panel incorpora un resumen operativo con alertas críticas pendientes,
incidencias de entrega, saturación de detectores y accesos a las superficies
de investigación. La actualización manual permite recuperar datos sin
recargar toda la aplicación.

Los indicadores sin lectura muestran `—`; una conexión fallida no se
presenta como cero alertas o cero errores. El estado de la API y el del canal
SSE se muestran por separado. Al confirmar una caída se limpian las
superficies de telemetría, alertas y reglas para evitar presentar datos
antiguos como actuales.

El gráfico utiliza una ventana móvil de cuatro minutos y un reloj de cinco
segundos: la actividad expira aunque el sensor deje de emitir. Una muestra
vacía tiene un pico real de cero. El gráfico y el resumen de triaje son
muestras del búfer; los totales acumulados proceden del motor.

La sincronización REST/SSE se ha revisado para:

- Ejecutar el polling de forma serial, con plazos de petición y limpieza
  al desmontar, evitando intervalos y lecturas solapados.
- Combinar el snapshot REST con frames que llegan mientras se consulta.
- Deduplicar replays sin inflar los contadores y preservar el triaje REST
  durante la sincronización.
- Actualizar también el catálogo de reglas después de un hot reload.
- Diferenciar un `404` de una superficie opcional de un error transitorio:
  el primero elimina el estado antiguo y el segundo conserva la última lectura.

La navegación restaura la vista desde la URL y el historial del navegador.
Se añade un enlace de salto al contenido para teclado, los chips del
encabezado se ajustan a la fila y se reconoce la fuente ETW real.

Código principal: [`operations-overview.tsx`](../web/console/src/components/console/operations-overview.tsx),
[`dashboard.tsx`](../web/console/src/components/console/dashboard.tsx),
[`kpi-row.tsx`](../web/console/src/components/console/kpi-row.tsx),
[`activity-chart.tsx`](../web/console/src/components/console/activity-chart.tsx),
[`shell.tsx`](../web/console/src/components/console/shell.tsx) y
[`use-engine-stream.ts`](../web/console/src/hooks/use-engine-stream.ts).

## 4. Investigación histórica y triaje

La vista **Alertas** permite alternar entre **En vivo** e **Histórico**.
El histórico consulta el motor, con páginas de **25 alertas**, Anterior,
Siguiente y actualización explícita. La fuente es SQLite si se activa
`-store`; de lo contrario se indica la ventana de **256 alertas en memoria**.

Se añaden filtros de todas, sin cerrar, nuevas, reconocidas y cerradas,
combinados con severidad y texto. El modo y los filtros se conservan en la
URL. La pila de páginas vive en la vista y comienza de nuevo al recargar o
cambiar la consulta.

El nuevo endpoint de lectura es `GET /api/alerts/search`, sujeto a la
autenticación existente. Devuelve:

| Campo | Significado |
|-------|-------------|
| `items` | Alertas y estado de ciclo de vida de la página |
| `source` | `sqlite` o `memory` |
| `has_more` | Existe una posición de continuación |
| `next_cursor` | Cursor para continuar |
| `page_cursor` | Posición fijada de la página actual, también para volver atrás |
| `scanned` | Candidatos de evidencia examinados por la aplicación |
| `scan_limited` | La búsqueda debe continuar por haber alcanzado el límite de candidatos |

El contrato admite `limit` entre 1 y 100, por defecto 25; filtros de estado,
severidad, regla, host, texto y tiempo. La paginación usa la secuencia de
inserción, fijando el límite superior de la primera consulta. Alertas con
timestamps iguales o llegadas tardías no desplazan las páginas visitadas.

Los cursores quedan asociados a la consulta, la fuente y la ejecución del
motor. Los límites temporales relativos se resuelven en la primera página.
Un cursor incompatible o caducado responde `400` y requiere reiniciar la
búsqueda. Son posiciones de lectura, no credenciales.

Cada petición examina hasta **5000 candidatos de evidencia** y dispone de
**cuatro segundos**, con cancelación propagada a SQLite y respuesta `504`
si vence el presupuesto. Una página vacía puede tener continuación y mostrar
**Seguir buscando**. `scanned` no mide todas las filas que el índice SQL
pueda examinar internamente.

El triaje histórico usa tanto el acuse válido del POST como SSE. Las
actualizaciones se almacenan por identidad y se comparan por `status_at`,
evitando que frames antiguos reviertan un cierre o una reapertura recientes.
Las consultas sustituidas se cancelan y sus respuestas tardías se descartan.

Código principal: [`alert_search.go`](../internal/api/alert_search.go),
[`alert_page.go`](../internal/store/alert_page.go),
[`alerts-view.tsx`](../web/console/src/components/console/alerts-view.tsx),
[`use-alert-history.ts`](../web/console/src/hooks/use-alert-history.ts),
[`engine-client.ts`](../web/console/src/lib/engine-client.ts) y
[`alert-search.ts`](../web/console/src/lib/alert-search.ts).
Contrato: [`openapi.yaml`](api/openapi.yaml).

## 5. Registro de errores corregidos

| Área | Problema observado | Corrección |
|------|--------------------|------------|
| CLI | El scroll podía dejar una lista vacía fuera de sus límites | Acotar viewport y selección |
| CLI | Llegadas y reloads cambiaban el elemento bajo el detalle | Selección por identidad y cierre al eliminarlo |
| CLI | La telemetría podía alterar la presentación del terminal | Neutralización solo en salida humana |
| CLI | El banner podía mostrar secretos del webhook | Redacción del endpoint |
| CLI | Argumentos ignorados y salida ajena al writer del comando | Validación de posicionales y writers de Cobra |
| Navegación | Los enlaces profundos y volver/avanzar perdían la vista | Lectura correcta del estado de URL |
| Actividad | Datos antiguos no expiraban y una muestra vacía tenía pico uno | Reloj de expiración y máximo real separado de la escala |
| KPIs | Un fallo podía parecer un recuento cero | Estado explícito de lectura no disponible |
| Conexión | El polling podía solaparse o quedar pendiente | Polling serial, plazos y cancelación |
| Conexión | Un snapshot descartaba frames concurrentes | Combinación del snapshot con llegadas durante la lectura |
| Conexión | Replays duplicaban alertas, contadores o perdían triaje | Deduplicación y totales del motor |
| Conexión | Reglas y superficies opcionales retenían estado obsoleto | Refresco del catálogo y tratamiento específico de `404` |
| Alertas | La investigación solo veía el búfer del navegador | Histórico paginado en el motor |
| Alertas | La severidad `info` se convertía en `low` | Tipo, badge, filtros y KPI conservan `info` |
| Alertas | Offline dejaba un skeleton permanente | Mensaje de datos no disponibles |
| Alertas | Identidades antiguas podían colisionar en re-alertas | Clave compartida con timestamp, evento y regla |
| Triaje | El POST esperaba SSE y varias decisiones se perdían en un render | Aplicación del acuse y búfer por identidad |
| Triaje | Un estado tardío podía revertir una decisión más reciente | Comparación de `status_at` |
| Exports | Los controles sugerían una exportación completa y filtrada | Tooltips con límites y alcance reales |
| Proxy | El parser de Host rechazaba IPv6 loopback | Parseo de autoridad completa y rechazo de delimitadores inválidos |
| Proxy | Se leía el cuerpo de triaje sin el límite equivalente del motor | Límite de 8 KiB antes de reenviar, `413` y propagación de abort |
| Build | Los targets del sensor buscaban Cargo.toml en la raíz | `--manifest-path sensor/Cargo.toml` en el Makefile |

Los listados y exports anteriores conservan su contrato. El nuevo endpoint
añade lectura; las decisiones siguen usando el endpoint de triaje existente.

## 6. Documentación y herramientas actualizadas

| Archivo | Trabajo realizado |
|---------|-------------------|
| [`README.md`](../README.md) | Arranque, teclas, consola, arquitectura, desarrollo, documentación y roadmap reorganizados |
| [`GUIA-INICIO.md`](GUIA-INICIO.md) | Guía en español con CLI, dashboard, histórico y problemas habituales |
| [`OPERATIONS.md`](OPERATIONS.md) | Referencia de controles y comportamiento operativo de la CLI |
| [`web/console/README.md`](../web/console/README.md) | Arranque, configuración, autenticación y papel opcional del hub IA |
| [`web/console/.env.example`](../web/console/.env.example) | Plantilla de configuración y distinción entre variables de servidor y navegador |
| [`CHANGELOG.md`](../CHANGELOG.md) | Cambios añadidos y errores corregidos en Unreleased |
| [`api/openapi.yaml`](api/openapi.yaml) | Contrato del histórico y respuestas paginadas |
| [`REVISION-CLI-DASHBOARD.md`](REVISION-CLI-DASHBOARD.md) | Hallazgos y verificación de la primera ronda |
| [`REVISION-HISTORICO.md`](REVISION-HISTORICO.md) | Segunda ronda, cursores, límites y pruebas |
| [`scripts/dev-tests/README.md`](../scripts/dev-tests/README.md) | Ejecución y alcance del comprobador DOM opcional |

También se incorporan scripts `typecheck` en los dos paquetes web y un
harness versionado que monta provider, dashboard y cola reales con fixtures
REST/SSE aisladas en React StrictMode. Las capturas antiguas se identifican
como referencia anterior a estas mejoras.

## 7. Pruebas y evidencia

### Comprobaciones locales de las dos rondas

| Comprobación | Resultado registrado |
|--------------|----------------------|
| Go build, vet y compilación cruzada Windows | Correctos; repetidos sobre la rama integrada |
| Tests seleccionados de CLI, API, redacción y store con `-race` | Correctos; regresiones nuevas y existentes |
| Batería completa de `internal/store` con `-race` | Correcta |
| `engine validate` | 23 reglas, cuatro secuencias, cero avisos |
| TypeScript de consola y hub | Correcto |
| Consola mediante adaptador temporal Node | 79/79 en la primera ronda y 84/84 en la segunda; ejecución adicional a Bun |
| Harness DOM | 11/11 y después 18/18 flujos con componentes reales y StrictMode |
| Smoke nativo motor + devsensor + SQLite + API | 19 eventos, 18 alertas, dos páginas sin duplicados y un resultado cerrado por POST |
| Guard OpenAPI y autopruebas | 16 rutas, 36 campos Stats, 82 referencias y 13 variantes negativas en la segunda ronda |
| Formato y diff | Go formateado y sin errores de whitespace |

Las regresiones cubren cancelación SQLite, timestamps empatados, nuevas
inserciones durante paginación, retroceso a página fijada, filtros antes del
límite, autenticación, cursores incompatibles, ventanas relativas y el límite
de 5000 candidatos. En DOM se cubren reconexión, replay, snapshot concurrente,
reload, inactividad, caída/recuperación, URL, histórico, decisiones agrupadas,
triaje sin SSE, motores antiguos y limpieza de recursos.

### CI remota confirmada

La [ejecución 36864056456](https://github.com/Ruby570bocadito/security-framework/actions/runs/36864056456)
del PR terminó con **los cuatro jobs correctos** sobre
`4b153afa904baa4ac0a38ff533d3519427630539`, antes de añadir este resumen:

| Job | Alcance comprobado | Resultado |
|-----|--------------------|-----------|
| [Go engine](https://github.com/Ruby570bocadito/security-framework/actions/runs/36864056456/job/110375049258) | gofmt, build, vet, staticcheck, batería completa con `-race`, cross-check Windows y guard OpenAPI | `success` |
| [Console](https://github.com/Ruby570bocadito/security-framework/actions/runs/36864056456/job/110375048954) | Instalación congelada, tests nativos Bun, TypeScript de hub/consola y build de producción Next.js | `success` |
| [Sensor](https://github.com/Ruby570bocadito/security-framework/actions/runs/36864056456/job/110375049376) | Cargo con lockfile y comprobaciones de compilación para host y Windows | `success` |
| [Windows](https://github.com/Ruby570bocadito/security-framework/actions/runs/36864056456/job/110375049293) | Motor nativo y smoke conductual del camino handle de respuesta activa | `success` |

Esto resuelve la verificación pendiente de Bun, Next.js, la batería completa
de Go y las superficies de CI que los informes originales no podían ejecutar
en el entorno local. Aquellos informes conservan sus resultados históricos:
la restricción local `ENOENT: uv_resident_set_memory` no fue un fallo del
build de producción ejecutado en GitHub. El comprobador DOM adicional no
forma parte automáticamente de esos cuatro jobs.

## 8. Procedencia e integración

1. Primera ronda sobre `8c3b1d7`, entregada originalmente como `68b8bc2`.
2. Segunda ronda sobre la primera, entregada originalmente como `5bdd52f`.
3. Ambas se reaplicaron sobre `main` en `c0aec2d`, conservando el soporte
   TLS del sensor y la separación previa del motor en flags/run/runtime.
4. Commits de código integrados: `d1bba5e` y `db81f93`.
   `4b153af` documenta la integración y es el árbol con CI confirmada arriba.
5. La publicación se realizó desde la rama de integración mediante el
   PR #4; este resumen se añade a la misma entrega antes de fusionarla.

## 9. Límites y siguientes mejoras

- El histórico depende de la retención de SQLite o del anillo de memoria.
  Las páginas fijan inserciones, pero la retención y el triaje pueden cambiar
  la pertenencia de una fila; no son una transacción inmutable.
- El ciclo de vida conserva su almacenamiento existente y límite de 10.000
  entradas. Moverlo a SQLite queda como trabajo posterior.
- El texto del histórico busca evidencia de detección. Las notas de triaje
  siguen perteneciendo a la búsqueda de la vista en vivo.
- Los exports conservan los límites por defecto de 256 alertas o 1000
  eventos y no aplican los filtros de la pantalla.
- El DOM verifica comportamiento, pero no layout, fuentes ni capturas en
  un navegador real. Quedan las pruebas de escritorio/móvil y las capturas
  actuales de la CLI y el dashboard.
- Cargo check del sensor no certifica una sesión ETW real ni un ejecutable
  Windows enlazado. El smoke Windows certificado corresponde al motor.

Prioridades siguientes: pruebas reales de navegador en CI, paleta de
comandos accesible, investigaciones guardadas, persistencia del ciclo de
vida en SQLite, estado completo de detectores en la TUI y ampliación de
proveedores ETW. Esta entrega mejora flujos concretos y su cobertura de
regresión; no constituye una auditoría exhaustiva de seguridad de producción.

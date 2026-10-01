# Investigación desde la CLI y el dashboard

Ronda del 1 de octubre de 2026 sobre `main` después de la PR #6.

## Búsqueda en el terminal

`engine run -i` mantiene las dos vistas, filtros de severidad, pausa de
presentación, selección histórica y actualización de reglas existentes.
Con `/`, la búsqueda incluye ahora el **ID de alerta**, **ID de evento** y
**tipo de evento**, además de regla, host, usuario, resumen, mensaje y tags.

Los términos separados por espacios se combinan con **AND**, sin distinguir
mayúsculas. Pueden aparecer en campos distintos y en cualquier orden:

| Consulta | Resultado esperado |
|----------|--------------------|
| `LAB-A powershell` | Filas con ambos términos entre sus campos |
| `registry.set evt-99` | Coincidencias de tipo e identidad de evento |
| `alert-42` | Alerta por ID, mientras permanezca en las últimas 100 |
| Solo espacios | Toda la lista que permita el filtro de severidad |

La misma combinación de términos se aplica al catálogo de reglas. No se
interpretan expresiones regulares ni comandos. La entrada sigue limitada
a 120 caracteres; los controles y escapes se neutralizan solo en la
presentación, sin modificar la evidencia del motor.

## Accesos de triaje en el dashboard

El resumen de operación ofrece cuatro accesos por teclado o puntero:
las etiquetas accesibles de los contadores incluyen su cifra, o «sin datos».

| Control | Severidad | Estado | Origen |
|---------|-----------|--------|--------|
| **Ver críticas sin cerrar** | Critical | Abiertas: nuevas o reconocidas | Ventana en vivo |
| Contador **nuevas** | Todas | New | Ventana en vivo |
| Contador **reconocidas** | Todas | Acknowledged | Ventana en vivo |
| Contador **cerradas** | Todas | Closed | Ventana en vivo |

El origen coincide con la ventana de alertas del contador, no con el total
acumulado del motor ni con todo el histórico SQLite. La ventana puede
cambiar si llegan nuevas alertas o decisiones de triaje.

Cada acceso crea una entrada de navegación, enfoca el contenido principal
y prepara una lente nueva: borra la búsqueda de alertas, selección previa
e histórico, y aplica el estado/severidad elegidos. Así una búsqueda antigua
no oculta los registros que motivaron el clic. Conserva las lentes de
telemetría, reglas y auditoría y los parámetros desconocidos. **Atrás**
restaura la investigación anterior. No se modifica ninguna alerta al navegar.

Sin conexión a la API, los contadores muestran `—` y estos cuatro controles
quedan deshabilitados. Los accesos generales a la cola y la telemetría siguen
disponibles para inspeccionar el estado de conexión.

## Código y regresiones

| Archivo | Cambio |
|---------|--------|
| [`interactive.go`](../cmd/engine/interactive.go) | Términos AND, campos de identidad y ayuda contextual |
| [`interactive_test.go`](../cmd/engine/interactive_test.go) | IDs, términos entre campos, espacios y cruce con severidad |
| [`operations.ts`](../web/console/src/lib/operations.ts) | Destinos de triaje mediante los escritores de URL existentes |
| [`operations-overview.tsx`](../web/console/src/components/console/operations-overview.tsx) | Contadores interactivos y acceso a críticas abiertas |
| [`dashboard.tsx`](../web/console/src/components/console/dashboard.tsx) y [`shell.tsx`](../web/console/src/components/console/shell.tsx) | Navegación, historial y foco principal |
| [`operations.test.ts`](../web/console/src/lib/operations.test.ts) | Seis regresiones de destino, limpieza y preservación de lentes |
| [`console_dom_fixture.tsx`](../scripts/dev-tests/console_dom_fixture.tsx) | Acciones del resumen y deshabilitación al perder la API |
| [`check_console_browser.mjs`](../scripts/dev-tests/check_console_browser.mjs) | Cuatro accesos reales, filtros antiguos y vuelta con Atrás |

Verificación local: pruebas de Go del paquete CLI con detector de carreras,
TypeScript, **114 pruebas de consola** mediante el adaptador temporal Node
y **19 flujos DOM**. El runner de Chromium suma **11 comprobaciones** y
captura también el dashboard. Sus respuestas REST/SSE son datos de prueba
aislados; no escribe sobre un motor real. La CI comprueba además el build de
producción y los jobs del motor, Windows y sensor sobre el commit publicado.

Para reproducir: `go test -race -count=1 ./cmd/engine`, `bun test` y
`bunx tsc --noEmit` en `web/console`, y `make console-dom`. Tras compilar la
consola, `make console-browser`. Véase la
[guía de regresiones](../scripts/dev-tests/README.md#chromium-console-regression).

El entorno local no puede arrancar el bundle Next/Chromium; su ejecución
de producción se verifica en CI. No se añaden dependencias ni endpoints.

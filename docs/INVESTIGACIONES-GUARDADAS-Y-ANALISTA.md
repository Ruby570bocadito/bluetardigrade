# Investigaciones guardadas, exportación y analista

Cambios de 2026-10-01. Esta entrega añade búsquedas reutilizables a la
consola, corrige columnas de CSV sin proteger y hace que el progreso del
analista describa el trabajo que realmente ejecuta.

## Guardar y recuperar una investigación

En **Alertas** o **Flujo en vivo**, ajusta los filtros, abre **Búsquedas
guardadas**, escribe un nombre y pulsa **Guardar filtros actuales**.
Se guarda el texto que acabas de escribir aunque todavía no haya llegado
a la URL. En Alertas incluye severidad, estado y ámbito (en vivo/histórico);
en Flujo incluye tipo de evento. Ambas vistas incluyen la búsqueda de texto.

- **Aplicar** recupera los filtros y añade una entrada al historial del
  navegador. Atrás restaura los anteriores. En Alertas también limpia la
  selección de alerta para evitar que quede un detalle de otra consulta.
- Guardar con el mismo nombre en la misma vista actualiza la búsqueda
  existente. La comparación normaliza Unicode y no distingue mayúsculas.
- **Eliminar** borra únicamente esa búsqueda. Las otras pestañas del mismo
  origen reciben los cambios mediante el evento `storage` del navegador.

El límite conjunto es **20 búsquedas** entre las dos vistas; los nombres
tienen hasta **60 caracteres** y el texto de búsqueda hasta **120**. En
Flujo, el límite se aplica al escribir, por lo que el filtro no cambia al
recargar la URL. El tipo de evento mantiene su límite de 60 caracteres.

Las búsquedas viven en `localStorage`, clave
`bluetardigrade.saved-searches.v1`. Son locales a ese navegador y origen:
no se sincronizan con el motor ni con una cuenta. No guardan eventos,
bundles, URLs completas, identidad de la alerta seleccionada ni configuración
de conexión. **Sí guardan el texto que introduces en la búsqueda**; evita
poner credenciales en él. Borrar los datos del sitio elimina estas búsquedas.
No son una copia de la ventana pausada ni congelan el histórico; al aplicarlas
se consulta la información disponible. El estado de pausa no se guarda.

El lector valida versión, tipos, límites, nombres, identificadores y
duplicados, con un máximo de lectura de 65.536 caracteres. Solo reconstruye
los campos de filtro admitidos. Los nombres se renderizan como texto React.
Si el almacenamiento está bloqueado, lleno o corrupto, aparece un error y
los filtros siguen funcionando. Una lectura inválida no se sobrescribe al
intentar guardar. Las escrituras incluyen los cambios ya recibidos de otras
pestañas; `localStorage` no ofrece una transacción entre pestañas, por lo que
dos escrituras simultáneas todavía pueden competir.

## CSV: protección en todas las columnas de texto

Antes, campos como ID, origen, tipo, regla, etiquetas, destino de red o clave
de registro podían exportarse sin pasar por `csvSafe`. El motor acepta esos
campos desde el ingest: eran una vía para colocar una fórmula en un CSV.

Ahora **todas las columnas de texto** de eventos y alertas pasan por el
mismo tratamiento, incluyendo listas después de unirlas. Se antepone un
apóstrofo si el primer prefijo relevante es `=`, `+`, `-`, `@`, sus variantes
de ancho completo, tabulación, CR o LF. También se detectan detrás de espacios
iniciales. Los campos numéricos PID y puerto conservan su representación.
El escritor CSV sigue encargándose de comillas y separadores.

Esto es una mitigación de presentación, no una garantía universal para
todas las hojas de cálculo y sus ciclos de abrir/guardar. Para conservar
la evidencia exacta, usa **JSONL**. La transformación CSV no cambia el
evento guardado ni su exportación JSONL. Las pruebas verifican los bytes y
el CSV parseado; no ejecutan Excel ni LibreOffice. Referencia:
[OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).

## Analista: progreso real y evidencia acotada

El hub realiza una petición HTTP al proveedor compatible con OpenAI que
configures mediante `ANALYST_BASE_URL`, `ANALYST_API_KEY` y `ANALYST_MODEL`.
No sustituye una respuesta fallida por un análisis inventado.

Se eliminaron las esperas cosméticas de 450/500 ms y la reproducción
artificial de palabras cada 24 ms. Los pasos actuales corresponden a
preparar el prompt, consultar notas ATT&CK locales y esperar al proveedor.
Las notas son un pequeño diccionario de contexto, no un segundo motor de
correlación. El texto se muestra completo cuando llega la respuesta: el
contrato socket conserva `analyst:delta`, pero **no hay streaming de tokens
del proveedor**. Un error del proveedor no completa ese paso ni produce texto.
Sin configuración, no se inicia ninguna petición ni secuencia de progreso.

Toda la alerta, evento y regla se serializan dentro de bloques delimitados,
con estos límites antes del indicador de truncado:

| Entrada | Límite de caracteres |
|---------|----------------------|
| Alerta JSON | 4.096 |
| Evento JSON | 4.096 |
| Regla y condiciones JSON | 1.024 |
| Pregunta del operador | 2.000 |

Se eliminó una segunda copia de campos del proceso fuera de esos bloques,
que podía volver a introducir una línea de comandos demasiado grande o
instrucciones de un atacante. La serialización escapa los saltos de línea
de los campos. Las delimitaciones y la política del prompt ayudan a tratar
la telemetría como evidencia no confiable; no garantizan inmunidad del modelo
a instrucciones maliciosas. La pregunta humana permanece separada.

## Análisis de un incidente (multi-alerta)

Desde la ficha de un caso (Incidentes) o desde la barra de selección de la
cola de Alertas, el operador puede pedir al analista IA que estudie varias
alertas como conjunto. La consola agrupa las alertas disponibles por
equipo y ventana de 30 minutos, toma como mucho **8 alertas** (las más
graves primero) y envía el resultado por el evento de socket
`analyst:ask-incident` del hub, que valida cada campo de nuevo con los
mismos límites de tarifa y concurrencia que el análisis de una alerta.

El prompt multi-alerta lleva, todo delimitado y truncado:

| Entrada | Límite |
|---------|--------|
| Metadatos del caso (título, severidad, estado, equipos, resumen) | 2.048 caracteres |
| Agrupación por equipo y ventana | 2.048 caracteres |
| Cada alerta JSON | 4.096 caracteres |
| Línea de tiempo del caso (incidentes) | 20 entradas, 1.000 caracteres por texto |
| Bundle forense de la alerta más grave | 40 eventos, 768 caracteres por evento |
| Pregunta del operador | 2.000 caracteres |

El bundle forense lo adjunta la consola leyendo
`GET /api/alerts/{id}/forensics` de la alerta más grave que tenga
identificador. Si el motor no devuelve bundle (404, captura desactivada o
error), el análisis sigue sin él: el prompt no declara evidencia que no
existe. Si el caso tiene más alertas que el tope, el número omitido viaja
en el payload y el modelo lo ve escrito.

El sistema pide una narrativa de cadena que cite eventos concretos (tipo,
hora, host, proceso o destino) como prueba de cada paso, y prohíbe
inventar datos: lo no deducible se nombra como incógnita abierta. La
política de dato no confiable es la misma del análisis de una alerta.
Las supresiones activas que afecten a reglas del caso se muestran en la
burbuja del operador, igual que en el análisis individual. Los pasos que
muestra el panel corresponden a trabajo real: preparar la evidencia,
consultar las notas locales ATT&CK de las reglas implicadas (máximo tres)
y esperar al proveedor.

## Qué es real y qué es simulado

| Componente | Implementación y límite de esta verificación |
|------------|---------------------------------------------|
| Motor Go, ingest, reglas, API, persistencia y consola | Código operativo. Los smokes arrancan el motor y recorren sus rutas con registros inertes; esos registros de prueba no son actividad capturada en un endpoint. |
| Sensor Rust ETW y `scripts/windows/sensor.ps1` (Sysmon) | Colectores implementados para Windows. El sensor Rust rechaza plataformas no compatibles. Esta entrega no ejecuta una captura ETW/Sysmon de laboratorio. |
| `scripts/dev-tests/scenario` y `scripts/dev-tests/bench` | Generadores explícitos de eventos ficticios para verificar el pipeline y medir rendimiento, con `source=simulate` y `source=bench` respectivamente. Solo aceptan destinos loopback y no se instalan ni publican como comandos del producto. |
| Capturas de consola del README y web | La sesión de ingest/consola es real, con eventos del escenario demo; no acredita actividad maliciosa real ni eficacia de detección en Windows. |
| Analista IA | Llama al proveedor configurado. Las regresiones usan respuestas HTTP aisladas; esta entrega no consulta un modelo real ni verifica la calidad de su análisis. |
| Tests DOM, Chromium y fixtures | Sustituyen servicios externos y datos para comprobar comportamiento reproducible. Están en herramientas/pruebas y no rellenan caídas del motor en la consola. |

El encabezado describe **toda la ventana recibida**, no solo el último evento.
Si hay algún `source=simulate` o `source=bench`, mantiene visible el indicador **demo**, también
en móvil, aunque después lleguen registros `sysmon` o `etw`. Los eventos de
rendimiento se identifican como «demo de rendimiento». Muestra
“fuentes declaradas” porque `source` lo aporta el emisor: no es una
atestación criptográfica de procedencia. Los orígenes desconocidos se
agrupan sin reflejar su texto arbitrario en el encabezado.

Sin sensores el motor puede esperar sin eventos o recibir el demo;
la consola no fabrica telemetría para aparentar actividad. YARA, gRPC,
filaments, eBPF, cuarentena nativa y ampliaciones ETW de red/registro no
deben confundirse con funciones entregadas: consulta [ROADMAP.md](ROADMAP.md).

## Verificación reproducible

- Go: pruebas de exportación con detector de carreras, cobertura de cada
  columna de texto, prefijos peligrosos, columnas numéricas y JSONL intacto.
  La regresión reprodujo las columnas sin proteger antes de la corrección.
- Cliente: **153 pruebas**, incluidas 15 de búsquedas guardadas y 7 de
  procedencia declarada. El fixture DOM tiene **27 comprobaciones** con
  entradas y eventos reales de React sobre jsdom: filtros recientes,
  actualización, aplicación, almacenamiento, errores y texto sin HTML.
- Analista: 5 nuevas regresiones comprueban petición inmediata, espera
  real de respuesta, límites, error HTTP y configuración ausente; además
  de las pruebas HTTP/socket existentes del hub.
- Chromium: **17 casos** de escritorio/móvil sobre la aplicación compilada,
  incluyendo recarga, Atrás, evento `storage` entre dos pestañas, filtrado
  idéntico, ausencia de desbordamiento y capturas del gestor de búsquedas.
- CI mantiene los cuatro trabajos obligatorios: motor Go con pruebas
  `-race` y staticcheck, consola con Bun/TypeScript/Next/DOM/Chromium,
  sensor Rust con comprobación Windows y smoke de respuesta en Windows.
  El smoke Windows ejerce respuesta sobre procesos creados por la prueba;
  no certifica los colectores ni la eficacia de todas las reglas.

```bash
go test -race ./internal/api -run 'Test.*Export|TestCSVSafePrefixesAndWhitespace' -count=1
cd web/console && bun test && bunx tsc --noEmit
```

Desde la raíz, con las dependencias instaladas:

```bash
node scripts/dev-tests/check_console_dom.mjs
make console-browser
```

La ejecución local del cliente en el workspace puede utilizar el adaptador
de compatibilidad Node; el CI ejecuta las baterías con Bun nativo. Los
fixtures y capturas certifican los flujos probados, no ausencia total de
bugs ni rendimiento o falsos positivos en una instalación real.

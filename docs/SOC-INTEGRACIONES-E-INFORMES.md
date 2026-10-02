# Integraciones SOC e informes de investigación

Incremento del 2 de octubre de 2026. Esta guía describe el código entregado,
las entradas que acepta, cómo investigar una alerta y los límites operativos.

## Qué incorpora

El motor sigue siendo un proceso Go con ingesta, reglas, correlación,
histórico SQLite, API y salidas SIEM. El nuevo binario `collector` convierte
logs observados en el esquema que consume esa ingesta. No sustituye la
instalación de Suricata, Zeek, osquery, Cowrie o Windows Firewall.

| Fuente explícita | Entrada soportada | Resultado observado |
|---|---|---|
| `suricata` | EVE JSONL: `alert`, `drop`, `flow` | Firma, prioridad, acción de firma, veredicto final o flujo |
| `zeek` | `conn.log` en JSONL | Conexión, UID, estado, bytes y duración disponibles |
| `osquery` | Filas diferenciales individuales `added` / `removed` | Resultado de consulta; no se transforma en creación de proceso |
| `cowrie` | JSONL: conexión, login fallido/aceptado, comando | Actividad del honeypot; no compromiso de un equipo productivo |
| `windows-firewall` | `pfirewall.log` W3C con cabeceras | `ALLOW` / `DROP`, dirección cuando está presente y flujo |
| `eml` | Mensaje MIME completo, archivo o stdin | Metadatos, SHA-256 e indicadores de revisión offline |

La primera ampliación añadió **14 reglas SOC** a las 55 anteriores. Con las seis reglas adicionales de phishing, el inventario actual contiene **75 reglas habilitadas**.
Los dos umbrales nuevos completan **4 definiciones volumétricas**:
20 logins fallidos de Cowrie o 50 descartes entrantes de firewall en cinco
minutos, agrupados por IP origen y host, con cooldown de quince minutos.

Las reglas cubren prioridades de IDS, descartes declarados por Suricata,
SMB/RDP hacia direcciones no privadas unicast, actividad de honeypots,
puertos administrativos nuevos observados por osquery, conexiones
administrativas permitidas/descartadas y cuatro indicadores de correo.
Son señales de investigación y requieren ajuste al entorno. No incluyen
acciones de terminación de procesos ni cambios de política de firewall.

## Compilar y comprobar antes de enviar

```bash
make build
./bin/engine validate
./bin/collector -source suricata -observer IDS-LAB -file eve.json -stdout
```

`-source` es obligatorio. `-observer` identifica al equipo o sensor que
observó la evidencia; por defecto toma el hostname del colector.
`-stdout` normaliza offline sin conectar al motor. La salida es JSONL;
los recuentos y errores van a stderr. Un error detiene la importación y
indica la línea sin imprimir su contenido.

Sin `-stdout`, el destino por defecto es `127.0.0.1:7777`:

```bash
./bin/engine run -store ./data/soc.db -forensic-dir ./data/forensics
./bin/collector -source suricata -observer IDS-LAB -file eve.json
./bin/collector -source zeek -observer NDR-LAB -file conn.json
./bin/collector -source cowrie -observer HONEY-LAB -file cowrie.json
```

El colector lee el archivo **una vez**. Para seguir archivos utiliza un
seguidor externo que gestione rotación, como `tail -F`, preservando las
cabeceras necesarias del firewall. No hay cursor persistente ni cola
durable de reenvío en este incremento.

### Conectar un colector remoto

Configura TLS y autenticación en el motor según [OPERATIONS](OPERATIONS.md).
El colector exige TLS verificado y `SF_INGEST_TOKEN` para destinos remotos.
Introduce el token en el entorno desde tu mecanismo de secretos:

```bash
./bin/collector -source suricata -observer IDS-01 -file eve.json \
  -addr engine.example:7777 -tls-ca /ruta/ca.pem
```

`-tls-ca` activa TLS; sin CA propia, `-tls` usa el almacén de confianza
del sistema. No existe una opción para omitir la verificación del
certificado. El token no se acepta como argumento del colector.
La conexión confirma `AUTH` antes de enviar evidencia. La confirmación
de autenticación **no es un ACK de procesamiento de cada evento**.

Una escritura fallida o parcial devuelve «processing unknown» y no
reintenta ese registro automáticamente. Una conexión conocida como
inactiva cuatro minutos se restablece antes del siguiente envío.
Estas medidas no garantizan entrega exactamente una vez.

## Configuración de las fuentes

### Suricata y Zeek

Suricata debe tener EVE habilitado. Se conserva separadamente
`ids_action` de la firma y `ids_verdict`: una firma `allowed` puede
coexistir con un veredicto final `drop`. El motor muestra el bloqueo
declarado por el proveedor; **no implementa un IPS inline propio**.
Un registro EVE `drop` sin objeto `verdict` se etiqueta `reported_drop`.

En flujos EVE, el evento usa `flow.start` cuando existe y conserva el
timestamp de emisión en `source_timestamp`. El `flow_id` se conserva sin
pasar por un float que pierda precisión. Zeek conserva el timestamp Unix
original además del tiempo normalizado. No se inventan PIDs ni procesos.

Zeek debe generar JSON; el formato TSV habitual de `conn.log` no es una
entrada compatible. Los umbrales NDR iniciales no son aprendizaje de
comportamiento ni reconstrucción de paquetes. `destination_scope=public`
clasifica direcciones no privadas unicast; no demuestra accesibilidad
desde Internet, exposición efectiva o malicia.

### osquery

El archivo [configs/osquery-soc.conf](../configs/osquery-soc.conf) contiene
una consulta de solo lectura sobre `listening_ports` y `processes` cada
60 segundos. Devuelve puertos TCP 22/445/3389 que escuchan en todas las
interfaces. Habilita filas individuales con `logger_event_type=true` y
envía el log de resultados a:

```bash
./bin/collector -source osquery -observer QUERY-01 -file osqueryd.results.log
```

No se aceptan lotes `diffResults` ni snapshots; el error indica cómo
cambiar el logger. La regla de puertos exige `counter > 0` para no
convertir la primera línea base en un «puerto nuevo». Un `added` solo
significa que la consulta encontró una fila nueva respecto al estado
anterior; no prueba el momento de creación del proceso ni acceso externo.

### Cowrie

Se conservan sesión, evento, usuario declarado y endpoints disponibles.
El colector omite `password`, mensajes arbitrarios y payloads. Cuando
`cowrie.command.input` incluye `realm`, identifica stdin y omite el texto:
podría ser una contraseña introducida a un comando interactivo.
Los comandos de shell sin `realm` son texto observado y no se ejecutan.

### Windows Firewall

Activa el registro de Windows Firewall en el host por su mecanismo
administrativo habitual. Este proyecto no activa el logging ni altera
reglas. El parser consume las cabeceras `#Fields:` y `#Time Format:`;
la posición de las columnas puede variar.

```bash
./bin/collector -source windows-firewall -observer WIN-01 \
  -file pfirewall.log -firewall-timezone Europe/Madrid
```

`UTC` no necesita zona adicional. `Local` requiere la zona IANA **del
host origen**, incluso si el colector está en otro equipo. Los tiempos
inexistentes o ambiguos durante cambios de horario se rechazan;
utiliza UTC para evitar atribuir un offset arbitrario a la evidencia.
Si `path` indica `RECEIVE`/`SEND` se declara entrante/saliente. Si falta,
no se inventa la dirección y las reglas que la requieren no coinciden.
OPEN/CLOSE/INFO-EVENTS-LOST no se convierten en conexiones permitidas.

### Correo y phishing offline

```bash
./bin/collector -source eml -observer MAIL-LAB -file sospechoso.eml -stdout
./bin/collector -source eml -observer MAIL-LAB -file sospechoso.eml
```

El análisis usa MIME y los encodings base64/quoted-printable. Calcula el
SHA-256 del mensaje y busca adjuntos con extensión activa, DMARC fallido
declarado en `Authentication-Results`, URLs con IP literal y diferencias
entre dominios de `From` y `Reply-To`.

Las cabeceras de autenticación se etiquetan **no verificadas**. No se
validan firmas DKIM/SPF/DMARC, no se visita ningún enlace, no se resuelve
DNS ni se ejecutan adjuntos. Las URLs guardadas omiten credenciales,
query y fragmento; el cuerpo y los payloads no se almacenan en el evento.
La evidencia original permanece en el archivo que proporciona el operador.
Se inspeccionan hasta 100 URLs explícitas; al superar ese límite se marca
contenido no inspeccionado. El ID incorpora el observador, mientras el
SHA-256 permite reconocer el mismo mensaje original entre observadores.

Archivos comprimidos, contenido no textual, mensajes anidados, charsets
no soportados y partes no inspeccionadas se señalan explícitamente.
No hay detección de QR, enlaces ofuscados ni reputación externa. La ausencia
de una alarma **no significa que un correo sea seguro**. Un `Date` válido
es fecha declarada por el mensaje; si falta o es inválido, se usa la fecha
real de importación y se etiqueta como tal.

## Investigar y redactar un informe

### Dashboard

En **Alertas**, selecciona una alerta, revisa fuente, flujo, observaciones
y evidencia forense. Reconoce, cierra o reabre mediante el triaje existente.
La nota de triaje y el nombre del operador son datos declarados: el token
compartido no autentica identidades individuales.

Abre **Redactar informe**. Completa título, analista, clasificación humana,
hallazgos, acciones realizadas, recomendaciones y referencias. Guardar
congela el snapshot seleccionado; no cambia el estado de la alerta y no
ejecuta una respuesta. No hay conclusión generada automáticamente.

**Informes guardados** permite abrir, editar, exportar y eliminar snapshots
aunque la alerta ya no esté en el histórico o el motor esté offline.
La eliminación afecta al borrador local, no al histórico del motor.

Hasta diez informes se guardan en `localStorage` del navegador y origen
actual. No hay sincronización multiusuario, backend de casos, cifrado
propio ni ACL de informes. Usa la exportación para conservar y compartir
el trabajo. Guarda antes de cambiar de alerta, cerrar el editor o navegar;
los cambios pendientes no se autoguardan.

Las revisiones detectan borradores desactualizados de otras pestañas y
exigen cargar la versión guardada antes de sobrescribir o eliminar.
`localStorage` no ofrece una transacción: dos escrituras exactamente
simultáneas aún pueden competir. Los errores de cuota, contenido corrupto
o incompatible se muestran y no se presentan como un guardado exitoso.

### CLI

El ID es la clave de alerta de 16 caracteres hexadecimales del motor:

```bash
./bin/engine report --alert 0123456789abcdef --interactive \
  --out reports/investigacion.md
```

La entrevista acepta varias líneas en los campos largos; `.` termina
cada campo. Selecciona pendiente, falso positivo, actividad autorizada o
incidente confirmado según lo que hayas investigado. Una entrevista
incompleta no crea un informe.

También puedes proporcionar un JSON estricto con los campos humanos:

```json
{
  "title": "Investigación de alerta",
  "analyst": "Nombre declarado",
  "decision": "pending",
  "findings": "",
  "actions": "",
  "recommendations": "",
  "references": ""
}
```

```bash
./bin/engine report --alert 0123456789abcdef --notes notas.json \
  --format json --out reports/investigacion.json
```

`--api` selecciona otra API; el token proviene de `SF_API_TOKEN`.
Destinos remotos requieren HTTPS y token. El cliente no sigue redirects.
Busca el ID exacto en la API real; una consulta incompleta no se anuncia
como «no encontrada». La salida nunca sobrescribe archivos ni symlinks.
Requiere un filesystem que permita hard links para la escritura exclusiva.
Los informes locales en `reports/` están ignorados por Git.

Markdown presenta evidencia y campos humanos en bloques separados con
fences dimensionados contra backticks recibidos. JSON conserva los valores
del snapshot. La clasificación humana no reescribe el estado del motor.

## Límites y correcciones

Los registros JSONL tienen un máximo de 1 MiB. Los atributos de fuente
se limitan a 4096 bytes por valor y se marca cualquier truncamiento.
Los IDs de importación se derivan de fuente, observador y línea original;
dos serializaciones diferentes del mismo hecho pueden producir IDs distintos.
Los correos admiten 10 MiB, 64 KiB de cabeceras, 100 partes, profundidad
10 y 1 MiB de texto decodificado total (256 KiB por parte).

El informe limita su snapshot a 64 KiB y valida identidad, fechas y campos.
Los campos humanos largos admiten 4000 caracteres, título 200 y analista
120. La CLI cuenta caracteres Unicode; el navegador aplica su límite
habitual de longitud de texto. La búsqueda en memoria y SQLite incluye
fuente, claves/valores de atributos y flujo sin cruzar fronteras de campos.
Filas antiguas de SQLite conservan su índice previo hasta salir de retención.

Se corrigió la pérdida de fuente, atributos y flujo al mapear alertas
directas y del hub; `info` ya no se transforma en `low`. El bridge deja
de publicar snapshots tardíos tras `stop()`, limpia timers ante errores,
cancela el lector del stream y acota frames/buffers SSE a 2 MiB de texto.
La deduplicación de importaciones conserva alertas de correos distintos
en el mismo observador y sigue deduplicando reenvíos exactos.

## Verificación y realidad de los datos

Las pruebas nuevas cubren formatos, valores inválidos, TLS verificado,
rechazo de autenticación, privacidad, DST, condiciones benignas, búsquedas,
reportes exclusivos, borradores, conflictos y exportaciones. El smoke
`scripts/dev-tests/smoke_soc_pipeline.py` ejecuta binarios compilados reales
en loopback autenticado y valida seis formatos, siete registros de fixture,
ocho alertas, SQLite, forensics, triaje y el comando de informe.

La CI mantiene Go (fmt/build/vet/staticcheck/race y smokes), consola
(Bun/types/build/DOM/Chromium), sensor Rust y respuesta Windows nativa.
Los tests, capturas y demo utilizan entradas generadas e identificadas.
No equivalen a validación en un despliegue vivo de los seis proveedores.
La integración es código operativo; el laboratorio externo y sus sensores
deben instalarse, configurarse y probarse en tu infraestructura.

Referencias de formato: [Suricata EVE](https://docs.suricata.io/en/suricata-8.0.0/output/eve/eve-json-format.html),
[Zeek conn](https://docs.zeek.org/en/v8.2.0/reference/logs/conn.html),
[osquery logging](https://osquery.readthedocs.io/en/stable/deployment/logging/),
[Cowrie](https://docs.cowrie.org/en/latest/OUTPUT.html),
[Windows Firewall logging](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-logging)
y [Go net/mail](https://pkg.go.dev/net/mail).

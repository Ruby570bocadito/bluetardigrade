## Sensor: YARA en ficheros escritos y escaneo bajo demanda (S-2)

El sensor ETW compila ahora un directorio de reglas YARA (`yara-x`, puro
Rust) y escanea cada fichero escrito en el host. Optativo: sin
`--yara-rules` no se consume telemetría de ficheros ni se añade hilo
alguno.

- Nueva sesión ETW `bluetardigrade-sensor-file` sobre
  Microsoft-Windows-Kernel-File (eventos 12 Create / 16 Write, keywords
  FILEIO|CREATE|WRITE): Create nombra el objeto fichero, Write entrega la
  ruta Win32 al scanner (mismo patrón que las escrituras de registro).
- Hilo propio fuera de los callbacks ETW: `stat` y dedupe por
  (ruta, tamaño, mtime), tope de tamaño (`--yara-max-mb`, 16 MiB por
  defecto), cola acotada de 512 ficheros; lo que no cabe se cuenta en el
  latido (`yara_dropped`) y queda sin escanear, nunca bloquea.
- Reglas: todo `*.yar`/`*.yara` bajo el directorio se compila en un único
  conjunto; un fichero roto se salta y se reporta sin tumbar el resto;
  `bundle.json` opcional nombra la versión del lote. El directorio se
  reevalúa cada minuto (fingerprint): un lote nuevo aterriza sin reiniciar
  el sensor.
- Evento `yara.match`: `file.path/extension/size_bytes/hashes.sha256` +
  atributos `yara_rule`, `yara_namespace`, `yara_tags`, `yara_meta_*`,
  `yara_strings` (presupuesto cerrado: 5 cadenas, 8 metadatos, valores
  truncados). `source` sigue siendo `etw` (el doctor lo declara conocida).
- Latido: `yara_rules` (0 = apagado), `yara_rules_sha` (solo con reglas
  cargadas), `yara_scans`, `yara_matches`, `yara_dropped`, `yara_errors`.
- Subcomando `scan <PATH>... --rules <dir> [--max-mb]`: el mismo scanner
  bajo demanda sobre ficheros o directorios, NDJSON por stdout; código de
  salida 2 cuando hay coincidencias. No abre ETW ni habla con el motor.
- Exclusiones fijas: spool, log, token del sensor y el propio directorio
  de reglas (un hallazgo allí solo devolvería al motor las entrañas del
  sensor). Comparación insensible a mayúsculas.
- Coste de dependencia: `yara-x` 1.22 trae consigo su runtime de módulos
  WASM (`wasmtime`, dependencia dura del crate). Check frío del árbol
  completo en este contenedor: ~1m 46s; el job de CI del sensor sigue de
  sobra dentro de sus 15 minutos.

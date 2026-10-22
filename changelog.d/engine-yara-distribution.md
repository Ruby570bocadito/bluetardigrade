## Motor: lote de reglas YARA guardado, servido y verificado (M-3)

El motor gestiona ahora el lote de reglas YARA que corren los sensores
(contrato S-2↔M-3 del PR #48). El operario cura un directorio
(`-yara-rules`, `./yara-rules` por defecto; vacío lo desactiva) y el
motor hace el resto:

- Estado en `GET /api/yara`: versión del `bundle.json`, `sha16` (huella
  de contenido: ruta relativa + NUL + contenido de cada `*.yar`/`*.yara`
  en UTF-8, en orden — el mismo algoritmo que compila el sensor),
  ficheros del lote y `problems` (no UTF-8, ilegibles, manifiesto sin
  versión legible).
- Descarga en `GET /api/yara/bundle`: el lote como zip determinista
  (`yara-bundle-<sha16>.zip`, timestamps a cero, sin los ficheros con
  problema). Se descomprime junto al `--yara-rules` del sensor y este lo
  recarga en menos de un minuto sin reiniciarse. 404 con lote vacío;
  413 por encima del tope de distribución de 32 MiB.
- Verificación de llegada: el fleet guarda el `yara_rules` y el
  `yara_rules_sha` que cada sensor reporta en su latido y los expone en
  `/api/fleet`; un sensor cuyo lote compiló entero reporta exactamente
  el `sha16` del motor, así que la comparación es de cadenas: sha
  distinto con `yara_errors == 0` es un lote viejo; con
  `yara_errors > 0`, un fichero que el sensor no pudo compilar (este
  lado cuenta ficheros, el sensor reglas compiladas).
- Sin dependencias nuevas (solo stdlib). La firma del lote viaja con la
  épica E-1 (canal firmado servidor→sensor, a la espera de visto bueno).

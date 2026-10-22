## Motor: la línea sobredimensionada en fase de datos ya se cuenta (H-003)

Hallazgo BAJO de TEST ronda 1: una línea NDJSON por encima del tope de
1 MiB en la fase de datos del ingest cerraba la conexión sin mover
ningún contador — `/api/stats` mostraba los mismos `dropped` e
`ingest_rejected` antes y después del envío. Ahora comparte el
tratamiento del tope de AUTH: cuenta como `ingest_rejected` y ackea la
causa («line too long (limit 1048576 bytes)») antes de cerrar, de modo
que el descarte es visible y el emisor sabe por qué. Los errores de
lectura corrientes (timeout de idle, reset) siguen sin contar: un
cliente que se queda callado no es un rechazo.

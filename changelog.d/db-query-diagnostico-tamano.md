## Consola SQL: diagnóstico explícito cuando el cuerpo pasa el tope (H-004)

Hallazgo BAJO de TEST ronda 1: `POST /api/db/query` con un cuerpo por
encima de los 64 KiB respondía «body must be JSON…», señalando un JSON
malformado cuando el problema real era el tamaño — mientras la ruta de
asignación sí nombraba su límite («unreadable or oversized request body
(8 KiB limit)»). Ahora detecta el cuerpo sobredimensionado antes de
parsear y responde el mismo diagnóstico explícito con su tope
(«unreadable or oversized request body (64 KiB limit)»). El código
sigue siendo 400, que es lo que documenta el OpenAPI para esta
operación; un JSON malformado pequeño conserva el mensaje genérico.

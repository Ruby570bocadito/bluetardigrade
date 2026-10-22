---
Tipo: mejora
Severidad: BAJO
Persona: Usuario torpe
Dirigido a: IMP-1
Estado: resuelto-pendiente-verificación
---
Pasos para reproducir: con el motor con `-api-db-query`, enviar
`POST /api/db/query` un cuerpo de 70 KiB (cap real: 64 KiB) con JSON
válido, y comparar con un cuerpo de 10 KiB en
`POST /api/alerts/{id}/assign` (cap 8 KiB).
Resultado esperado: el mismo diagnóstico explícito de tamaño que da la
ruta de asignación.
Resultado real: db/query responde
`400 {"error":"body must be JSON {\"sql\": string, ...}"}` — el mensaje
apunta a un JSON malformado cuando el problema real es el tamaño;
assign responde
`400 {"error":"unreadable or oversized request body (8 KiB limit)"}`
(explícito). OpenAPI no documenta 413 para db/query (solo 401/403/200),
así que el código 400 es correcto; el diagnóstico no.
Sugerencia: detectar el oversized antes de parsear y devolver el
mensaje explícito de límite, igual que assign.

Resolución (IMP-1, commit 1507de6): db/query detecta el MaxBytesError y responde 'unreadable or oversized request body (64 KiB limit)'; el código sigue siendo 400 (test TestDBQueryOversizedBodyNamesTheLimit)

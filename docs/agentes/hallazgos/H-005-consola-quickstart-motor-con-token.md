---
Tipo: documentación
Severidad: BAJO
Persona: Usuario nuevo
Dirigido a: PUL
Estado: abierto
---
Pasos para reproducir: arrancar el motor con `-api-token <t>` y seguir
el Quickstart de `web/console/README.md` tal cual
(`cd web/console && bun install --frozen-lockfile && bun run dev`).
Resultado esperado: el quickstart funciona o remite a la configuración
necesaria.
Resultado real: el proxy same-origin reenvía pero devuelve el 401 del
motor: `{"error":"unauthorized: send 'Authorization: Bearer <token>'
(configure it with -api-token/SF_API_TOKEN)"}`. La variable existe y
está documentada (`SF_API_TOKEN`, server-side, README de la consola
línea ~302 y `.env.example`), pero el Quickstart no lo cruza; con
`SF_API_TOKEN=<t>` en el arranque de la consola el proxy funciona
(verificado: stats JSON del motor).
Sugerencia: una línea en el Quickstart: «si el motor arranca con
-api-token, define SF_API_TOKEN en web/console/.env».

# claim: higiene-postmigracion

- ID: PUL
- Fecha: 2026-10-21 20:05 UTC
- Tarea del ROADMAP: higiene-postmigracion — `docs/agentes/` solo con los
  cinco artefactos, `.agent-tmp/` en uso, dependencias sincronizadas con el
  código.
- Rutas: `docs/agentes/` (solo retirar restos si los hubiera),
  `.gitignore`, `go.mod`/`go.sum` (tidy), manifiestos de `web/` y
  `website/` si la comprobación revela deriva.
- Nota: esta misma sesión ya sirvió la petición de PUL a IMP-1 (guard de
  referencia de API en el target `ci`, commit 0e20698).

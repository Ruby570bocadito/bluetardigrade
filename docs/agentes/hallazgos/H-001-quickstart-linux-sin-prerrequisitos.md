---
Tipo: documentación
Severidad: BAJO
Persona: Usuario nuevo
Dirigido a: PUL
Estado: resuelto-pendiente-verificación
---
Pasos para reproducir: máquina Linux x86_64 sin Go instalado; seguir el
README, sección «Linux, macOS or Docker (engine + collectors)»:
`git clone ...` y `make build`.
Resultado esperado: el quickstart indica los prerrequisitos o el fallo
es autoexplicativo.
Resultado real: `make: go: No such file or directory` y
`make: *** [Makefile:32: build] Error 127`. El badge del README dice
«engine Go 1.26» pero el quickstart no exige versión; go.mod exige
`go 1.26.10` (un Go 1.25 fallaría más adelante con error de toolchain).
Sugerencia: línea de prerrequisitos al inicio del quickstart Linux
(Go >= 1.26.10, make; bun para la consola) con el enlace de descarga.

Resuelto en 965265e (PUL, 2026-10-22): el quickstart Linux/macOS/Docker
declara Go 1.26.10 o más nuevo (la versión de go.mod, con el enlace de
descarga) y make; la ruta Docker queda como alternativa sin
prerrequisitos. Bun no entra en ese bloque (es engine + collectors); el
requerimiento de la consola vive en web/console/README.md, donde H-005
pide cruzar SF_API_TOKEN.

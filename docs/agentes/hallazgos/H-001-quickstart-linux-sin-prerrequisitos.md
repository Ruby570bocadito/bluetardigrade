---
Tipo: documentación
Severidad: BAJO
Persona: Usuario nuevo
Dirigido a: PUL
Estado: abierto
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

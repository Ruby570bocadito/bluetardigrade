## Docs: prerrequisitos en el quickstart Linux/macOS/Docker

El apartado «Linux, macOS or Docker» del README declara ahora lo que
exige la ruta de fuente: Go 1.26.10 o más nuevo (la versión que pide
`go.mod`; un toolchain 1.25 rechaza el build) y `make`, con el enlace
de descarga oficial. La ruta Docker sigue sin necesitar ninguno de los
dos. Hallazgo H-001 de TEST (usuario nuevo sin Go: `make` moría con
`go: No such file or directory`, error 127).

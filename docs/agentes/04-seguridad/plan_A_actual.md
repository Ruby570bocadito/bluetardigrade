# Plan de ronda — Seguridad A (2026-10-05, ronda 6, ~17h15 Madrid)

Base: `2369602` (mi ronda 5 publicada). Mientras la cerraba, dos carriles
subieron código: IMP-B publicó REP-4 (`a894ea4`, gráficas en informes y
enlace informe-del-caso) y SEG-B tiene cambios Go reales en su rama
(`5fbd1d`/`ff80dc7`/`6597e27`: cabeceras de seguridad en el motor, run-id
de scenrun bajo fallback de entropía, saneado del fallback del analista).

Tareas:

1. **Revisión funcional de los cambios Go de SEG-B** (rama ajena sin
   fusionar — anotar, no editar): `internal/api/security_headers.go`
   (nuevo: ¿se aplica en TODAS las rutas, incluidas ingesta TLS y
   descargas CSV?, ¿duplicidad con cabeceras ya existentes?),
   `internal/scenrun/scenrun.go` (el fallback de run-id mantiene la forma
   del wire; buscar carreras/regresiones en el área que revisé en mi
   ronda 2), `internal/api/scenarios.go` y el ajuste de
   `check_openapi.py`.
2. **Revisión funcional de REP-4 de IMP-B** (`a894ea4`): sección de
   gráficas de `reports-view.tsx` (exportación PNG/SVG/CSV, fuera de la
   hoja imprimible), enlace informe-del-caso en `incidents-view.tsx` +
   `shell.tsx`; re-verificar que mis dos hallazgos de la ronda 5 siguen
   vigentes en esta versión (lo comprobado: `generate` no cambió).
3. **Obligatorio de ronda**: `go test -race -count=5` sobre los paquetes
   con goroutines tocados por SEG-B (`internal/api`, `internal/scenrun`)
   en su rama.

Ficheros que espero tocar: solo `docs/agentes/04-seguridad/` y
`changelog.d/` si algún hallazgo cayera en código ya fusionado en main.

# Plan de ronda — Seguridad A (2026-10-05, ronda 2, 16h05 UTC)

Base: `a1bca4f` (main tras el cierre de la ronda 1). Rama `carril/seguridad-a`
recreada desde `origin/main` (la de la ronda 1 se fusionó y se borró).

Prioridad del TODO para SEG-A/B: revisar el código nuevo de la ronda 1
(`internal/scenario`, `internal/scenrun`, `internal/report`, vistas nuevas).
SEG-B ya publicó plan (16h, «ronda 3» en su cuenta) y se lleva las superficies
por el lado de vulnerabilidades y el PR #18 de Dependabot; yo voy por el lado
de bugs funcionales. No pisa mis ficheros.

Tareas (identificadores del TODO: SEC-7, SEC-8; prioridad ronda 2 SEG-A/B):

1. **Revisión del código de la ronda 1 en `main`**: `internal/scenrun`
   (concurrencia, más casos como el de `Start`), `internal/scenario` +
   `internal/scenrun` (cargador YAML), `internal/report` (ventanas, límites,
   CSV, truncado) y las vistas nuevas de la consola (historial de riesgo,
   pestañas del dashboard). Hallazgos en ramas ajenas: solo informar.
2. **SEC-7**: fuzz de la primera línea de ingesta
   (`ENROLL <token> <host>` → `handleEnroll` + `Registry.Enroll`) y del
   cargador YAML de escenarios (`scenario.LoadFile`). Ninguno de los 20
   targets existentes cubre estas dos superficies.
3. **Mejora obligatoria**: `go test -race -count=5` sobre los paquetes con
   goroutines de las ramas de los demás ya fusionadas (scenrun, ingest,
   alert, api, fleet, lifecycle, incident, collector, enroll).

Ficheros que espero tocar: `internal/report/` (arreglos + tests),
`internal/ingest/fuzz_test.go` o fichero nuevo de fuzz, `internal/scenario/`
(fuzz), `docs/agentes/04-seguridad/`, `changelog.d/`. Si un arreglo toca la
API documentada, dejo nota para Implementación A (openapi.yaml es suyo).

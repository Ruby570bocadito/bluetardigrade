# claim: forensic-retention

- ID: IMP-1
- Fecha: 2026-10-22 10:50 UTC
- Rutas: `internal/forensic/`, `cmd/engine/flags.go`, `cmd/engine/run_load.go`, `changelog.d/forensic-retention.md`

Tarea del TODO (Backlog — Forense): retención configurable
(`-forensic-retention`) en lugar del tope fijo de 256 bundles. El cap
`maxBundleFiles` pasa a ser el valor por defecto de un campo del
Recorder; flag nuevo del motor con validación alta (>0), test de
evicción con cap propio y un changelog.d/. No toca el anillo en
memoria (maxEventsPerHost) ni la API.

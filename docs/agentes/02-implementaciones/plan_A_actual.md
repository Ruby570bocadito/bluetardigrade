# Plan de ronda — Implementación A (2026-10-05)

- Tareas del TODO: **SIM-1** y **SIM-2** (Validación de detecciones, telemetría sintética e
  inerte; ninguna otra rama las ha publicado esta ronda).
- Ficheros: nuevo `internal/scenario` (esquema YAML, cargador, reproductor en proceso),
  `cmd/engine` (subcomando `scenarios` + propagación de la etiqueta `simulation` en las
  alertas: reglas, cadenas, beaconing, umbrales, intel y línea base), `internal/alert`,
  `internal/correlate`, `internal/beacon`, `internal/threshold`; biblioteca `scenarios/`
  (una por regla y cadena del paquete) con su test de CI que rompe si un escenario deja de
  detectar; `scripts/dev-tests/e2e_scenarios.sh`; docs (`OPERATIONS.md`, changelog fragment).
- Por qué: SIM-1/SIM-2 son la base de SIM-3/SIM-4 (consola) y de la cobertura de detección;
  tocan solo mi área (motor, API, CLI, escenarios). La consola no cambia.
- Para Implementación B: no hay rutas de API nuevas; las alertas simuladas llevarán la
  etiqueta `simulation` en su campo `tags` (documentado en el informe).

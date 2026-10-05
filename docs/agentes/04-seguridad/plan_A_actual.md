# Plan de ronda — Seguridad A — 2026-10-05

- SEC-7: fuzzing nativo de Go para las superficies de entrada que existen en `main`:
  decodificador NDJSON de ingesta (`internal/ingest`), cargador de identidades
  (`LoadIdentities`), parser de inteligencia (`internal/intel`) y cargadores YAML
  (reglas `internal/rules`, supresiones `internal/suppress`, umbrales `internal/threshold`,
  beacons, secuencias). Ficheros: `*_test.go` de esos paquetes (solo tests, sin tocar código
  de producción salvo bug real encontrado).
- SEC-8: repaso de la hoja de pruebas pendiente (`docs/PRUEBAS-PENDIENTES.md`) y revisión
  profunda de la lógica de detección en `main` (beacon, correlación, umbrales, riesgo)
  buscando regresiones funcionales; cada corrección con test que falla antes y pasa después.
- Nota de contexto: `TODO.md` y `docs/PLAN-DETALLADO.md` no están en `main`; se leen desde
  `origin/feat/enrollment` (el más reciente). Los bugs de la función de alta (rama sin
  fusionar) se informan al carril de Implementación A, no se corrigen aquí.
- Ficheros que NO toco: `TODO.md`, `docs/PLAN-DETALLADO.md`, `CHANGELOG.md`, `docs/api/openapi.yaml`
  (salvo que cambie la API, que no está previsto), `README.md`.

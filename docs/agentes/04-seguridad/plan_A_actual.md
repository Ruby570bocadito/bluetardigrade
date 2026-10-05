# Plan de ronda — Seguridad A (2026-10-05, ronda 2, 13h00 Madrid)

Base: `5e168ba` (main sin cambios). Ramas ajenas nuevas desde mi ronda 1:
`carril/implementacion-b` (3 rondas: triage IA, streaming, gráficas) y
`carril/seguridad-b` (x/text, CI audit, status pill). Rama del dependabot
(`x/ansi`) en revisión de lectura.

## Tareas

- **SEC-7 (continuación)**: fuzzers para las superficies que quedaron sin
  cubrir en la ronda 1: parser de correo de `internal/collector`
  (`htmlAttribute`, decodificador MIME), `internal/reputation` y
  `internal/api/filters.go`. Ficheros: los `_test.go`/`testdata` de esos
  paquetes + bug que el fuzzing saque a la luz.
- **SEC-8 (continuación)**: casos borde del alta en `origin/feat/enrollment`
  (equipo renombrado, reloj desfasado, registro lleno): revisión de lectura y
  hallazgos al informe (código de Implementación A, no toco su rama). Repaso
  de lo pendiente en la hoja de pruebas.
- **Revisión de código nuevo de otros carriles**: diffs de IMP-B
  (`web/console`, console-service) y SEG-B (`.github/workflows/ci.yml`,
  guard de ciclo de paquete, status pill). Bugs funcionales: hallazgo
  preciso con parche propuesto al informe si el código vive solo en su rama;
  corrección en mi rama solo si el código está en `main`.
- Verificación paridad CI de lo que toque + suite completa Go.

## Fuera de alcance

- `min_count: 2` de beacons: requiere decisión del responsable (anoto en el
  informe); el dependabot `x/ansi` es de dependencias (SEG-B/propietario).

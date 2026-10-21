# Roadmap de carril — Pulimiento B (backend)

Roadmap propio de la instancia (el general es `docs/agentes/ROADMAP.md`,
solo de los Directores). Lo actualizo al final de cada ronda: hecho, a
medias y lo siguiente.

Última actualización: 2026-10-21 19:15 CEST (ronda 1).

## Hecho (ronda 1, 2026-10-21)

- **P-3 — POL-3 completo** (PR #41): flag `-pprof-dir` del motor
  (CPU + heap + goroutine, opt-in, fallo ruidoso al arrancar si no se
  puede perfilar), `bench_nightly.sh` perfila las dos pasadas (rings y
  sqlite), verifica que los perfiles existen (fallo del nightly si no)
  y `bench-nightly.yml` los sube como artefacto `bench-pprof` (14 días,
  `if: always()`). Punto borrado de TODO.md + `changelog.d/bench-pprof.md`.
  CI del PR 6/6 verde.
- **S-5 — POL-1 sensor** (PR #43): `collector.rs` (1103 líneas) dividido
  en `collector/{config,shared,enrich,winimage,handlers,health}.rs` sin
  cambiar comportamiento (verificación de multiconjunto de líneas +
  batería completa del CI del sensor replicada en local, incluidos los
  dos cross-checks Windows). El punto POL-1 de TODO.md sigue abierto:
  faltan `api.go`/`run.go` (M-9, carril A).
- **Auditorías del carril** (sin cambios necesarios, constancia en el
  informe): `rules/` limpia (114 reglas, IDs únicos, front-matter
  uniforme, guard `check_rule_inventory` OK; el espejo `scenarios/rules/`
  diverge a propósito — es la biblioteca de replay adaptada, no copia);
  dependencias backend sincronizadas (`go mod tidy` sin diffs,
  `Cargo.lock` en sincronía con `cargo check --locked`; PRs Dependabot
  #24–#27 pendientes del humano, F0/H-3); sin rastros de marca de IA ni
  código simulado en el carril backend; sin ficheros temporales/muertos
  que limpiar.
- **Hallazgo de rendimiento del camino caliente** (para próximas rondas):
  el primer perfil del nightly muestra `internal/forensic`
  `(*Recorder).evictOldFiles` en torno al 29 % del CPU acumulado en la
  pasada rings (sandbox; confirmar en runner estable antes de actuar).

## En curso / a medias

- Nada: los dos PRs de la ronda están completos y en revisión.

## Siguiente (orden propuesto)

1. **POL-2 (`log/slog` en el motor)** — primera prioridad declarada de
   Pulimiento A para su próxima ronda; si A la toma entera, B apoya con
   la revisión y con los perfiles pprof como evidencia de que el formato
   no añade coste al camino caliente.
2. **Seguimiento pprof**: mirar el artefacto `bench-pprof` de las
   próximas noches; si `evictOldFiles` se confirma en runner estable,
   proponer (a Implementaciones, no es refactor mío) el barrido diferido
   del directorio forense.
3. **M-9 complementario**: cuando A divida `api.go`/`run.go`, verificar
   aquí que POL-1 quedó completo y cerrar el punto de TODO.md si procede
   (ritual completo).
4. **Barridos de higiene de rutina** en cada ronda: duplicados/código
   muerto en motor+sensor, dependencias, marca de IA, y revisión de los
   perfiles del nightly.

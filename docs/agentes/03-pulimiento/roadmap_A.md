# Roadmap de Pulimiento A (carril: motor Go y reglas)

Actualizado: 21 de octubre de 2026, ronda 1.

## Hecho esta ronda

- POL-1 (mi mitad): `internal/api/api.go` dividido en 11 ficheros
  (hub.go, setters.go, auth.go, rings.go, persist.go, publish.go,
  stats.go, records.go, alert_status.go, catalog.go, util.go) y
  `cmd/engine/run.go` dividido en 8 (run.go como orquestador + run_load,
  run_ingest, run_api, run_respond, run_outbound, run_background,
  run_pipeline). Movimiento verbatim, sin cambio de comportamiento; la
  suite completa quedó verde en cada etapa.
- Auditoría del carril: inventario de reglas limpio (114 reglas, IDs
  únicos, sin duplicados; `check_rule_inventory.py`), dependencias del
  motor sincronizadas (`go mod tidy` sin diff), sin rastros de marca de
  IA ni código simulado en mi superficie (el histórico de commits sí
  tiene uno: informe, acción del humano).

## A medias

- POL-1 del TODO.md: cerrado al 66 % (falta `sensor/src/collector.rs`,
  de mi pareja B). No he borrado el punto de TODO.md ni añadido
  changelog.d a propósito.

## Backlog de mi carril (orden previsto)

1. **POL-2** — logs estructurados con `log/slog` en el motor: conversión
   de los `log.Printf` de `cmd/engine/` e `internal/api/` (hay ~44
   llamadas solo en el antiguo run.go, hoy repartidas), manteniendo el
   prefijo `[ENGINE]`/`[API]` legible en la salida estándar. Es un cambio
   de comportamiento observable a propósito: iría solo, en su propia
   pieza, con el punto del TODO cerrándose al completar todo el motor.
2. **POL-3** — perfiles `pprof` del camino caliente en el benchmark
   nocturno (coordinar con lo que Implementaciones A haga en M-1/cola).
3. Consistencia de `rules/`: front-matter uniforme entre los 15 ficheros
   de `rules/windows/` y los de `rules/integrations/` (auditoría hecha:
   sin duplicados; queda uniformidad de estilo).
4. Limpieza menor: revisar `.gitignore` del motor y residuos de `bin/`
   en futuras rondas si aparece algo.

## Notas de coordinación

- Con Pulimiento B: su `collector.rs` cierra POL-1; el ritual (borrar de
  TODO.md + changelog.d) lo ejecuta quien complete el punto, en su
  commit.
- Con Implementaciones A: si M-1 mueve `internal/api` o `cmd/engine`,
  leer los nuevos nombres de fichero; la superficie y los símbolos no
  cambian (movimiento verbatim), solo la organización.
- Con Seguridad A/B: la superficie HTTP no cambió (OpenAPI 45 rutas en
  sync); los diffs son reorganización de ficheros.

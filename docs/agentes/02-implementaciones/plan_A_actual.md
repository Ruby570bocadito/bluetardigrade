# Plan de ronda — Implementación A (2026-10-05, ronda 2)

- Tareas del TODO: **SIM-4 parte A** (ejecución bajo demanda e historial: motor y API) y el
  **ALTA de Seguridad B**: elevar `golang.org/x/text` de v0.3.8 a v0.39.0 en mi rama
  (GO-2026-5970; mi rama hereda de `feat/enrollment` y aún lo lleva viejo).
- Ficheros: nuevo `internal/scenrun` (servicio de ejecución: recarga la biblioteca por
  ejecución, inyecta eventos en el pipeline en proceso, observa las alertas, historial en
  SQLite con fallback en memoria), `internal/api` (rutas nuevas), `internal/store`
  (tabla `scenario_runs`), `cmd/engine` (flag `-scenarios`, cableado), `docs/api/openapi.yaml`,
  `go.mod`/`go.sum`, changelog fragment.
- Por qué: mi roadmap lo tenía primero; IMP-B necesita el contrato para SIM-4/SIM-3 (su
  informe 13h11 lo declara bloqueado por APIs de este carril) y la cobertura de la biblioteca
  SIM-1/SIM-2 ya está cerrada y verificada.
- Para Implementación B (contrato): `GET /api/scenarios` (biblioteca cargada),
  `POST /api/scenarios/run` (cuerpo opcional `{"only":[...],"interval_ms":N,"timeout_ms":N}`;
  202 con `run_id`; 409 si ya hay una ejecución; 501 si el motor no arrancó con
  `-scenarios`), `GET /api/scenarios/runs?limit=N` (historial, más reciente primero, con
  `pass_rate` para la gráfica de tendencia) y `GET /api/scenarios/runs/{id}` (detalle con
  resultado por escenario: `detected|missing|catalog|error`, expectativas fallidas
  esperada/disparada, latencia). Detalle completo en OpenAPI.
- Fuera de alcance: SIM-4 parte B (pantalla, IMP-B), REP-1/REP-2 y la API de ruido
  (siguiente ronda).

# Plan de ronda 2026-10-06 — Implementación A

1. **Campo de decisión de triaje** (petición MEDIA de IMP-B, primera de la cola del
   roadmap): `decision: false_positive | authorized_activity | confirmed_incident` en
   el ciclo de vida. `internal/lifecycle`: campo opcional del `Entry`, validado con el
   mismo estándar que el estado; el registro es el estado COMPLETO del triaje — cada
   `Set` lo sustituye, así que omitir `decision` lo limpia (igual que `note` y `by`
   hoy). Cableado en `internal/api`: `POST /api/alerts/{id}/status` lo acepta y
   valida, el overlay de `GET /api/alerts` lo expone como `decision`, la línea de
   auditoría lo nombra. `internal/report/noise.go` añade `false_positive_pct` real
   junto a los proxies actuales (`closed_pct`/`acknowledged_pct` no se tocan). OpenAPI
   (`AlertStatusUpdate`, `Alert`, `RuleNoise`), OPERATIONS.md, changelog.d. Por qué:
   desbloquea el «falso positivo» del flujo de triaje (VIZ-3) y el FP% por regla de
   la pestaña de ruido que IMP-B no puede construir hoy.
2. Fuera de alcance: known-software/supresiones con condiciones (v1.1, ronda
   siguiente), AD-6/SET-1 (espera decisiones de producto del responsable), AD-7
   (mapeo de grupos), REP-2. Sin tocar: `internal/ingest` (conflicto pre-documentado
   SEG-A↔PUL-A), consola (IMP-B), sensor Rust (sin `cargo` en el entorno).

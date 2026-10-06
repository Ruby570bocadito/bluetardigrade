# Plan de ronda — Implementación A (2026-10-06, tercera ronda del día)

Base: `9b3fdc6` (mi ronda triage, retenida en local — la sesión no trajo credencial de push; se intenta publicar al abrir). `origin/main` sigue en `35cd866`. Leído: SEG-A ronda 13 (plan), PUL-B ronda 6 (plan), SEG-B ronda 9 (plan+informe). **SEG-A tiene DOS hallazgos abiertos en mi rama (ronda 11, 06h52) — prioridad de la ronda.**

Tareas (en este orden):

1. **Hallazgos de SEG-A en mi código** (MEDIA posture + BAJA cerrojos): `internal/api/ad.go` — asignar `postureWire.Score` (una línea + la prueba de la sonda de SEG-A casi verbatim) y leer `h.ad`/`h.alertLatency`/`h.ingestCert`/`h.version` bajo `h.mu` con accesorios al estilo `scenarioService()`.
2. **PLAN-DETALLADO §2.3 — supresiones con condiciones**: `internal/suppress` (campo `when` validado con `rules.NewMatcher` — mismos operadores que las reglas, una sola fuente de verdad), `cmd/engine/run.go` (evaluación contra el evento en la vía de reglas, intel y línea base; sin evento los agregados no las evalúan — a prueba de fallo hacia ALERTAR), `internal/api/suppress_write.go` + OpenAPI.
3. **PLAN-DETALLADO §2.2 — software conocido**: paquete `internal/known` (`known-software.yaml`, recarga en caliente, globs de `image` + `sha256`, `version: 1`), enriquecimiento `enrichment.known_software` (clave de motor, no falsificable), la línea base no lo reporta como novedad (sigue aprendiendo), el informe de ruido lo excluye de procesos con contador de honestidad, y flag de regla `exclude_known_software` (opt-in). §2.1 (Rust) sigue bloqueada: sin `cargo` en el entorno.
4. Verificación completa tras el ÚLTIMO cambio (checklist CI + `-race -count=5` en paquetes con goroutine tocados), informe, roadmap, `changelog.d/IMP-A-*.md`, merge-tree contra las cinco puntas.

No toco: consola (IMP-B/PUL-B), CI/Makefile (PUL-A), sensor Rust (sin cargo), ficheros compartidos.

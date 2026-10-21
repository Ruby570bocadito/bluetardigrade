# Plan de ronda — Seguridad B

Fecha: 2026-10-21 19:16 CEST · Instancia: Seguridad B (carril A↔B, bugs
funcionales del motor Go, el sensor Rust y la consola).

Contexto leído: informes de ambos Directores (18h56 A, 19h00 B),
ROADMAP.md general, mi roadmap_B.md, informes previos de mi pareja A y
plan de Pulimiento A. Sin plan nuevo publicado de A para esta ronda (su
plan_A_actual.md sigue siendo el de la ronda 1); desempate por plan
publicado primero si aparece solape.

Foco de esta ronda (carril A↔B, bugs funcionales):

1. **Carril sensor (mi cola priorizada según roadmap_B y recomendación
   explícita de A)**: revisión de bugs funcionales en `sensor/src/`
   — `transport.rs`, `heartbeat.rs`, `enrollment.rs`, `queue.rs` y
   `service.rs` — reconexiones, spool, latido y alta de equipos. El
   spool con caídas largas del motor es un punto explícito de
   PRUEBAS-PENDIENTES: el código debe sobrevivir a reinicios y a spool
   largo sin perder ni duplicar eventos.
2. **Regresión de los splits POL-1** (`877e378` hub api, `088eaaa`
   run.go en ficheros boot): refactor «sin cambio de conducta» — lo
   contrasto funcionalmente (orden de arranque/apagado, deferred
   cleanups, wiring de sinks) porque es código nuevo fusionado después
   de mi última auditoría y nobody lo ha re-revisado.
3. Si da tiempo: correlador (`internal/correlate`) y replay del atasco
   (regresión PR #28), que queda como cola compartida con A.

No toco: features (M-1, C-2, F3 Ajustes → Notificaciones), la vía de
aviso de consola (auditada por A), ni `sensor/src/collector.rs` salvo
lectura (terreno de Pulimiento B / S-5). Verificación antes de empujar:
`go build ./...` + `go test -count=1 ./...` y `cargo check`/`cargo test`
del sensor en verde localmente; sin webhook de Discord en esta sesión.

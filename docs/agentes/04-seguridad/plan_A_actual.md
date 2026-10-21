# Plan de ronda — Seguridad A

Fecha: 2026-10-22 (ronda 2 del sistema docs/agentes/) · Instancia:
Seguridad A (carril A↔B, bugs funcionales del motor Go, el sensor Rust y
la consola).

Lectura previa hecha: informes de los Directores A (18h56) y B (19h00),
docs/agentes/ROADMAP.md, mi roadmap_A.md, informe de mi pareja B (18h54)
y su plan. Nada dirigido a mi rol más allá de lo que ya está en mi cola:
la prioridad alta del Director (ritual S-1) es de Implementaciones B; el
F1 externo lo cerró B.

Foco principal de esta ronda (el que B me dejó recomendado y ya estaba en
mi roadmap, puntos 2 y 3 de la cola):

1. **Replay del atasco (regresión PR #28), parte dinámica y casos borde**
   — superficie `internal/api` + spool del sensor: volcado del atasco con
   caídas largas, reinicios a mitad, alertas sin hora válida, drenaje con
   el anillo lleno. Verificación real con tests Go nuevos en lugar de
   solo lectura estática.
2. **Ciclo `Deliver`/`drain` de `internal/notify`** — clasificación
   `Retryable`, límites y comportamiento bajo cancelación (contexto
   cortado a mitad de entrega), tal como recomendó B.
3. **Sensor Rust `transport.rs` + `heartbeat.rs`** (solo lectura esta
   ronda si los dos puntos anteriores consumen el tiempo): reconexión,
   latido y contadores EventsLost/BuffersLost.

No toco: features (M-1/C-2), la vista de Ajustes de SET-1, `sensor/` a
nivel de código (Pulimiento B está sobre `collector.rs` con S-5) ni el
kit previo de la raíz. Verificación antes de empujar: `go build ./...` +
`go test -count=1 ./...` en verde + tests nuevos del punto 1/2.

Nota para mi pareja B: tu plan publicado en el repo sigue siendo el de la
ronda 1 (ya ejecutado); no hay plan tuyo nuevo esta ronda. Dejo el foco
1 y 2 para mí conforme a tu recomendación y te reservo el correlador y
el sensor a nivel de código. Si solapas, ajusto tras leer tu plan.

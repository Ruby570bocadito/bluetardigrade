# Plan de ronda — Seguridad A

Fecha: 2026-10-21 19h50 CEST (ronda 3 del sistema docs/agentes/) ·
Instancia: Seguridad A (carril A↔B, bugs funcionales del motor Go, el
sensor Rust y la consola).

Lectura previa hecha: informes de los Directores A (18h56) y B (19h00) —
sin ronda nueva de directores desde entonces —, docs/agentes/ROADMAP.md,
mi roadmap_A.md, informe de mi pareja B (19h35) y el informe nuevo de
Implementaciones A (19h50) con la entrega M-1 ya fusionada en main
(`a51108a`). El plan de B sigue siendo el de la ronda 2 (19h16); no hay
plan de ronda 3 publicado de ella todavía — desempate por plan publicado
primero si aparece solape.

Foco principal de esta ronda:

1. **Revisión funcional de la entrega M-1 (backend de asignación de
   alertas, TEAM-3)** — código recién fusionado y sin ninguna revisión
   del carril de seguridad: `internal/lifecycle` (trío de asignación,
   `Assign`, conservación en `Set`, expulsión FIFO de 10.000 entradas),
   `internal/api/alert_assign.go` (ruta individual, lote de 500,
   validaciones, clasificación de errores por centinela) y los filtros
   `assignee`/`unassigned` del overlay en `records.go` (comportamiento
   idéntico entre modo anillo y modo tienda). Busco bugs funcionales:
   condiciones de carrera entre overlay y escritura, asignaciones
   fantasma, ids de 8 KiB, casos borde del lote no atómico, desajustes
   entre el contrato declarado y el código real.
2. **`internal/notify`: deadline de `drain()` por frame** (punto 1 de mi
   cola desde la ronda 2): contexto con timeout derivado del tiempo
   restante, para que un SMTP lento no estire el apagado ~17s. Pieza
   pequeña con test propio.

Si da tiempo: arranque del pase dinámico del correlador (compartido con
B — quien publique plan primero lo reclama; con este plan lo reclamo yo
si B no lo publica antes de empezar el punto 2).

No toco: features nuevas (M-2, C-2, F3 Ajustes), `sensor/` (cola de B),
el correlador si lo reclama B antes, ni el kit previo de la raíz.
Verificación antes de empujar: `go build ./...` +
`go test -count=1 ./...` en verde + tests nuevos de lo corregido;
`git pull --rebase` justo antes del push.

Nota para mi pareja B: con este plan reclamo la revisión de M-1 y el
drain por-frame de notify (mi cola). El correlador dinámico sigue
compartido — si tu ronda 3 lo toma, dime en tu plan y lo dejo. No toco
`sensor/` ni nada de tu terreno.

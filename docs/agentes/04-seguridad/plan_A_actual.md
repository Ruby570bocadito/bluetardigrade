# Plan de ronda — Seguridad A (2026-10-05, ronda 4, 18h45 Madrid)

Base: `c126679` (mi ronda 3 subida) + `origin/main` sin cambios. Las cinco
ramas ajenas siguen en sus planes; su código (AD-1, pantallas, matriz
nocturna) aún no existe, así que mis pendientes 1-2 siguen bloqueados y el
siguiente trabajo no bloqueado de mi carril es el código fusionado que
nadie ha revisado funcionalmente a fondo.

Tareas (SEC-8; «revisa con prioridad lo que los carriles de
Implementación fusionaron: es código nuevo»):

1. **Sensor Rust (feat/sensor-service, fusionado por PR #19)**: revisión
   profunda de los caminos nuevos — modo servicio (`service.rs`),
   rotación del log, cola/spool (`queue.rs`), reconexión y latido
   (`transport.rs`, `heartbeat.rs`) — buscando errores lógicos, casos
   borde y carreras. El entorno ahora tiene cargo (1.99): baseline de
   `cargo test --locked` y `cargo clippy --locked --all-targets
   -- -D warnings` antes y después de tocar nada.
2. Si un hallazgo es del lado Go del pipeline, se corrige con su test
   igual que en las rondas anteriores.

Ficheros que espero tocar: `sensor/src/` (si hay bug: fix + test),
`docs/agentes/04-seguridad/`, `changelog.d/`. Sin solape: IMP-A va de
AD-1/AD-2/SET-3 y nadie más reclama el sensor.

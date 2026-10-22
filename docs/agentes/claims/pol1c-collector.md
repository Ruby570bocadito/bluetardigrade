# claim: pol1c-collector

- ID: IMP-1
- Fecha: 2026-10-22 (sesión 3)
- Tarea: pol1c-collector — el análogo POL-1 de run.go aplica a
  sensor/src/collector.rs (479 líneas): api.go y run.go ya están
  divididos (pol1b, 088eaaa), collector.rs es el último de la lista
  POL-1 de TODO.md. Sin cambio de comportamiento: collector.rs queda
  como orquestador (run() + hostname), y salen dos trozos cohesivos
  como submódulos, igual que el patrón config/shared/enrich/... de
  56e8117: collector/sessions.rs (start_with_recovery, start_netreg,
  start_filewatch — el arranque con recuperación) y collector/stop.rs
  (STOP_REQUESTED, stop_sessions, install_console_handler — las rutas
  de parada). Las rutas públicas se mantienen con `pub use` en
  collector.rs, así main.rs/service.rs no cambian.
- Rutas que voy a tocar:
  - sensor/src/collector.rs (solo code motion)
  - sensor/src/collector/sessions.rs (NUEVO)
  - sensor/src/collector/stop.rs (NUEVO)
  - changelog.d/pol1c-collector-split.md (NUEVO)
  - docs/agentes/estado/IMP-1.md
- Verificación: replico el job sensor de CI en local (cargo check/test/
  clippy --locked + clippy -D warnings, y el cross-check
  x86_64-pc-windows-msvc) instalando el toolchain en .agent-tmp; el
  collector solo compila con target Windows, así que el cross-check es
  la prueba real de este cambio.
- Sin solape: SEG tiene gofmt-scenario-ci (internal/scenario/, Go) y
  IMP-2 liberó tema-claro; sensor/ no está reclamado por nadie.

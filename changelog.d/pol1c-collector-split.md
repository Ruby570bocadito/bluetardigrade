# POL-1 completado: el ciclo de vida de sesiones sale de collector.rs

Último de los tres ficheros grandes que POL-1 nombraba (internal/api/
api.go y cmd/engine/run.go ya estaban divididos). sensor/src/
collector.rs pasa de 479 a 312 líneas: se queda el bucle de ejecución
(run) y hostname, y el resto sale como submódulos con el mismo patrón
de config/shared/enrich/... ya existente: collector/sessions.rs (los
tres arranques de sesión con su envoltura de recuperación —
start_with_recovery, start_netreg, start_filewatch) y collector/stop.rs
(STOP_REQUESTED, stop_sessions, install_console_handler). Las rutas
públicas no cambian — collector::stop_sessions,
collector::STOP_REQUESTED y collector::hostname se sirven con `pub
use`, así que main.rs y service.rs quedan intactos. Sin cambio de
comportamiento: es movimiento de código, verificado con el mismo job
de CI del sensor en local (check, test, clippy -D warnings y el
cross-check x86_64-pc-windows-msvc, que es el que compila este módulo).

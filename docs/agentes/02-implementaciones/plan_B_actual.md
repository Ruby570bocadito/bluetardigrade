# Plan de ronda — Implementaciones B (sensor Rust) — 2026-10-21

- Ataco la parte de latido de **S-4** (diseño ya cerrado en PLAN-DETALLADO
  §2.5): cada minuto el sensor pregunta a las dos sesiones ETW cuántos
  eventos y búferes en tiempo real perdieron (`ControlTraceW
  EVENT_TRACE_CONTROL_QUERY`) y el latido lo envía (`etw_events_lost`,
  `etw_buffers_lost`) junto con los descartes del hilo de hashes
  (`hash_dropped`).
- Por qué: S-1 ya está en revisión (PR #40, rama `agent/sensor/s-1`) y este
  es el siguiente punto libre del carril sensor; es autocontenido, toca
  `sensor/` y no pisa la zona de registro del PR #40.
- Contrato que declaro: tres atributos nuevos de texto (enteros en decimal)
  en `sensor.heartbeat`. El motor los ignora hoy (lee por clave); avisar
  cuando suban (severidad baja) y mostrarlos en Equipos queda para AG-1/AG-3.
- No toco: registro del sensor (PR #40), SEC-2/DPAPI (fila propia en
  TASKS.md, carril de Seguridad) ni `docs/`/CI (hallazgos van al informe:
  `branches: ain]` en `ci.yml` y autores «Z User» en el histórico reciente).
- Mi pareja de carril (Implementaciones A, motor Go) no ha corrido esta
  ronda: no hay `docs/agentes/` en main; trabajo con mi plan y lo anoto.

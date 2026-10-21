# Roadmap — Seguridad A (carril A↔B, bugs funcionales del motor, el sensor y la consola)

Actualizado: 2026-10-21 18h55 CEST (primera ronda de esta era docs/agentes/).

## Estado de mi carril

- `docs/agentes/` ha arrancado de cero en esta ronda (la estructura anterior
  vivió en la rama descartada `100agentes`): no hay ROADMAP.md general ni
  informes previos que leer; mi referencia ha sido TODO.md, el CHANGELOG y
  el historial de git.
- Sin plan publicado de mi pareja B (Seguridad B no ha corrido aún):
  desempate trivial, mi plan publicado manda esta ronda. B: lee mi plan y
  mi informe antes de la tuya y elige foco complementario.

## Hecho en esta ronda (seg-A r1)

- Auditoría de la vía completa de «alerta crítica sin aviso» (F1):
  consola (SSE + snapshot REST + `newCriticalAlerts`), proxy Next.js
  (streaming correcto, `no-transform`), motor (`RecordAlert` →
  `broadcast("alert", ...)` con filtro por alcance y gota a cliente
  lento) y maestro de severidades (`severityOf` + paleta real de
  rules/beacons/thresholds/sequences, todo en minúsculas válido).
- **Corregido**: permiso de notificación en limbo (`default` tras
  descartar el diálogo) no mostraba pista ninguna en campana ni en
  Ajustes → Notificaciones; y el tono de aviso podía no sonar
  (`AudioContext` suspendido por la política de autoplay, sin
  `resume()`). Cambios en `alert-notify.ts` (+`notifyNeedsPermission`),
  `critical-notifier.tsx`, `settings-view.tsx`, diccionarios es/en
  (`notify.pending`), test nuevo y fragmento
  `changelog.d/console-notify-pending.md`.

## Cola de mi carril (priorizada, candidatas para próximas rondas)

1. **F1 resto**: la pata de canales externos del aviso (correo/Telegram
   no pueden llegar en Windows mientras `sf-start` no pase `-notify`) es
   F3/IMP-A por alcance (lanzador + doctor); desde Seguridad solo
   vigilancia. La reproducción «en Windows real» es acción del humano.
2. **Motor, casos borde del volcado del atasco (PR #28)**: estático
   revisado limpio esta ronda (`alertTimeLocked`, `ringDropLocked`,
   decay del riesgo por hora de evento). Pendiente lo dinámico en
   Windows real (humano). Revisar el drenaje con spool de horas y
   reinicios a mitad (TODO, pruebas en Windows real) cuando haya
   telemetría de esas pruebas.
3. **Sensor Rust**: `queue.rs` auditado limpio (orden cola→spool, replay
   tras caída, apagado); revisar `transport.rs` y `heartbeat.rs`
   (reconexión y latido con EventsLost/BuffersLost, S-4) en una próxima
   ronda.
4. **Supresiones y reglas**: carga validada fail-loud y operadores
   compartidos con el motor; pasar por `internal/rules` los operadores
   `i*` y el conversor Sigma cuando IMP toque F3 SigmaHQ.
5. **Hallazgos heredados del arbol viejo** (para el Director): los
   commits de sesiones previas traen autores con marca visible en el
   historial (`Claude <noreply@anthropic.com>` en `fe6acf8` y el bot de
   auditoría en `e02d66e`) — reescribir historia o no es decisión del
   humano (F0); AGENTS.md/TASKS.md/WORKLOG.md en raíz siguen ahí y el
   CONTEXTO dice que docs/agentes/ los sustituye.

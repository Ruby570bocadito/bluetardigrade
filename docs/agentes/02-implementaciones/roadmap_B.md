# roadmap_B.md — Implementaciones B (carril sensor Rust)

Archivo vivo de mi carril: lo hecho, lo a medias y lo siguiente. El QUÉ con
detalle vive en TODO.md; la prioridad, en docs/agentes/ROADMAP.md.

## Estado tras la ronda 2026-10-21 (20h15)

- **S-2 (YARA, ficheros escritos + bajo demanda) — entregada** (rama
  `agent/sensor/s-2-yara`): sesión Kernel-File propia, worker de escaneo
  fuera de los callbacks, reglas por directorio con recarga por
  fingerprint, `yara.match` + bloque `yara_*` en el latido, subcomando
  `scan`. CONTRATO S-2↔M-3 propuesto en
  `ronda_2026-10-21_20h15_B.md` (directorio + bundle.json + sha del lote
  en el latido); M-3 lo consume o lo ajusta antes de su PR.
- S-4 y el ritual S-1 ya fusionados (PR #42 y #40); S-5 (collector split,
  ajena) fusionada en PR #43.

## Estado tras la ronda 2026-10-21 (19h10)

- **S-4 (parte latido) — entregada** (PR #42): `etw_events_lost`,
  `etw_buffers_lost`, `hash_dropped` en `sensor.heartbeat`, con
  `ControlTraceW` por latido sobre las sesiones vivas y contador de
  denegaciones del hilo de hashes. Sin medias: la pieza es completa y
  funcional en sí misma; el consumo por el motor/consola es trabajo de
  AG-1/AG-3 según el contrato declarado.
- **Ritual S-1 — ejecutado**: TODO.md sin las líneas de S-1 y fragmento en
  changelog.d/sensor-registry-root.md (el código llegó fusionado en PR #40).

## Siguiente en mi backlog (orden del ROADMAP general)

1. **S-3** auditoría de servicios con permisos débiles (solo lectura).
2. **YARA memoria** (quedó abierta en TODO.md): escaneo del contenido de
   procesos; antes conviene el visto bueno al hueco declarado de
   atribución de proceso en `yara.match` (Kernel-File no trae PID).
3. **E-2** acciones cerradas en sensor — bloqueada por el visto bueno del
   humano al contrato de E-1.
4. **E-1** junto a Implementaciones A cuando el humano apruebe.

## Mejoras propias apuntadas (no asignadas)

- Acumular las pérdidas ETW entre recuperaciones de sesión para que el
  aviso del motor no vea caídas cuando el sensor recrea una sesión.
- «Agrupar arranques repetidos en el sensor» (Backlog/Detección y ruido):
  el primero completo y un resumen con `repeat_count` (caso Lenovo Vantage).
- SEC-2 (DPAPI para ingest.token) es del carril Seguridad C/D; sin acción
  por mi parte salvo coordinación.

## Notas de carril

- El reparto por componente sigue teniendo sentido: sin solapes con
  Pulimiento A (motor Go) ni Seguridad B (vía de avisos).
- CI del sensor replicado localmente en cada ronda (check/test/clippy host
  + cross-check msvc) hasta que el aviso de `ci.yml` (`branches: ain]`) lo
  corrija OPS.

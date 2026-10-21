# roadmap_B — Seguridad B (bugs funcionales, carril A↔B)

Instancia: 04-seguridad [B] · Primera ronda: 2026-10-21.

## Hecho

- Ronda 1 (2026-10-21): bug «Alerta crítica sin aviso» — rama externa.
  `runtime.ps1` pasa `-notify tools\config\notify.yaml`; check «Avisos
  externos» en `sf-engine doctor` (valida con `notify.Load`, no envía, no
  divulga secretos); `notify.example.yaml`; 4 tests nuevos. Sub-punto F3
  cerrado con changelog.d. Auditoría sin defectos de: `critical-notifier.tsx`,
  `alert-notify.ts`, `use-engine-stream.ts`, replay del PR #28 en
  `internal/api`/`internal/risk` (nivel código; la prueba física es del
  humano). Ver informe `ronda_2026-10-21_18h54_B.md`.

## A medias

- Nada a medias: el cambio entró completo y con la suite en verde.

## Siguiente en mi backlog

1. Carril sensor (reparto acordado con Seguridad A, que deja auditada la
   vía de aviso de consola): `transport.rs`, `heartbeat.rs` y
   `enrollment.rs` desde bugs funcionales — reconexiones, spool, alta.
2. Revisión de bugs funcionales del merge S-1 (sensor) respetando el
   esquema decidido (`registry.value` + `user` +
   `attributes["registry_root_inferred"]`; NO `registry.value_data`) y del
   ritual pendiente que le toca cerrar a Implementaciones B.
3. Correlador (`internal/correlate`) y replay del atasco con spool largo si
   A no lo toma antes (regresión PR #28).
4. Si C/D entrega Ajustes → Notificaciones (F3): auditar el flujo de
   validación y el botón «Enviar prueba» desde bugs.

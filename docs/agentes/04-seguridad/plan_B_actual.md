# Plan de ronda — Seguridad B

Fecha: 2026-10-22 (primera ronda del sistema docs/agentes/; no hay informes
previos de Directores ni ROADMAP.md general, ni plan de mi pareja Seguridad A).

Foco de esta ronda (carril A↔B, bugs funcionales):

1. **«Alerta crítica sin aviso» (F1/F3 de TODO.md)** — bug funcional
   confirmado por las pruebas: `sf-start` no pasa `-notify` al motor, así que
   en Windows el correo y Telegram no pueden llegar nunca. Ataco la causa:
   `scripts/windows/runtime.ps1` (pasar `tools\config\notify.yaml` cuando
   exista), check nuevo en `sf-engine doctor` que valide el fichero con
   `notify.Load` (fail-loud temprano, sin enviar nada) y `notify.example.yaml`
   de ejemplo en la raíz siguiendo la convención de `ad.example.yaml`.
2. **Regresión tipo PR #28** (volcado del atasco al rearrancar): revisión de
   código y tests del replay (`internal/api/api.go`, `internal/risk/risk.go`,
   stream de la consola) para contrastar que el flujo, el grafo y el riesgo
   siguen cuadrando; el repro en Windows real queda como acción del humano.
3. **Vía de aviso en la consola** (`critical-notifier.tsx` + `alert-notify.ts`):
   auditoría del cebado, permisos y deduplicación de toasts.

No toco features (asignación de alertas, Ajustes → Notificaciones: de
Implementaciones). Sin webhook de Discord configurado en esta sesión.

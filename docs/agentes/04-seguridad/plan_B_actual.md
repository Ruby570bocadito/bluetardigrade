# Plan de ronda — Seguridad B (ronda 3, 2026-10-05)

Identificadores del TODO que cogo (seguridad B):

1. **Superficies nuevas de la ronda 1** (prioridad del TODO para SEG-A/B):
   - `/api/scenarios` y `POST /api/scenarios/run` (`internal/scenario`, `internal/scenrun`,
     flags del motor): ¿activación accidental en producción?, ¿quién puede arrancar una
     ejecución?, límites de recursos y de ejecuciones simultáneas.
   - `/api/reports` y `/api/noise` (`internal/report` + handlers de API): exposición de datos
     por rol, inyección de fórmulas en CSV, tamaño de las respuestas.
   - Análisis de incidentes del analista IA: los eventos como entrada no confiable dentro del
     prompt; política, límites y streaming (consola + servicio de la consola).
2. **PR #18 de Dependabot** (`dependabot/go_modules/go-minor-and-patch-3997018e1a`):
   revisión del diff dependencia a dependencia y decisión razonada.
3. **SEC-6 (resto):** re-auditoría de los componentes de terceros copiados en
   `web/console/src/components/reactbits`.

Ficheros que espero tocar: `internal/api/`, `internal/scenario*/`, `internal/report/`,
`web/console/` (analista y reactbits), `changelog.d/`, `docs/agentes/04-seguridad/`.
El conector AD (AD-1) aún no existe en ninguna rama publicada: se vigila y queda para la
siguiente ronda. SEC-2 (DPAPI): propuesta de diseño en el informe para Implementación A.

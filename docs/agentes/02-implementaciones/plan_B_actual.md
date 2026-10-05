# Plan de ronda — Implementación B (2026-10-05)

Nota: `TODO.md` aún no existe en el repositorio; esta ronda toma las tareas de
`docs/ROADMAP.md` (fuente disponible) y las prioridades marcadas allí.

## Tareas cogidas (identificadores de ROADMAP)

1. **H5 «Análisis de incidente»** (principal): agrupar alertas por host+ventana y
   ofrecer «analizar incidente» al hub IA con el bundle forense como contexto.
   Cierre del roadmap: prompt multi-alerta con el bundle adjunto y respuesta que
   cite eventos del timeline.
   - `web/console/src/lib/incident-analysis.ts` (nuevo): agrupación host+ventana,
     constructor de payload acotado (máx. 8 alertas, resumen del bundle) + tests.
   - `web/console/src/components/console/analyst-panel.tsx`: modo incidente
     (burbuja propia, emite `analyst:ask-incident`).
   - `web/console/src/components/console/incidents-view.tsx`: botón «Analizar con IA»
     en el detalle del caso.
   - `web/console/src/components/console/alert-actions.tsx` + `shell.tsx`: handoff
     de la selección múltiple («Analizar la selección»).
   - `web/console-service/analyst.ts` + `hub.ts`: prompt multi-alerta delimitado y
     truncado, validación y mismos límites de tarifa/concurrencia, evento
     `analyst:ask-incident`; tests en `analyst.test.ts` y `hub.test.ts`.
   - Docs: sección en `docs/INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md` y fragmento
     `changelog.d/IMP-B-analisis-incidente.md`.

Fuera de alcance esta ronda: streaming nativo del proveedor (H5, requiere otra
ronda), vista de árbol global (necesita endpoint Go de A), árbol del bundle
(ya entregado en main).

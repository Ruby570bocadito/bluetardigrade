# Plan de ronda — Implementación B (2026-10-05, ronda 2)

Nota: `TODO.md` sigue sin existir en el repositorio; las tareas se toman de
`docs/ROADMAP.md`. Sin ramas `carril/*` ajenas publicadas en origin al hacer
fetch al inicio de la ronda: nada que reconciliar con otros carriles.

## Tarea cogida (identificador de ROADMAP)

1. **H5 «Progreso honesto del analista»: streaming nativo del proveedor**
   (única tarea de la ronda, como reservó `roadmap_B.md` para no mezclar
   contratos): el hub pide al proveedor `stream: true` (API compatible con
   OpenAI) y reenvía cada fragmento real como `analyst:delta` en vivo.
   - Contrato de socket sin cambios (`analyst:step/delta/done/error`); el panel
     ya acumula fragmentos.
   - Si el proveedor ignora el streaming y responde JSON, el texto se reenvía
     completo como hasta ahora (compatibilidad Ollama/LM Studio).
   - Guardas de tiempo: primer byte, inactividad entre fragmentos y tope total;
     mensajes de error en español listos para el operador.
   - Pruebas: SSE y casos límite en `analyst.test.ts` y
     `analyst-progress.test.ts`; E2E de socket con deltas múltiples en
     `hub.test.ts`.
   - Docs: sección del analista en `docs/INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md`
     y fragmento `changelog.d/IMP-B-streaming-analista.md`.

Fuera de alcance esta ronda: vista de árbol global (pende del endpoint Go
`GET /api/hosts/{h}/tree` de Implementación A) y gráficas nuevas (el dashboard
ya cubre distribución por táctica y severidad; candidatos quedan en backlog
para cuando el responsable pida más visualización).

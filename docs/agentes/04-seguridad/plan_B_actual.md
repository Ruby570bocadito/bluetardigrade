# Plan de ronda — Seguridad B (ronda 4, 2026-10-05)

Identificadores del TODO que cogo (seguridad B):

1. **SEC-4/SEC-3 (console-service, tarea viable de mi ronda tras el
   informe de la ronda 3):** unificar la validación de la petición
   `analyst:ask` (alerta única) con la misma disciplina campo a campo
   que ya tiene `validateIncidentPayload`: hoy el fallback a la copia
   del cliente solo exige `rule_id` (`web/console-service/hub.ts`),
   sin recortes ni limpieza de tipos. Ficheros: `analyst.ts`
   (extraer validación de alerta individual), `hub.ts` (usarla) y sus
   tests. Console-service no está en el plan de ningún otro carril
   esta ronda.
2. **AD-1 y SEC-2:** siguen sin código en `main` ni en la rama de
   IMP-A (solo plan); se re-verifica al cerrar la ronda y, si
   aparece, pasa a primera prioridad.

Ficheros que espero tocar: `web/console-service/analyst.ts`,
`web/console-service/hub.ts`, `web/console-service/analyst.test.ts`
y/o `hub.test.ts`, `docs/agentes/04-seguridad/`, `changelog.d/`.

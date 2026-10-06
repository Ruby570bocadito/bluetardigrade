# Plan de ronda — Implementación B (2026-10-06, ronda 9)

Base: `fc7bdbd` (ronda 8 publicada). `DISCORD_WEBHOOK_URL` sin definir en este
entorno (rondas 5-9): sin notificaciones. AD-6 + SET-1 SIGUEN BLOQUEADAS: la
punta de IMP-A sigue en `c357cc8` (solo su plan; la API `GET/PUT
/api/settings/ad` + `POST /api/ad/test` sigue sin publicar ni openapi). Merge
de su ronda = gatillo, como las rondas 8.

1. **IDEA-10 fase 2, continuación del barrido i18n: `alerts-view`** (la cola
   de triaje, primera de la cola del roadmap): sección `alerts` en los
   diccionarios ES/EN con paridad tipada, todos los subcomponentes
   (SeverityStrip, AlertDetail, AlertDetailBody, AlertGraph, StatusChip,
   TriagePanel) consumen `useI18n`; ES byte-idéntico (las baterías fijan
   «Reconocer», «Cerrar», «Anterior», «Siguiente», «Histórico», «Buscar en
   alertas»); `by: 'consola'` queda literal (dato de auditoría, no copia de
   UI); las etiquetas de severidad del strip entran al diccionario SOLO para
   esta vista (SEVERITY_LABEL sigue para las vistas sin barrer).
2. Tests i18n fase 3 (anclas ES byte-idénticas + traducción EN real).
3. Verificación completa tras el ÚLTIMO cambio: bun test, tsc, build, DOM,
   navegador, axe (2 temas), temas, CSP. Motor sin tocar.
4. Informe `ronda_2026-10-06_09h25_B.md`, roadmap, `changelog.d/`,
   merge-tree contra las cinco puntas, push.

No toco: motor (IMP-A), sensor, CI/Makefile (PUL-A), `globals.css`/
`layout.tsx`/`entity-graph.tsx` (PUL-B), `user-session`/`detectors-menu`
(fuera del barrido por depender de otros).

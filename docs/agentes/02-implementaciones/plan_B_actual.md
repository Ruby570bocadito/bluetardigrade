# Plan de ronda — Implementación B (2026-10-06, ronda 10)

Base: `28d6f9e` (ronda 9 publicada). `DISCORD_WEBHOOK_URL` sin definir en este
entorno (rondas 5-9): sin notificaciones. AD-6 + SET-1 SIGUEN BLOQUEADAS:
re-verificado con `git fetch --prune`, la punta de IMP-A sigue en `c357cc8`
(solo su plan; la API `GET/PUT /api/settings/ad` + `POST /api/ad/test` sigue
sin publicar ni en openapi). Merge de su ronda = gatillo, como las rondas 8-9.

1. **IDEA-10 fase 2, continuación del barrido i18n: `incidentes`** (la vista
   de casos, siguiente de la cola por tamaño y tráfico de triaje):
   `incidents-view.tsx` + `incident-playbook.tsx` consumen `useI18n`; secciones
   `incidents` y `playbook` en los diccionarios ES/EN con paridad tipada; ES
   byte-idéntico; el contenido de las tres plantillas del plan de respuesta
   (nombres, descripciones, pasos por id, pistas de evidencia) entra al
   diccionario como contenido de producto, con test que liga ids y pistas a la
   estructura de `lib/incident-playbook.ts`.
2. Queda FUERA y se registra en el roadmap: los informes de caso exportados
   (`lib/incident-report.ts`, documentos .md/.html descargables) siguen en
   español — decisión de idioma del documento exportado para una ronda
   propia, junto con `report-library` (REP-1); los errores de las librerías
   compartidas (`res.error`, mensajes de throw de `lib/`) siguen el trato de
   la ronda 9 (superficie compartida, no chrome de la vista).
3. Tests i18n fase 4 (anclas ES byte-idénticas + traducción EN real + ligadura
   estructural de plantillas).
4. Verificación completa tras el ÚLTIMO cambio: bun test, tsc, build, DOM,
   navegador, axe (2 temas), temas, CSP. Motor sin tocar.
5. Informe `ronda_2026-10-06_10h15_B.md`, roadmap, `changelog.d/`,
   merge-tree contra las cinco puntas, push.

No toco: motor (IMP-A), sensor, CI/Makefile (PUL-A), `globals.css`/
`layout.tsx`/`entity-graph.tsx` (PUL-B), `alert-actions.tsx`/`reports-view.tsx`
(etiquetas de estado de incidente que muestran; se barren con sus vistas).

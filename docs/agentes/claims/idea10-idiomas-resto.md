# claim: idea10-idiomas-resto

- ID: IMP-2
- Fecha: 2026-10-22 (hora UTC del commit)
- Tarea: carril IDEA-10 restante — reglas, ruido, respuesta, flujo en
  vivo, analista y eventDetail (compartido con flujo) en bilingüe.
- Rutas:
  - `web/console/src/components/console/rules-view.tsx`
  - `web/console/src/components/console/noise-view.tsx`
  - `web/console/src/components/console/respond-view.tsx`
  - `web/console/src/components/console/live-feed.tsx`
  - `web/console/src/components/console/analyst-panel.tsx`
  - `web/console/src/lib/console-types.ts` (eventDetail + formateadores
    de fecha con locale por idioma)
  - `web/console/src/lib/soc-metrics.ts` (formatAgo con idioma opcional)
  - `web/console/src/components/console/dashboard.tsx` y
    `web/console/src/components/console/hosts-view.tsx` SOLO para pasar
    el idioma a eventDetail (los consumidores compartidos declarados en
    el punto IDEA-10)
  - `web/console/src/lib/i18n/dict-es.ts`, `web/console/src/lib/i18n/dict-en.ts`,
    `web/console/src/lib/i18n/i18n.test.ts`
  - `changelog.d/console-idea10-idiomas-resto.md`

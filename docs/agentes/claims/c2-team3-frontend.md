# claim: c2-team3-frontend

- ID: IMP-2 (consola Next.js)
- Fecha: 2026-10-22 19:10 (CEST, Europa/Madrid)
- Tarea del ROADMAP (ALTA): vista «Mis alertas», cola sin asignar,
  reasignación y asignación en lote según el contrato M-1→C-2.
- Contrato: resumen operativo en `docs/agentes/ROADMAP.md` §Contratos;
  fuente de verdad `docs/api/openapi.yaml` (PR #45). Leído.
- Rutas que voy a tocar:
  - `web/console/src/lib/console-types.ts`
  - `web/console/src/lib/engine-client.ts` (+ test)
  - `web/console/src/lib/alert-search.ts` (+ test)
  - `web/console/src/lib/lifecycle.ts` (+ test)
  - `web/console/src/lib/i18n/dict-es.ts`, `dict-en.ts`
  - `web/console/src/components/console/alerts-view.tsx`
  - `web/console/src/components/console/alert-actions.tsx`
  - Ritual del punto: borrar de TODO.md el punto completado + entrada en
    `changelog.d/` (convención vigente) y `docs/agentes/estado/IMP-2.md`.
- Fuera de mi zona: `internal/`, `cmd/`, `docs/api/`, `sensor/`. Si falta
  algo del motor, va a «Peticiones» de mi estado.

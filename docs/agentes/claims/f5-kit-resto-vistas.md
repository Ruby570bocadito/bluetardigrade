# claim: f5-kit-resto-vistas

- ID: IMP-2 (consola Next.js)
- Fecha: 2026-10-21 19:39 UTC
- Tarea del ROADMAP: F5 — continuar el kit POL-7 en el resto de vistas:
  botón/campo/selección/tabla del kit (`components/ui/`) donde aún queda
  markup crudo — Incidentes, Equipos, Directorio, Informes y las vistas
  pequeñas (Supresiones, Intel, Ruido) —, cabeceras con los indicadores
  de cada vista donde falten y estados vacíos que digan qué hacer. El
  rework del tema claro queda para la hornada siguiente del mismo carril
  (migración mecánica primero, paletas después).
- Rutas que voy a tocar:
  - `web/console/src/components/console/incidents-view.tsx`
  - `web/console/src/components/console/hosts-view.tsx`
  - `web/console/src/components/console/directory-view.tsx`
  - `web/console/src/components/console/reports-view.tsx`
  - `web/console/src/components/console/suppressions-view.tsx`
  - `web/console/src/components/console/intel-view.tsx`
  - `web/console/src/components/console/noise-view.tsx`
  - `changelog.d/` y `docs/agentes/estado/IMP-2.md` (al cerrar)
- Sin dependencias nuevas: los primitivos ya viven en `components/ui/`
  (Button, Input, Select, Switch, Badge, Table) y Radix ya está en
  package.json. Commits atómicos por vista; bun test + tsc + next build
  en verde antes de cada push.

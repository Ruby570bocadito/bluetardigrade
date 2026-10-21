# claim: c5-aviso-sensores-desactualizados

- ID: IMP-2 (consola Next.js)
- Fecha: 2026-10-21 20:14 UTC
- Tarea del ROADMAP: C-5 — aviso en Equipos de sensores desactualizados:
  la versión ya viaja en el latido (`sensor_version` → `/api/fleet`,
  `FleetHost.sensor.version`) y el motor publica la suya en
  `/api/stats` (`version`). La consola compara y avisa; no inventa
  jerarquías semver: desactualizado = «no coincide con la del motor».
- Rutas que voy a tocar:
  - `web/console/src/lib/fleet.ts` (helper puro de comparación)
  - `web/console/src/lib/fleet.test.ts` (tests reales del helper)
  - `web/console/src/components/console/fleet-parts.tsx`
    (SensorCard: banda de aviso; FleetSummary: recuento; chip por fila)
  - `web/console/src/components/console/hosts-view.tsx`
    (chip en las filas del índice de Equipos)
  - `changelog.d/` y `docs/agentes/estado/IMP-2.md` (al cerrar)
- Sin dependencias nuevas. bun test + tsc + next build antes del push.

# Plan de ronda — Implementación B (2026-10-05 13h32)

- **VIZ-3 «Flujo del triaje»**: libra pura `lib/triage-flow.ts` + gráfica de flujo
  (fuente → táctica → estado) con los tres estados reales del motor
  (`new`/`acknowledged`/`closed`); el «falso positivo» no se pinta porque la API
  aún no lo expone como estado (se declara en el pie del panel y en el informe).
- **VIZ-1 «Donuts»**: componente compartido `charts/donut.tsx` (≤ 6 porciones +
  «Otros», total al centro, leyenda, gemelo de tabla) con libra pura `lib/donut.ts`;
  paneles «Composición de las alertas» (táctica y fuente) y «Flota por estado»
  (usa `GET /api/fleet` ya publicado: en línea / sin señal / inactivo).
- Datos solo de contratos existentes (búfer de alertas del stream, `/api/fleet`);
  sin cambios de OpenAPI, socket ni variables de entorno.
- Sin solape: no toco `globals.css`/`layout.tsx`/`shell.tsx`/`entity-graph.tsx`
  (PUL-B), ni la fila «Console» de `docs/ARCHITECTURE.md` (PUL-A), ni Go/sensor
  (IMP-A, SEG-A/B). Verificación: `bun test`, `tsc --noEmit`, `build` en web/console.

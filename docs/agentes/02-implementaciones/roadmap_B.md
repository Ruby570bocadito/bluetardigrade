# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 6, 2026-10-05)

- Rama `carril/implementacion-b` sobre la base `5e168ba` de `origin/main`
  (sin cambios durante la ronda), publicada en origin con el token del
  responsable. Ramas ajenas en origin: `carril/pulimiento-a`, `carril/pulimiento-b`
  (THEME-1/2/3 entregado en su rama), `carril/seguridad-a` (fuzzing, SEC-8) y
  `carril/seguridad-b` (CI, dependencias). `carril/implementacion-a` sigue sin
  publicar.
- Rondas 1-4 ENTREGADAS: análisis de incidente multi-alerta
  (`analyst:ask-incident`), streaming nativo del analista (`analyst:delta`),
  «Ciclo de vida por táctica» + «Evolución del riesgo por equipo», rejilla
  hora × día (VIZ-2) y exportación de gráficas (VIZ-6).
- Coordinación vigente: la fila «Console» de `docs/ARCHITECTURE.md` es de
  PUL-A; `globals.css`/`layout.tsx`/`shell.tsx`/`entity-graph.tsx` son de
  PUL-B mientras aterrice su tema — mis gráficas solo consumen tokens, así que
  no los toco.

## En curso esta ronda (ENTREGADAS)

- **VIZ-3 «Flujo del triaje»**: `lib/triage-flow.ts` (+15 pruebas; plegado
  «Otras fuentes/tácticas», invariantes de suma, triples exactas) +
  `charts/triage-flow.tsx` (sankey compacto: escala única, cintas neutras,
  tooltip, teclado, sin animación) + panel a ancho completo en el dashboard.
  El «falso positivo» no se dibuja: la API solo publica `new`/`acknowledged`/
  `closed`; el pie del panel lo declara (propuesta a IMP-A: campo de decisión).
- **VIZ-1 «Donuts»** (parcial por diseño): `lib/donut.ts` (+10 pruebas) +
  `charts/donut.tsx` compartido + paneles «Alertas por táctica», «Alertas por
  fuente» y «Flota por estado» (`GET /api/fleet`). Tope real de la paleta
  validada: 4 nombradas + «Otros», con desglose completo sin plegar en el
  gemelo de tabla. Pendiente el donut de hallazgos de AD (AD-2, IMP-A) y dos
  tonos categóricos nuevos si el producto quiere 6 nombradas (PUL-B).

## Siguientes (por qué)

1. **Informe de ruido (§2.4)**: pende de `GET /api/noise?window=24h`
   (Implementación A, no está en OpenAPI: 26 rutas verificadas). Cuando
   aterrice, pestaña de Detección con «añadir a software conocido» y «crear
   supresión».
2. **AD-5/AD-6 (pantallas)**: penden de la API AD de A (AD-1/AD-2). El donut
   de hallazgos de AD (VIZ-1) entra con AD-2.
3. **SET-3 «Estado de la plataforma»**: a la espera de que la API publique
   certificados por caducar y último informe programado.
4. **VIZ-4 tendencias/minigráficas**: necesita series históricas (del cliente
   con más paciencia o de A con endpoint de series).
5. **VIZ-5 mapa de la flota**: pende de grupos/sedes (fase C de escala).

## Decisiones de carrera registradas

- El hub (`web/console-service`) se trata como parte del flujo de la
  consola cuando el cambio es del flujo Analista IA; el motor Go y su API
  siguen siendo de Implementación A.
- **Datos observados ≠ datos inventados** (ronda 3, vigente; extendida en la 6):
  el flujo no dibuja estados que la API no publica y los donuts no crean
  porciones para cubos vacíos; lo que falta se declara en el pie del panel.
- **Paleta categórica cerrada** (ronda 6): cuatro tonos validados + «Otros»
  (`--series-1..4`, `--series-other`); los donuts nombran 4 y plegan; el
  desglose completo vive en la tabla gemela. Ampliar la paleta es de PUL-B.
- **Exportaciones generadas en cliente** (ronda 4, vigente): CSV/SVG/PNG desde
  el marco común `ChartCard`; un «informe completo del dashboard» es REP-1/4
  con A, no un exportador cliente más grande.
- **El fetch de la rejilla VIZ-2 es independiente del búfer vivo de triage**
  (ronda 4, vigente): MAX_ALERTS=128 es un búfer de triaje; VIZ-2 y ahora
  VIZ-3/VIZ-1 lo declaran en el pie.
- Sin kill-switch de streaming (ronda 2, vigente): el fallback JSON ya degrada
  con proveedores sin streaming.

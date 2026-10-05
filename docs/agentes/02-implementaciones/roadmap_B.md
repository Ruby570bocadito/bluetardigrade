# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 7, 2026-10-05)

- Rama `carril/implementacion-b` sobre la base `5e168ba` de `origin/main`
  (sin cambios durante la ronda), publicada en origin con el token del
  responsable. Las seis ramas de carril existen ya en origin:
  `carril/implementacion-a` publicó SIM-1/SIM-2 y planificó SIM-4;
  `carril/pulimiento-a/b` y `carril/seguridad-a/b` con sus rondas cerradas.
- Rondas 1-6 ENTREGADAS: análisis de incidente multi-alerta
  (`analyst:ask-incident`), streaming nativo del analista (`analyst:delta`),
  «Ciclo de vida por táctica» + «Evolución del riesgo por equipo», rejilla
  hora × día (VIZ-2), exportación de gráficas (VIZ-6), «Flujo del triaje»
  (VIZ-3) y donuts (VIZ-1).
- **Ronda 7 ENTREGADA: SET-3 «Estado de la plataforma»** — vista `estado`
  con seis secciones espejo de `/api/stats`, libra `lib/platform-status.ts`
  (+19 pruebas) y relé del hub ampliado (elastic/splunk/notify).
- Coordinación vigente: la fila «Console» de `docs/ARCHITECTURE.md` es de
  PUL-A; `globals.css`/`layout.tsx`/`entity-graph.tsx` son de PUL-B mientras
  aterrice su tema — mis vistas solo consumen tokens, así que no los toco.
  PUL-B migrará los 2 `blue-*` de `dashboard.tsx` al fusionar mi rama.

## Siguientes (por qué)

1. **Informe de ruido (§2.4)**: pende de `GET /api/noise?window=24h`
   (Implementación A, no está en OpenAPI: 26 rutas verificadas). Cuando
   aterrice, pestaña de Detección con «añadir a software conocido» y «crear
   supresión».
2. **AD-5/AD-6 (pantallas)**: penden de la API AD de A (AD-1/AD-2). El donut
   de hallazgos de AD (VIZ-1) entra con AD-2.
3. **VIZ-4 tendencias**: sparkline y delta por lectura ya existen en las
   KPI; el «periodo anterior» real necesita series históricas del almacén
   (endpoint de series de IMP-A).
4. **TEAM-4/TEAM-5**: presencia («en línea ahora») y feed de actividad del
   equipo necesitan superficies de sesión/auditoría más ricas que la audit
   JSONL de respuesta activa.
5. **SET-3 cierre sin «parcial»**: pide a IMP-A latencias, tamaño del
   almacén en bytes, versión, certificados por caducar y último informe
   programado; el pie de la vista declara su ausencia hoy.
6. **VIZ-5 mapa de la flota**: pende de grupos/sedes (fase C de escala).

## Decisiones de carrera registradas

- El hub (`web/console-service`) se trata como parte del flujo de la
  consola cuando el cambio es del flujo del Analista IA **y para el relé de
  datos de la consola** (ronda 7: sinks SIEM y canales de notificación,
  sanitizado en el puente); el motor Go y su API siguen siendo de
  Implementación A.
- **Datos observados ≠ datos inventados** (ronda 3, vigente; extendida en la
  7): el flujo no dibuja estados que la API no publica, los donuts no crean
  porciones para cubos vacíos y la página de estado marca «no publicado» lo
  que `/api/stats` no trae — **nunca 0**.
- **Capacidad solo con tope real** (ronda 7): los medidores de la página de
  estado aparecen únicamente cuando el motor publica un cap
  (`correlator_cap`, `beacons_cap`), con ámbar al 80 %; sin caps inventados.
- **Paleta categórica cerrada** (ronda 6): cuatro tonos validados + «Otros»
  (`--series-1..4`, `--series-other`); los donuts nombran 4 y plegan; el
  desglose completo vive en la tabla gemela. Ampliar la paleta es de PUL-B.
- **Exportaciones generadas en cliente** (ronda 4, vigente): CSV/SVG/PNG
  desde el marco común `ChartCard`; un «informe completo del dashboard» es
  REP-1/4 con A, no un exportador cliente más grande.
- **El fetch de la rejilla VIZ-2 es independiente del búfer vivo de
  triage** (ronda 4, vigente): MAX_ALERTS=128 es un búfer de triaje; VIZ-2
  y VIZ-3/VIZ-1 lo declaran en el pie. La página de estado consume
  `/api/stats` (mismo carril de lecturas que los chips de cabecera).
- Sin kill-switch de streaming (ronda 2, vigente): el fallback JSON ya
  degrada con proveedores sin streaming.

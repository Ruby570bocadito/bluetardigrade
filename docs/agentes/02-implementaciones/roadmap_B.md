# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 4, 2026-10-05)

- Rama `carril/implementacion-b` sobre la base `5e168ba` de `origin/main`
  (sin cambios durante la ronda) y publicada en origin con el token del
  responsable. Ramas ajenas en origin: `carril/pulimiento-a` (docs; su
  plan 12h36 sigue abierto) y `carril/seguridad-b` (CI, go.mod, hub
  `http-ui.ts`, modelo de amenazas). IMP-A y PUL-B sin rama publicada.
- **Fuente de tareas localizada:** el `TODO.md` y `docs/PLAN-DETALLADO.md`
  reales viven en `origin/feat/enrollment` (18 commits por delante de
  `main`, nada exclusivo en `main`), localizado por SEG-B en su informe
  12h33. Mis identificadores de carril: VIZ-1..6, AD-5/AD-6 (pantalla),
  REP-3/REP-4, SET-1/SET-3, TEAM-3/4/5/6 (vistas), IDEA-3/5/10/11/12,
  informe de ruido (§2.4) y «Forense: vista propia».
- Rondas 1-3 ENTREGADAS: análisis de incidente multi-alerta
  (`analyst:ask-incident`), streaming nativo del proveedor en el analista
  (`analyst:delta` en vivo), «Ciclo de vida por táctica» y «Evolución del
  riesgo por equipo» (con deuda de docs saldada).
- Coordinación con PUL-A cerrada: la fila «Console» de
  `docs/ARCHITECTURE.md` es de Pulimiento A (su commit bac6b02 es
  anterior); no la toco de nuevo y prevalece su edición al fusionar.

## En curso esta ronda (ENTREGADAS)

- **VIZ-2 «Carga de alertas por hora y día»**: rejilla lunes..domingo ×
  0-23 horas locales de los últimos 7 días en el dashboard. Lib pura
  `lib/alert-heatmap.ts` (+15 pruebas; ventana exacta, fuera-de-ventana y
  fechas ilegibles contadas, nunca inventadas) + componente
  `charts/week-hour-heatmap.tsx` (tabla real, rampa secuencial, tooltip,
  totales por día) + hook dedicado `useAlertWindow` (una petición
  `/api/alerts?since=<inicio de ventana>&limit=1000` con `since` igual al
  inicio exacto de la rejilla; refresco cada 5 min y botón; error honesto).
  Variantes «inicios de sesión» y «eventos por equipo» fuera hasta que
  existan sus datos (AD-3/WEF; búfer de eventos insuficiente).
- **VIZ-6 «Exportar cualquier gráfica»**: menú «Exportar» en el marco
  común `ChartCard` — CSV desde el gemelo de tabla (RFC 4180 + BOM),
  SVG con estilos computados incrustados y PNG a 2× sobre el fondo real
  del panel. Lib pura `lib/chart-export.ts` (+7 pruebas); disponibilidad
  leída del DOM al abrir; teclado completo y errores en español. Todos
  los paneles con `ChartCard` la heredan sin tocar cada gráfica.

## Siguientes (por qué)

1. **VIZ-3 «Flujo del triaje»** (fuente → táctica → estado): mismo dato de
   alertas que ya consumo; cierre visual del recorrido de triage.
2. **Informe de ruido (§2.4)**: pende de `GET /api/noise?window=24h`
   (Implementación A, no está en OpenAPI: 26 rutas verificadas). Cuando
   aterrice, pestaña de Detección con «añadir a software conocido» y
   «crear supresión».
3. **AD-5/AD-6 (pantallas)**: penden de la API AD de A (AD-1/AD-2). SET-3
   «Estado de la plataforma» a la espera de que la API publique
   certificados por caducar y último informe programado.
4. **VIZ-4 tendencias/minigráficas**: necesita series históricas (del
   cliente con más paciencia o de A con endpoint de series).

## Decisiones de carrera registradas

- El hub (`web/console-service`) se trata como parte del flujo de la
  consola cuando el cambio es del flujo Analista IA; el motor Go y su API
  siguen siendo de Implementación A.
- **El fetch de la rejilla VIZ-2 es independiente del búfer vivo de
  triage**: MAX_ALERTS=128 es un búfer de triage, no una semana de
  historial; el panel pide su propia ventana acotada y declara tope,
  cobertura y zona horaria en el pie. Sin `-store` el motor sirve el
  anillo (1000) y el panel lo dice; propuesto a A un campo
  `truncated`/`available` explícito (MEDIA, informe de ronda 4).
- **Exportaciones generadas en cliente** (CSV/SVG/PNG) sin endpoints
  nuevos; si el producto quiere «informe completo del dashboard», eso es
  REP-1/REP-4 con A, no un exportador cliente más grande.
- Sin kill-switch de streaming (ronda 2, sigue vigente): el fallback JSON
  ya degrada con proveedores sin streaming.
- Riesgo observado ≠ riesgo inventado (ronda 3, vigente): el histórico de
  riesgo vive solo en el cliente y nunca interpola huecos.

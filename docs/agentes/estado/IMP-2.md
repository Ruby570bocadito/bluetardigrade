# IMP-2 — estado

## Hecho (últimas 24 h)
- i18n-fechas en main (8c83ccb): las fechas de formatTime/formatDateTime
  viajan con el idioma en las vistas barridas — alerts (lista, aria de
  selección, detalle, triaje y asignación), directory (filas de
  sincronía y subtítulo de postura), intel, fleet (índice, línea de
  tiempo y ficha del sensor) y playbook (evidencia y cronología). De
  paso, 11 toLocaleString('es-ES') duros de directory pasan a localeOf
  (exportada desde console-types): la consola en EN deja de imprimir
  separador de miles español. baseline-card NO fue tocada: nunca pasó
  por IDEA-10, su barrido completo va en Propuestas.
- i18n-noc-mode en main (98ae51f): NOC sin español duro — sevLabels del
  dict (SEVERITY_LABEL dada de baja) y tácticas de las gráficas
  compartidas attack-matrix/heatmap desde el dict (tacticsShort nuevo;
  aria/title del heatmap traducidos). Panel y reglas heredan el fix.
- yara-status-poll en main (f42dd8d): poll de /api/yara a nivel de la
  vista Equipos + refresco fallido nombrado en la fila «Lote YARA».
- Suite al cierre de cada entrega: 603 tests, tsc, next build, tema,
  DOM, navegador 23/23, a11y 20/20 y motion, en verde.

## En curso
- (nada)

## Bloqueado
- ad7-login-consola sigue esperando la sesión de diseño con DIR (proxy
  exige principal; ruta pre-sesión).

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- Barrido i18n completo de baseline-card (títulos, estados, filtrado y
  baselineStatus en lib/intel, todo en español) + sus fechas.
- Cola i18n restante: donut de tácticas del panel (tactic.short) y
  buildTriageFlow (labels españoles a nivel de módulo) — pasan el dict
  por parámetro (cambio de firma en lib).
- Fechas/números con idioma en el resto de vistas barridas que faltan:
  noc, dashboard, incidents, respond, forense, onboarding, live-feed.
- Filtro de asignación en `GET /api/alerts/search` + lente en URL.

## Estado: VERDE
- Suite local completa en verde antes de cada push.

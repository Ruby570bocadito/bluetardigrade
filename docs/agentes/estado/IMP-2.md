# IMP-2 — estado

## Hecho (últimas 24 h)
- i18n-baseline en main (4574283): la tarjeta «Línea base de procesos»
  habla los dos idiomas — sección baseline nueva en los dicts (títulos,
  estados, filtrado, error 404) y baselineStatus (lib/intel) acepta
  palabras tipadas con copia ES por defecto, el mismo precedente de
  enrollmentPlan/runModeText; test nuevo fija la redacción EN. Suite:
  604 tests, tsc, next build, tema, DOM, navegador 23/23, a11y 20/20 y
  motion, en verde.
- i18n-fechas en main (8c83ccb): fechas con idioma en alerts, directory,
  intel, fleet y playbook + 11 toLocaleString('es-ES') de directory a
  localeOf (exportada en console-types).
- i18n-noc-mode en main (98ae51f): NOC sin español duro — sevLabels del
  dict (SEVERITY_LABEL dada de baja) y tácticas de attack-matrix/
  heatmap desde el dict (tacticsShort nuevo; aria/title traducidos).
- yara-status-poll en main (f42dd8d): poll de /api/yara a nivel de la
  vista Equipos + refresco fallido nombrado en la fila «Lote YARA».

## En curso
- (nada)

## Bloqueado
- ad7-login-consola sigue esperando la sesión de diseño con DIR (proxy
  exige principal; ruta pre-sesión).

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- Cola i18n restante: donut de tácticas del panel (tactic.short) y
  buildTriageFlow (labels españoles de módulo) — dict por parámetro.
- Fechas/números con idioma en el resto de vistas barridas: noc,
  dashboard, incidents, respond, forense, onboarding, live-feed.
- Filtro de asignación en `GET /api/alerts/search` + lente en URL.

## Estado: VERDE
- Suite local completa en verde antes de cada push.

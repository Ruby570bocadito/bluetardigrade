# IMP-2 — estado

## Hecho (últimas 24 h)
- F5 kit-resto-vistas en main (fc8e478..f570245) y C-5 en main (a038aa3):
  kit POL-7 en las siete vistas restantes y aviso honesto de sensores
  desactualizados en Equipos (versiones latido vs motor). CI verde.
- IDEA-10 fases 6 y 7 en main (ce5f579, a8b15ef): Panel de operaciones
  y Directorio activo bilingües — dashboard completo, héroe del triaje,
  KPI, cámara compartida de gráficas, conector/postura/hallazgos y
  explorador del snapshot leen del diccionario ES/EN tipado. ES
  byte-idéntico (batería DOM y pines de fase en el test de paridad),
  EN traducción real. El texto del motor sigue literal. pipelineIssues
  estructurado; weekHourTableRows/severityEntries/uacFlagLabels con
  etiquetas opcionales (por defecto las publicadas). 585 tests, tsc,
  build y batería DOM en verde; changelog.d/console-idea10-{panel,
  directorio}.md.

## En curso
- Carril IDEA-10: siguiente hornada validación (scenario-view +
  rule-tester), luego resto de vistas.

## Bloqueado
- (nada)

## Peticiones a otras zonas
- (ninguna; el ST1003 de IMP-1 quedó resuelto en fd29623)

## Propuestas para el roadmap
- Login de dominio en la consola: AD-7 aterrizó con «contrato
  declarado para IMP-2» (POST /api/auth/domain); propongo la hornada
  de consola cuando DIR la dé de alta.
- Temas extra en Ajustes (resto de F5: alto contraste y paletas):
  la pieza de consola es mía, pero los guards check_console_theme.py
  y check_console_a11y.mjs viven en scripts/ (zona IMP-1); si DIR la
  da de alta, IMP-1 extiende los guards a la nueva variante.
- eventDetail (lib/console-types) sigue en español y lo muestran el
  panel y el flujo en vivo; propongo barrerlo en la hornada de flujo.
## Estado: VERDE
- Suite local completa en verde antes de cada push.

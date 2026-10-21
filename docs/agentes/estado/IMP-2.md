# IMP-2 — estado

## Hecho (últimas 24 h)
- F5, hornada kit-resto-vistas en main (fc8e478..f570245): Incidentes,
  Equipos, Directorio, Informes, Supresiones, Intel y Ruido montan sus
  controles sobre el kit POL-7. CI de consola verde.
- C-5 en main (a038aa3): aviso de sensores desactualizados en Equipos,
  comparación honesta de versiones latido vs motor. 579 tests, tsc,
  next build.
- IDEA-10 fase 6 en main (ce5f579): el Panel de operaciones bilingüe.
  Dashboard completo, héroe del triaje, mosaicos KPI y la cámara
  compartida de gráficas (ChartCard, grafo de entidades, matriz ATT&CK,
  heatmaps, flujo del triaje) leen del diccionario ES/EN tipado; ES
  byte-idéntico (batería DOM y pines de fase en el test de paridad),
  EN traducción real. pipelineIssues devuelve problemas estructurados
  (id + recuento) y la copia vive en el diccionario; weekHourTableRows
  acepta nombres de día opcionales. 581 tests, tsc, next build y
  batería DOM en verde; changelog.d/console-idea10-panel.md.

## En curso
- Carril IDEA-10: siguientes hornadas directorio y validación
  (scenario-view + rule-tester), luego resto de vistas.

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

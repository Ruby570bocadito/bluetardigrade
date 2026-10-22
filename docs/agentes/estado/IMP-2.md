# IMP-2 — estado

## Hecho (últimas 24 h)
- i18n-noc-mode en main (98ae51f): el NOC deja de colar español — la
  fila de severidad lee alerts.sevLabels (muere SEVERITY_LABEL, sin
  consumidores) y las gráficas compartidas attack-matrix y heatmap
  sacan las tácticas del dict (tacticsShort nuevo para celdas chicas;
  nombre completo en title/aria). El heatmap traduce también sus
  strings duros («Ver alertas de», «N alertas» → charts.heat.hostAria/
  cellTitle). Panel y reglas heredan el fix al compartir gráficas.
  Suite al cierre: 603 tests, tsc, next build, tema, DOM, navegador
  23/23, a11y 20/20 y motion, en verde.
- yara-status-poll en main (f42dd8d): el poll de GET /api/yara subió a
  nivel de la vista Equipos (una petición por minuto cueste lo que
  cueste la flota) y el refresco fallido se nombra en la fila «Lote
  YARA» con la hora del último valor bueno; sin respuesta nunca,
  «no se pudo consultar el lote» y no «el motor no publica lote».
- tema-claro en main (8f823bf, release 02f9b1f), verificada por DIR.

## En curso
- (nada)

## Bloqueado
- ad7-login-consola sigue esperando la sesión de diseño con DIR (proxy
  exige principal; ruta pre-sesión).

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- Cola i18n restante: el donut de tácticas del panel (usa tactic.short)
  y buildTriageFlow (TACTIC_LABEL/TACTIC_FULL/OTHER/NO en español a
  nivel de módulo) siguen con etiquetas duras; necesitan pasar el dict
  por parámetro (cambio de firma en lib).
- Pasar formatTime/formatDateTime con idioma en los call-sites ya
  barridos (alerts, directory, intel, fleet, playbook, baseline).
- Filtro de asignación en `GET /api/alerts/search` + lente en URL.

## Estado: VERDE
- Suite local completa en verde antes de cada push.

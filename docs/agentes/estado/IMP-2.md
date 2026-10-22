# IMP-2 — estado

## Hecho (últimas 24 h)
- yara-status-poll en main (f42dd8d): el poll de GET /api/yara salió de
  SensorCard y vive a nivel de la vista Equipos (una petición al montar
  + una por minuto, cueste lo que cueste la flota; antes cada ficha
  montada disparaba la suya con un intervalo propio — recorrer la flota
  era un walk del directorio de reglas por clic, y el equipo sin
  inventario también pollaba). El refresco que falla ya no se traga en
  silencio: la fila «Lote YARA» conserva el último valor bueno y añade
  «refresco fallido» (la hora de ese valor, al pasar el ratón); si
  nunca llegó respuesta dice «no se pudo consultar el lote» y no «el
  motor no publica lote». Bilingüe (fleet.yara). Suite al cierre: 603
  tests, tsc, next build, check_console_theme, DOM, navegador 23/23,
  a11y 20/20 y motion, en verde.
- tema-claro en main (8f823bf, changelog 0ef1211, release 02f9b1f):
  rampas legibles sobre blanco, sev-media en oro validada CVD, chips de
  código semánticos; verificada por DIR.

## En curso
- (nada)

## Bloqueado
- ad7-login-consola sigue esperando la sesión de diseño con DIR (proxy
  exige principal; ruta pre-sesión).

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- Barrer los últimos SEVERITY_LABEL/ATTACK_TACTICS de noc-mode (el patrón
  quedó listo en rules-view).
- Pasar formatTime/formatDateTime con idioma en los call-sites ya
  barridos (alerts, directory, intel, fleet, playbook, baseline).
- Filtro de asignación en `GET /api/alerts/search` + lente en URL.

## Estado: VERDE
- Suite local completa en verde antes de cada push.

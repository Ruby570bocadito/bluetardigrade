# IMP-2 — estado

## Hecho (últimas 24 h)
- tema-claro en main (8f823bf, changelog.d/console-tema-claro.md, release
  02f9b1f): el tema claro aguanta sobre blanco. Tres rampas que el volteo
  nunca mapeó (yellow del chip «media», rose-300 de sesión denegada,
  amber-100) giran ahora a pasos legibles; la tinta de datos clara deja el
  oliva (sev-medium #ad850c oro real; series-2/4 y status-good un paso más
  vivos; chart-2/4 en tándem), revalidada por check_console_theme con los
  mismos suelos que el oscuro (3:1 datos, CVD dE >= 10 adyacente, paridad).
  Chips de código con superficie semántica .code-chip (tintero por tema)
  en vez del bg-black/40 duro; divisor de shell y resalte de nav activa
  sobre los nuevos --hairline/--inset-highlight; corregido el token
  inexistente --status-ok en Directorio (lee --status-good).
- Suite al cierre: 603 tests, tsc, next build, check_console_theme, DOM,
  navegador 23/23, a11y 20/20 (escanea ambos temas) y motion, en verde.
- Auditoría visual con capturas de las 19 vistas en claro sobre fixtures
  aislados, antes/después (.agent-tmp, no versionado).

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

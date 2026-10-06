# Plan de ronda — Pulimiento B (2026-10-06, 10:50 Madrid, ronda 8 — última de la ventana)

Base: `carril/pulimiento-b` `c2adac6` (ronda 7); `origin/main` sigue en
`35cd866`. Estado leído al abrir: sin pushes nuevos de las otras cinco
ramas desde la lectura de la ronda 7.

## Tareas cogidas

1. **POL-9 apéndice — Best-practices a source maps:** re-inspección del
   informe Lighthouse de la ronda 6 revela que el ítem BP que falla NO
   es el favicon (mi nota de la ronda 6 fue imprecisa: el 404 del
   favicon ni siquiera aparece como auditoría; el `errors-in-console`
   de esa corrida rota sí lo incluía, pero en la corrida limpia los 14
   errores son solo 502 del motor y WebSocket del console-service,
   ausentes en producción real). Los dos ítem BP reales:
   `errors-in-console` (ruido del laboratorio: motor y console-service
   apagados por diseño de la medición) y **`valid-source-maps`**
   (chunks grandes de primera parte sin mapas). Accionable en mi
   carril: `productionBrowserSourceMaps: true` en `next.config.ts` —
   los mapas solo se descargan con DevTools abierto (coste cero en
   runtime), y devuelven trazas simbolizadas cuando algo rompe en el
   navegador de un operador.
2. **Corrección del registro:** README de la consola (párrafo
   Lighthouse) — el 96 de BP se debe a source maps + ruido de
   laboratorio, no al favicon; y verificación de que `/favicon.ico`
   ni siquiera se pide cuando hay `<link rel="icon">` (Next inyecta el
   de `app/icon.svg`).

## No toca

Vistas/lib de IMP-B (su línea absorberá mi ronda 6 con merge limpio);
`ci.yml`/Makefile (PUL-A); `web/console-service` (SEG-B); Go/sensor.

## Coordinación

- Cambio de configuración de la consola (fichero mío desde la ronda 5,
  donde retiré la CSP estática): cabezas de prioridad de headers sin
  cambios; la CSP por nonce del proxy no interfiere con los `.map`
  (los descarga DevTools, no el runtime de la página).
- Batería completa de nuevo tras el cambio de build (el estándar del
  carril: ningún cambio de build sin batería).

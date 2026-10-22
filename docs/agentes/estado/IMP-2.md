# IMP-2 — estado

## Hecho (últimas 24 h)
- IDEA-10 fase 10 en main (f144532): la vista Equipos bilingüe de punta a
  punta — índice de hosts (búsqueda, filtros, tarjetas), página por equipo
  (riesgo, mosaicos, árbol, grafo, línea de tiempo, destinos), resumen de
  flota, ficha de sensor con sus avisos, y el diálogo «Añadir equipos»
  completo (asistente de token, manual, tokens en uso, pendientes,
  revoca). ES byte-idéntico, EN real; secciones hosts/fleet/enroll nuevas.
- runModeText + enrollmentPlan (lib/fleet) y tokenEnrollmentPlan
  (lib/enroll) con palabras opcionales; defaults ES, tests de unidad sin
  mover. El título del incidente por equipo pasa por el dict.
- Rebase sobre 685c952 sin conflictos (tablero DIR, CI PUL, claims
  IMP-1/SEG). 591 tests, tsc y next build en verde.
- Petición de SEG (lifecycle 500→400) verificada ya servida en main
  (fdcd167), nada que hacer.

## En curso
- (nada)

## Bloqueado
- ad7-login-consola espera la sesión de diseño con DIR (proxy exige
  principal; ruta pre-sesión).

## Peticiones a otras zonas
- DIR: TODO.md sigue con el punto IDEA-10 con texto viejo («el panel, el
  directorio, la validación y los ajustes siguen en español» — quedan de
  verdad reglas, ruido, respuesta, flujo, analista y eventDetail).

## Propuestas para el roadmap
- Barrer eventDetail (lib/console-types) junto con la hornada de flujo
  en vivo; lo muestran el panel y la página de equipo.
- Tras la hornada de reglas/ruido/respuesta, las vistas de Detección y
  Equipos quedan completas; queda el chrome de flujo/analista para
  cerrar IDEA-10.
## Estado: VERDE
- Suite local completa en verde antes de cada push.

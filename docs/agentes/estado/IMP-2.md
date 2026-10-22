# IMP-2 — estado

## Hecho (últimas 24 h)
- IDEA-10 fase 10 en main (f144532): vista Equipos bilingüe de punta a
  punta (índice, página por equipo, flota, ficha de sensor, diálogo de
  alta completo). Secciones hosts/fleet/enroll; runModeText,
  enrollmentPlan y tokenEnrollmentPlan con palabras opcionales.
- C-4 en main (59b5b28): vista «Consulta BD» de solo lectura sobre
  POST /api/db/query — formulario SQL con max_rows y presupuesto,
  tabla de resultados, errores literales del motor, g q como atajo,
  ejemplos sobre el esquema real, historial solo en sesión. Cliente
  lib/db-query con tests propios. Nacida bilingüe (dbQuery + nav/views).
- Rebases limpios sobre 685c952 y 31c46a1 (tablero DIR, CI PUL, SEC-9
  de SEG — sin solape de rutas). Suite al cierre: 597 tests, tsc y
  next build en verde.

## En curso
- (nada)

## Bloqueado
- ad7-login-consola espera la sesión de diseño con DIR (proxy exige
  principal; ruta pre-sesión).

## Peticiones a otras zonas
- DIR: el punto IDEA-10 de TODO.md mantiene texto viejo («panel,
  directorio, validación y ajustes siguen en español»); quedan de
  verdad reglas, ruido, respuesta, flujo en vivo, analista y
  eventDetail.

## Propuestas para el roadmap
- Barrer eventDetail (lib/console-types) en la hornada de flujo en
  vivo; lo consumen el panel y la página de equipo.
- PUL (changelog-consolidar-fragmentos, claim activo): mis dos entradas
  nuevas son changelog.d/console-idea10-equipos-flota.md y
  changelog.d/console-c4-consulta-bd.md.
## Estado: VERDE
- Suite local completa en verde antes de cada push.

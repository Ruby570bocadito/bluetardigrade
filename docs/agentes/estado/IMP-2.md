# IMP-2 — estado

## Hecho (últimas 24 h)
- F5, hornada kit-resto-vistas en main (fc8e478..f570245): Incidentes,
  Equipos, Directorio, Informes, Supresiones, Intel y Ruido montan sus
  controles sobre el kit POL-7. El kit gana la variante Button `solid`
  (THEME-2: el relleno de acento que las vistas repetían a mano) y el
  primitivo Textarea; el selector de tipo del explorador AD pasa a
  ConsoleTablist (roving tabindex); las 9 tablas de datos restantes
  usan los primitivos Table con caption propio. Sin cambios de
  comportamiento. Validación: 574 tests, tsc, next build; CI de la
  cabeza verde en consola (hub tests, tsc, next build).
- Claim liberado; entrada changelog.d/console-kit-resto-vistas.md.

## En curso
- C-5, aviso de sensores desactualizados (la versión viaja en el
  latido, S-4 en main): siguiente tarea de mi carril.

## Bloqueado
- (nada)

## Peticiones a otras zonas
- IMP-1: la CI Go de la cabeza (927f069) falla en vet ST1003 dentro de
  las rutas del claim m4-consulta-bd: apiDbQuery → apiDBQuery
  (cmd/engine/flags.go:56 y run_api.go:234) y EnableDbQuery,
  handleDbQuery, auditDbQuery → EnableDBQuery, handleDBQuery,
  auditDBQuery (internal/api/db_query.go:60, 66 y 132). No lo toco:
  rutas bajo tu claim activo.

## Propuestas para el roadmap
- Login de dominio en la consola: AD-7 aterrizó con «contrato
  declarado para IMP-2» (POST /api/auth/domain); propongo la hornada
  de consola (pantalla de login con cuenta del dominio) cuando DIR la
  dé de alta.
- Tema claro (resto de F5): rework de contraste, superficies y
  gráficas como hornada propia del mismo carril.

## Estado: VERDE
- Suite local completa en verde antes de cada push (PROTOCOLO §1.6).

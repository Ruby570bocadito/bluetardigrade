# IMP-2 — estado

## Hecho (últimas 24 h)
- F5, hornada kit-resto-vistas en main (fc8e478..f570245): Incidentes,
  Equipos, Directorio, Informes, Supresiones, Intel y Ruido montan sus
  controles sobre el kit POL-7. El kit gana la variante Button `solid`
  (THEME-2) y el primitivo Textarea; el selector de tipo del
  explorador AD pasa a ConsoleTablist (roving tabindex); las 9 tablas
  de datos restantes usan los primitivos Table con caption propio.
  Sin cambios de comportamiento. CI de consola verde.
- C-5 en main (a038aa3): aviso de sensores desactualizados en Equipos.
  Comparación honesta versión del latido vs versión del motor
  (outdatedSensor/outdatedCount en lib/fleet, con tests); chip ámbar
  en filas y tarjeta del sensor, banda en la ficha con ambas versiones
  y cómo actualizar, recuento en el mosaico del inventario. Sin
  semver inventado; sin dato en cualquiera de las dos partes no hay
  aviso. 579 tests, tsc, next build; CI de consola verde en mi push.
- Claims liberados; changelog.d/console-kit-resto-vistas.md y
  changelog.d/console-sensor-outdated.md.

## En curso
- (nada — las dos tareas del ROADMAP de IMP-2 están cerradas)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- IMP-1: la CI Go falla en vet ST1003 dentro de las rutas del claim
  m4-consulta-bd (persiste en 8b03668): apiDbQuery → apiDBQuery
  (cmd/engine/flags.go:56 y run_api.go:234) y EnableDbQuery,
  handleDbQuery, auditDbQuery → EnableDBQuery, handleDBQuery,
  auditDBQuery (internal/api/db_query.go:60, 66 y 132). No lo toco:
  rutas bajo tu claim activo.

## Propuestas para el roadmap
- Login de dominio en la consola: AD-7 aterrizó con «contrato
  declarado para IMP-2» (POST /api/auth/domain); propongo la hornada
  de consola (login con cuenta del dominio, roles por grupo AD)
  cuando DIR la dé de alta.
- Tema claro (resto de F5): rework de contraste, superficies y
  gráficas como hornada propia del mismo carril; luego temas extra
  por cuenta (alto contraste y paletas).

## Estado: VERDE
- Suite local completa en verde antes de cada push (PROTOCOLO §1.6).

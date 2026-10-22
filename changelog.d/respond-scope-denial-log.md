- **El intento de kill denegado por grupos deja rastro.** En
  `POST /api/respond/kill`, la denegación por scope (una cuenta
  limitada a grupos de equipos que intenta matar un proceso fuera de
  sus grupos) ocurría antes del manager de `internal/respond` — que es
  quien lleva el audit file — y el handler no dejaba ningún
  `log.Printf`: un intento bien formado denegado por autorización en
  la superficie más destructiva del producto no quedaba en el engine
  log ni en ningún otro sitio (el estándar del paquete lo fija
  `db_query.go`, que audita TODAS sus denegaciones). Ahora la rama del
  scope emite la misma línea DENIED que las denegaciones del manager
  (code=host_scope, con pid, operador, host y origen, todo capado por
  `oneLine`); el 403 y su semántica no cambian, y las denegaciones
  estructurales (JSON roto, campos ausentes) siguen sin auditar por
  diseño — no son intentos, son ruido. La integración de denegaciones
  de consola en el audit file del manager queda como propuesta de
  roadmap (requiere que el manager conozca los scopes de consola).

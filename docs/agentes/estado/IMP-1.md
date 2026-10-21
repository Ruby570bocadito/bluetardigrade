# IMP-1 — estado

## Hecho (últimas 24 h)
- **M-2 / AD-7 login de dominio** (a5b477f + 71777db): `POST /api/auth/domain`
  arma con `-domain-auth`; bind LDAPS como el usuario (mismo transporte del
  conector, `dialTLS` extraído sin cambio de comportamiento), búsqueda de la
  entrada propia y memberOf → rol con precedencia admin > analyst > viewer.
  openapi actualizado (`domainLogin`, `DomainLoginVerdict`), ejemplo en
  `domain-auth.example.yaml`, changelog en `changelog.d/domain-login-ad7.md`.
  Tests del paquete y del endpoint contra el fixture LDAP real (binds de
  usuario añadidos al fixture); `go build ./...`, vet y suites de
  internal/ad, internal/api y cmd/engine en verde.
- Sesión: intento de O-2 abortado — el claim llegó 5 min tarde (cerrojo del
  protocolo funcionó: push rechazado, tarea ya reclamada). M-2 hecha en su
  lugar.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- **IMP-2**: integrar el login de dominio en la página de login de la
  consola — llamar a `POST /api/auth/domain` desde el SERVIDOR de la
  consola (el puente ya puntúa el token) y abrir la sesión con el `role`
  devuelto; contrato completo en `docs/api/openapi.yaml` (operación
  `domainLogin`, esquema `DomainLoginVerdict`, razones: credenciales /
  sin_rol / dominio / formato / peticion / bloqueado). Las cuentas locales
  quedan como respaldo: solo se AÑADE la vía de dominio.

## Propuestas para el roadmap
- Resolución de grupos ANIDADOS para AD-7 (LDAP_MATCHING_RULE_IN_CHAIN)
  si algún despliegue usa jerarquías de grupos; hoy solo memberOf directo,
  declarado en la config.
- H-4/F2: probar el login de dominio en Windows real cuando exista la
  integración de consola (mismo lote que las pruebas de login del humano).

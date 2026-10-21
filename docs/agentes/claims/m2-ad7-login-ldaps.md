# claim: m2-ad7-login-ldaps

- ID: IMP-1 (motor Go + sensor Rust)
- Fecha: 2026-10-21 19:25 UTC
- Tarea del ROADMAP: M-2 / AD-7 — login con cuentas del dominio (bind
  LDAPS con las credenciales del propio usuario, grupos de AD → roles de
  consola admin/analyst/viewer); las cuentas locales siguen como respaldo.
- Rutas que voy a tocar (por fichero, para no solapar con el claim
  transversal `f1-aviso-alerta-critica` de SEG):
  - `internal/ad/domainauth.go` + `internal/ad/domainauth_test.go` (nuevos:
    configuración `-domain-auth`, bind del usuario, búsqueda de grupos, mapa
    a roles) y `internal/ad/fixture_test.go` (extensión test-only: binds de
    usuario de dominio)
  - `internal/api/domain_auth.go` + `internal/api/domain_auth_test.go`
    (nuevos: POST /api/auth/domain con contrato JSON y límite por IP) y
    `internal/api/hub.go` (campo + registro de ruta)
  - `cmd/engine/flags.go` y `cmd/engine/run_api.go` SOLO el arranque del
    flag `-domain-auth` (SEG está en f1 sobre cmd/engine/ en general; si
    aparece conflicto, prevalece pull --rebase y resolución conservando
    ambas intenciones)
  - `docs/api/openapi.yaml` (referencia del endpoint; docs/api/ es de IMP-1)
  - `domain-auth.example.yaml` (raíz, ejemplo comentado)
  - `changelog.d/` y `docs/agentes/estado/IMP-1.md` (al cerrar)
- Sin dependencias nuevas (go-ldap ya está en go.mod). AD en solo lectura
  (bind + search), transporte por el camino único TLS del paquete.

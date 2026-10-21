- **Inicio de sesión con cuentas del dominio (AD-7).** El motor arma
  `POST /api/auth/domain` con `-domain-auth <fichero.yaml>`: verifica las
  credenciales del operador con un bind LDAPS **como el usuario** (mismo
  transporte que el conector de solo lectura: CA de la organización,
  nombre de servidor fijado, suelo TLS 1.2) y resuelve el rol de consola
  (admin/analyst/viewer) por los grupos AD del usuario, con precedencia
  admin > analyst > viewer. No hace falta cuenta de servicio para el
  login: el usuario autenticado se lee su propia entrada (memberOf, solo
  bind y búsqueda, AD en solo lectura intacta). Contrato completo en
  `docs/api/openapi.yaml` (`domainLogin`, esquema `DomainLoginVerdict`)
  y ejemplo comentado en `domain-auth.example.yaml`; las cuentas locales
  de la consola siguen como respaldo y no cambian. La integración en la
  página de login de la consola (llamada desde el servidor de la consola
  y opción en el formulario) queda para IMP-2 con el contrato ya
  publicado; los grupos anidados (pertenencia indirecta) no se resuelven,
  declarado en la configuración.

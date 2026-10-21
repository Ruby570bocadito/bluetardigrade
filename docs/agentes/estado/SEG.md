# SEG — estado

## Hecho (últimas 24 h)
- Ronda 1 v2: auditoría transversal y las dos tareas del ROADMAP de SEG
  cerradas (ALTA F1 y SEC-3), más un fix nuevo de la revisión.
- fix(security): los cinco sumideros salientes que envían evidencia y
  credenciales (webhook SIEM, Slack/Telegram, Elasticsearch, Splunk,
  reputation) seguían redirects por defecto — hasta 10 saltos con posible
  bajada a http; x-apikey/Key viajan en cabeceras que Go no limpia entre
  hosts. Ahora entregan la 3xx sin seguirla (patrón ErrUseLastResponse que
  ya usaban actions/doctor/report); la 3xx cuenta como fallo definitivo en
  los contadores existentes. Test de regresión por paquete; suite completa
  en verde (41 paquetes Go, 555 consola, 108 hub; npm audit runtime 0;
  govulncheck 0 alcanzables).
- F1 verificado y cerrado: vías navegador y consola correctas en código y
  tests (campana desactivada por diseño, estados de permiso honestos); vía
  externa reproducida e2e con smoke_notify.sh (8 ok / 0 FAIL); el launcher
  ya pasa -notify (runtime.ps1). Entrega real correo/Telegram: sigue en
  «Esperando al humano» (Windows).
- SEC-3 verificada y cerrada: descargas sin traversal (nombres generados en
  servidor, IDs 16-hex, csvSafe), URLs de integraciones solo http/https,
  dangerouslySetInnerHTML solo en los 2 scripts boot estáticos con nonce.
  Revisado sin hallazgos: auth de motor y consola (PBKDF2, TOTP, sesiones,
  scope, anti-rebinding), proxy consola→motor, QR, reactbits (sin red),
  secretos en HEAD (limpio: solo valores de laboratorio), braces con ignore
  vigente hasta 2026-11-05.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- (ninguna; la entrada de changelog.d/ del fix viaja en mi commit, según la
  convención del ritual)

## Propuestas para el roadmap
- (SEG) sec9-privacidad — minimizar PII en inicios de sesión y líneas de
  tiempo, retención configurable, auditoría de quién consulta fichas.
- (SEG) sec2-dpapi — requiere Windows real; plan conjunto con
  Implementación A cuando haya entorno de pruebas.
- Detectado sin corregir (baja, sin credenciales en juego): apiHealthy
  (cmd/engine/runtime.go) y el cliente de escenarios mantienen la política
  de redirects por defecto; unificar si se tocan.

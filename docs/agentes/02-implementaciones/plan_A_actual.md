# Plan de ronda — Implementación A (2026-10-05 16h05)

1. **AD-1** conector LDAP de solo lectura (`internal/ad`, tablas AD en `internal/store`,
   flag `-ad`, API `GET /api/ad/*` en `internal/api/ad.go`, OpenAPI, tests con fixture
   LDAP en loopback): LDAPS/StartTLS obligatorio, cuenta sin privilegios, contraseña en
   fichero aparte, paginación RFC 2696, tope de objetos, escape RFC 4515.
2. **AD-2** postura del dominio (`internal/ad/posture.go`, `GET /api/ad/posture`):
   hallazgos del TODO con severidad, objetos y remediación + puntuación 0-100.
3. **SET-3 lado motor** (campos de `/api/stats` que la vista de IMP-B declara ausentes):
   latencia ingesta→alerta, tamaño del almacén, versión del motor y caducidad de
   certificados API/ingesta. Añadida la fila `-scenarios` en `docs/OPERATIONS.md`
   (petición registrada por Pulimiento A).

Sin solape: IMP-B (pantallas), PUL-A (fuzzing nocturno, POL-1 api.go tras mi fusión),
PUL-B (tema), SEG-A/B (auditan este conector cuando se fusione; dependencia nueva
justificada en el informe).

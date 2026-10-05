# Auditoría del protocolo de alta de equipos (ENROLL)

Fecha: 2026-10-05. Carril: Seguridad B (SEC-1, SEC-2, SEC-4).

Revisión línea a línea del alta de equipos publicado en
`feat/enrollment` (5908107): registro y canje (`internal/enroll`),
handshake de ingesta, superficie HTTP, sensor y lanzador Windows.
Resultado: sin hallazgos accionables nuevos; cada mitigación de la
sección 2 del modelo de amenazas queda verificada contra el código
(secreto de 256 bits con crypto/rand, solo digests SHA-256 en reposo con
escritura atómica a 0600, canje único atómico, ENROLL solo por TLS o
loopback, conflicto de nombre nunca auto-aprobado, revocación que corta
conexiones vivas, token de alta borrado del sensor tras canje y jamás en
argv). Residuo ya asignado: DPAPI/ACL fina de la credencial en reposo
(SEC-2, Implementación A).

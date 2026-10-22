# IMP-1 — estado

## Hecho (últimas 24 h)

Sesión m3-yara-motor (cerrada, main 646869b): pack YARA del motor
completo — internal/yara, /api/yara, fleet, -yara-rules, OpenAPI, changelog.

Sesión H-003+H-004+H-006 (128e74b/1507de6/9f013cb): hornada de los
tres hallazgos BAJO de TEST ronda 1: contador de línea sobredimensionada
en fase de datos del ingest, diagnóstico explícito de tope en db/query
(sigue 400) y sev como alias validado de severity (OpenAPI incluido),
más el bloque unassigned triplicado retirado de parseRecordFilter.
Marcados resuelto-pendiente-verificación; TEST cierra.

Sesión m7-wef-pack (f752040): la mitad motor de M-7. Contrato
windows.event definido y documentado en la sección «Entrega al motor»
de AD-WEF-SUSCRIPCION.md (el hueco que la guía reservaba para M-7;
edición aditiva, a revisión de DIR/PUL): host = equipo origen, id
estable 32-hex, campos win_* por ID. Pack rules/windows/wef-security.yaml
(4 reglas: DCSync 4662 critical, Kerberoasting RC4 4769, grupo
privilegiado 4728/4732/4756, servicio 7045 con intérprete o ruta
escribible) + umbral thr-ad-spray (4625, 25/5m por IP). Escenarios
sim-wef-* para las 4 (knownTypes gana windows.event). Inventario
regenerado: 123 reglas, 13 tipos. CI verde (gofmt, vet, staticcheck,
test -race, 42 ok, guards OpenAPI/inventario OK).

## En curso
- (nada)

## Bloqueado
- Distribución firmada a sensores: espera E-1 (visto bueno del humano).
- s2-yara-memoria: decisión de atribución PID pendiente (DIR).

## Peticiones
- PUL: la cifra de reglas 119 pasa a 123 (4 del pack WEF); mismos
  sitios que barrió en H-002 (README, OPERATIONS, ARCHITECTURE,
  INSTALACION-Y-ESTADO-SOC). El bloque del inventario ya lo
  regeneré yo con su guard.

## Propuestas para el roadmap
- Doctor: chequeo del directorio -yara-rules (como doctor_intel).
- Consola: desfase del lote (sha de /api/fleet contra /api/yara).

## Siguiente
- pol1c-collector: evaluar si aplica el análogo POL-1 a
  sensor/src/collector.rs (479 líneas); fragmentar solo si no es churn.

## Estado: VERDE — riesgos
- Sin solapes: DIR (9ª pasada) y SEG (ronda 6) no pisaron mis rutas.

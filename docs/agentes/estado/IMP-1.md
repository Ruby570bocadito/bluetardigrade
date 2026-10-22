# IMP-1 — estado

## Hecho (últimas 24 h)

Sesión m3-yara-motor (cerrada, main 646869b): pack YARA del motor completo.

Sesión H-003/H-004/H-006 (128e74b/1507de6/9f013cb): los tres hallazgos
BAJO de TEST ronda 1: contador de línea sobredimensionada en fase de
datos del ingest, diagnóstico explícito de tope en db/query (sigue 400)
y sev como alias validado de severity, más el bloque unassigned
triplicado fuera de parseRecordFilter. Resuelto-pendiente-verificación;
TEST cierra.

Sesión m7-wef-pack (f752040): la mitad motor de M-7. Contrato
windows.event definido en «Entrega al motor» de AD-WEF-SUSCRIPCION.md
(el hueco que la guía reservaba a M-7; aditivo, a revisión de DIR/PUL):
host = equipo origen, id estable 32-hex, campos win_* por ID. Pack
rules/windows/wef-security.yaml (DCSync 4662 critical, Kerberoasting
RC4 4769, grupo privilegiado 4728/4732/4756, servicio 7045 con
intérprete o ruta escribible), umbral thr-ad-spray (4625) y escenarios
sim-wef-*. Inventario regenerado: 123 reglas, 13 tipos. CI verde.

## En curso
- (nada)

## Bloqueado
- s2-yara-memoria: decisión de atribución PID pendiente (DIR).

## Peticiones
- PUL: la cifra 119 pasa a 123 (mismos sitios que barrió en H-002);
  el bloque del inventario ya lo regeneré con su guard.

## Propuestas para el roadmap
- Doctor: chequeo del directorio -yara-rules (como doctor_intel).
- Consola: desfase del lote (sha de /api/fleet contra /api/yara).

## Siguiente
- pol1c-collector: evaluar si aplica el análogo POL-1 a collector.rs.

## Estado: VERDE — riesgos
- Sin solapes: DIR (9ª pasada) y SEG (ronda 6) no pisaron mis rutas.

# IMP-1 — estado

## Hecho (últimas 24 h)

Sesión m3-yara-motor (cerrada, main 646869b): pack YARA del motor
completo — internal/yara, /api/yara + bundle, fleet yara_rules(_sha),
-yara-rules, OpenAPI + referencia, changelog. CI verde.

Sesión H-003+H-004+H-006 (cabeza ef5ddbd): hornada de los tres
hallazgos BAJO de TEST ronda 1 dirigidos a IMP-1:
- H-003 (128e74b): la línea sobredimensionada en fase de datos del
  ingest cuenta como ingest_rejected y ackea la causa antes de
  cerrar; los errores de lectura corrientes siguen sin contar.
- H-004 (1507de6): db/query sobre los 64 KiB responde el diagnóstico
  explícito de tope (patrón assign); sigue 400 como documenta el
  OpenAPI; JSON pequeño malformado conserva su mensaje.
- H-006 (9f013cb): sev = alias validado de severity (mismo enum, 400
  con los válidos, unión si llegan ambos), OpenAPI documentado; de
  paso parseRecordFilter pierde el bloque unassigned triplicado.
- Los tres marcados resuelto-pendiente-verificación (TEST cierra).
- CI local verde: gofmt, vet, staticcheck x2, test -race (42 ok).

## En curso
- (nada)

## Bloqueado
- Distribución firmada a sensores: espera E-1 (visto bueno del humano).

## Peticiones
- (ninguna)

## Propuestas para el roadmap
- Doctor: chequeo del directorio -yara-rules (como doctor_intel).
- Consola: desfase del lote (sha de /api/fleet contra /api/yara).

## Siguiente
- m7-wef-pack — pack AD por ID de evento (4625/4769/4662/4728/4732/
  4756/7045); guía en docs/AD-WEF-SUSCRIPCION.md.

## Estado: VERDE — riesgos
- Sin solapes: IMP-2 cerró idea10 y tomó H-005 (rutas web/ y docs/);
  internal/ y docs/api/ quedaron libres toda la sesión.

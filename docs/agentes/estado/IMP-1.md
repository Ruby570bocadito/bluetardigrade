# IMP-1 — estado

## Hecho (últimas 24 h)

Sesión m3-yara-motor (cerrada, main 646869b):
- internal/yara: el lote del operario con la huella de contenido que
  compila el sensor (rel+NUL+contenido ordenado, sha256 a 16 hex;
  vectores dorados fijados en tests), versión del bundle.json, problems
  (no UTF-8, ilegibles) y zip determinista con tope de 32 MiB; recarga
  perezosa como intel (solo cuando cambia el directorio).
- API: GET /api/yara (estado) y GET /api/yara/bundle (zip
  yara-bundle-<sha16>.zip); 404 con lote vacío, 413 sobre el tope.
- Fleet: yara_rules y yara_rules_sha por sensor en /api/fleet; la
  llegada del lote es comparar el sha del latido con el sha16 del motor
  (yara_errors>0 = fichero que el sensor no pudo compilar).
- cmd/engine: -yara-rules (./yara-rules; vacío desactiva) con loadYara
  en run_yara.go nuevo (run_load.go estaba en el claim de SEG).
- OpenAPI + referencia regenerada; changelog.d/engine-yara-distribution.
- CI local en verde: gofmt, vet, staticcheck (2 pases), test -race
  ./... (42 paquetes); sin dependencias nuevas.

## En curso
- (nada)

## Bloqueado
- Distribución firmada a sensores: espera E-1 (visto bueno del humano).

## Peticiones
- (ninguna)

## Propuestas para el roadmap
- Doctor: chequeo del directorio -yara-rules (como doctor_intel).
- Consola: desfase del lote (sha de /api/fleet contra /api/yara).

## Cola (hallazgos BAJO de TEST ronda 1 dirigidos a IMP-1)
- H-003 ingest: línea sobredimensionada sin contador.
- H-004 db query: cuerpo grande con diagnóstico engañoso.
- H-006 filtro de severidad desconocida silencioso.

## Estado: VERDE — riesgos
- Sin solapes: SEG (run_load.go) e IMP-2 (web/) no pisaron mis rutas.

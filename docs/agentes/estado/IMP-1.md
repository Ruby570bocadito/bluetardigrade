# IMP-1 — estado

## Hecho (últimas 24 h)

Sesiones cerradas y verificadas: m3-yara-motor (646869b), H-003/H-004/
H-006, m7-wef-pack (f752040), pol1c-collector (d938c65, POL-1
completo) y doctor-yara-check (3d8121d).

Sesión reglas-interpretes-envueltos (96ad54b): mi propuesta del
tablero aterrizada. Dos reglas en lolbas.yaml (0009/0010): «Intérprete
renombrado por su gramática de argumentos» (high: nombre fuera de los
intérpretes canónicos + gramática — -EncodedCommand, blob tras -enc
con mínimo anti -Encoding, vbscript:/javascript:, python -c import) y
«Binario con nombre propio lanzando un intérprete encubierto»
(medium: el wrapper.exe -> powershell -enc por el padre — parent_name
presente + not_in de lanzadores canónicos; navegadores y Office
excluidos para no duplicar). Inventario 123→125 (contador + bloque de
OPERATIONS vía guard); dos escenarios sim nuevos (SIM-2); tests de
regla por presencia (co-fuego legítimo, documentado). CI verde:
fmt/build/vet/staticcheck, test -race ./..., inventario y API ref.

## Bloqueado
- (nada: s2-yara-memoria DESBLOQUEADA por DIR — escaneo por proceso).

## Peticiones
- PUL: tercera deriva de la cifra — 123 pasa a 125 en la prosa
  (mismos sitios que su ronda 3; el bloque del inventario ya lo
  regeneré con el guard).
- SEG (tabs→espacios): volvió a saltar con mi Edit en rules_test.go;
  detectado por el tamaño del diff y corregido con gofmt -w antes de
  entregar — el churn no llegó a main.

## Propuestas para el roadmap
- Gemelo por hash: process.create con sha256 idéntico a otro binario
  de nombre distinto visto en el host (renaming sin feeds).

## Siguiente
- s2-yara-memoria (decisión publicada: escaneo por proceso).

## Estado: VERDE — riesgos
- Falta ver la run remota de 96ad54b (el local pasó la batería entera).

# IMP-1 — estado

## Hecho (últimas 24 h)

Sesiones cerradas: m3-yara-motor, H-003/H-004/H-006, m7-wef-pack,
pol1c-collector (POL-1 completo), doctor-yara-check,
reglas-interpretes-envueltos (96ad54b, 123→125) y s2-yara-memoria
(8e4b558, escaneo POR PROCESO: memscan.rs, RulesSlot, --yara-mem*,
scan --memory, latido yara_mem_*).

Sesión forensic-retention (f797587): el tope fijo de 256 bundles del
directorio de evidencias pasa a -forensic-retention (default 256).
Misma FIFO O(1) con siembra única, ahora contra el cap configurado;
anillo en memoria y API intactos; sin modo ilimitado a propósito —
el motor fatala con < 1, la biblioteca cae al default. New intacto;
cap explícito por NewWithRetention. Tests: evicción con cap propio,
fallback 0/negativos, siembra con cap propio. TODO.md sin el punto;
changelog.d/forensic-retention.md. fmt vacío, vet, staticcheck, test
./... 42 ok, -race; flags.go +3 (fichero compartido, aditivo).

Dato para DIR: la run de 995b1ad (s2 en la cabeza) terminó success
(ci + deps-audit) — primera run completa verde desde 960b19c.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones
- PUL: si la prosa documenta flags del motor, -forensic-retention va
  junto a -forensic-dir (docs/ es tu zona); ronda 4 suma su octavo
  fragmento.

## Propuestas para el roadmap
- Gemelo por hash: process.create con sha256 idéntico a otro binario
  de nombre distinto visto en el host (renaming sin feeds).

## Estado: VERDE — riesgos
- Sin cola propia en motor ni sensor; a la espera de la hornada DIR.

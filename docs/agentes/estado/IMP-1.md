# IMP-1 — estado

Cuatro instancias comparten este ID esta jornada (historial en git log).

## Hecho (últimas 24 h)

Sesión s2-yara (S-2 · YARA sensor, cerrada — PR #48):
- `sensor/src/yara.rs` + `scan.rs`: carga de reglas por directorio
  (fichero roto = se salta y se reporta; todo-roto = error), bundle.json
  opcional, recarga por fingerprint cada minuto, tope --yara-max-mb
  (16 MiB), dedupe (ruta, tamaño, mtime), cola 512, drops contados.
- Tercera sesión ETW `bluetardigrade-sensor-file` (Kernel-File 12/16);
  solo con `--yara-rules` (opt-in puro). Evento `yara.match` y bloque
  `yara_rules/_sha/_scans/_matches/_dropped/_errors` en el latido;
  subcomando `scan` bajo demanda (NDJSON, exit 2 con coincidencias).
- 56 tests (13 nuevos), check/test/clippy host + cross msvc --locked;
  excepciones en .cargo/audit.toml (rsa vía yara-x: parse-only local;
  bincode unmaintained transitivo). Contrato S-2↔M-3 en el PR #48:
  directorio + bundle.json; verificación por yara_rules_sha en el latido.

Sesión st100x (fix del job Go de CI): cinco ST1003 (DbQuery→DBQuery) y
tres ST1000 (comentario pegado a package) en el código M-4; ambos
pases de staticcheck con el toolchain de CI. Vino también en el PR #48
y el merge lo resolvió sin duplicado. — Otras sesiones cerradas de la
jornada (make-tabs, m4, o2): ver changelog.d y git log.

## En curso
- (nada) — zona al día; s2 espera la fusión del PR #48.

## Peticiones
- A PUL/OPS (.github/workflows/): deps-audit necesita `checks: write`
  para publicar informes no vacíos; retiraría bincode de la excepción.
- A DIR: marcar s2-yara-sensor hecha al fusionar PR #48.

## Propuestas para el roadmap
- M-3 (YARA en motor) parte del contrato del PR #48; firma con E-1.
- Con M-7 (WEF): pack AD por ID de evento (4625/4769/4662/4728/4732/
  4756/7045). Alta de C-4 sobre POST /api/db/query.

## Estado: VERDE — riesgos
- Cuatro solapamientos de instancia paralela; re-check del claim antes
  de cada push. `yara.match` sin PID: irá con la parte de memoria.

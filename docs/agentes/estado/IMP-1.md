# IMP-1 — estado

Tres instancias comparten este ID esta jornada (historial completo en git log).

## Hecho (últimas 24 h)

Sesión s2-yara (S-2 · YARA sensor, cerrada — PR #48, rebase pendiente de
fusión):
- `sensor/src/yara.rs` + `scan.rs`: carga de reglas por directorio
  (compilación por fichero: roto = se salta y se reporta; todo-roto =
  error, nunca un scanner vacío callado), `bundle.json` opcional con
  versión, recarga por fingerprint cada minuto, tope `--yara-max-mb`
  (16 MiB), dedupe (ruta, tamaño, mtime), cola 512, drops contados.
- Tercera sesión ETW `bluetardigrade-sensor-file` (Kernel-File 12/16):
  Create nombra el objeto, Write entrega la ruta Win32 al scanner; solo
  con `--yara-rules` (opt-in puro).
- Evento `yara.match` (model.File + atributos yara_*) y bloque
  `yara_rules/_sha/_scans/_matches/_dropped/_errors` en el latido.
- Subcomando `scan` bajo demanda (NDJSON, exit 2 con coincidencias).
- Validación: 56 tests (13 nuevos), check/test/clippy host + cross msvc
  en verde con --locked; `cargo audit` local exit 0.
- Contrato S-2↔M-3 (vigente para M-3, en la descripción del PR #48):
  distribución = directorio + bundle.json; verificación de llegada por
  `yara_rules_sha` en el latido; una regla rota no tumba el paquete.
- Audito de dependencias: yara-x arrastra `rsa` (RUSTSEC-2023-0071, sin
  parche) vía pe/macho → crypto; parse-only local, fuera de la superficie
  del advisory. Excepción revisada en `.cargo/audit.toml` + módulo `crx`
  fuera. bincode (unmaintained, transitivo duro) también en la excepción
  para que el informe quede vacío (ver Peticiones).

Sesión o2-escenarios (reparación del gate roto, cerrada):
- `scenarios/rules/windows/active-directory.yaml`: los 5 escenarios
  sintéticos que faltaban del pack AD de O-2. CI verde para todos.

Sesión m4 (M-4 · consulta BD, cerrada):
- `POST /api/db/query` + `-api-db-query`: SQL de solo lectura (guard con
  fuzz), tope 5000 filas / 30 s, auditoría en `query_audit`. Contrato en
  `docs/api/openapi.yaml`.

Sesión o2 (O-2 · mitad endpoint, entregada):
- `rules/windows/active-directory.yaml` con 5 reglas AD (119 en total) y
  evidencia sintética en `internal/rules/active_directory_test.go`.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones
- A PUL/OPS (`.github/workflows/`): rustsec/audit-check no puede publicar
  un informe NO vacío con el token actual (`contents: read`) y sale 1
  aunque el contenido esté limpio (repasado en PR #48). Un `checks: write`
  en deps-audit.yml devolvería los avisos informativos a la vista y
  permitiría retirar bincode de `.cargo/audit.toml`. Además IMP-2 ya
  apuntó el problema del concurrency group que cancela el escaneo en
  días movidos.
- A DIR: marcar s2-yara-sensor como hecha al fusionar PR #48 (el punto
  YARA de TODO.md ya queda reescrito: memoria, motor y consola abiertos).

## Propuestas para el roadmap
- M-3 (YARA en motor) puede partir del contrato del PR #48: directorio +
  bundle.json + sha del lote en el latido; la firma local llega con E-1.
- Con M-7 (WEF), ampliar el pack AD con reglas por ID de evento
  (4625/4769/4662/4728/4732/4756/7045).

## Estado: VERDE — riesgos
- "sc create" con binario propio en ruta legítima no alerta (decisión
  anti-FP; lo cubrirá la telemetría del 7045 con WEF).
- `yara.match` sin proceso/usuario: Kernel-File no trae PID; la
  atribución exigiría Kernel-Thread (decisión para la parte de memoria).

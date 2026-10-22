# claim: yara-fuentes-capadas

- ID: SEG
- Fecha: 2026-10-22 (ronda 8)
- Tarea: la propuesta en cartera de la ronda 5 la tomo yo (IMP-1 está
  con pol1c y sensor/src/yara.rs no solapa con collector.rs): el
  sensor lee las fuentes YARA sin tope en collect_sources
  (fs::read_to_string del manifiesto, fs::read de cada regla) en cada
  load() — arranque y cada recarga de fingerprint (60 s). Un .yar
  gigante en el dir de reglas (la distribución M-3 aterriza ahí) es un
  slurp a RAM del sensor de seguridad; el propio scan ya usa
  read_capped (disciplina nacida en este fichero) y el motor Go capea
  cada fichero a MaxPackBytes (32 MiB) desde la ronda 5. Fix mínimo:
  const MAX_RULE_SOURCE_BYTES = 32 MiB (alineado con MaxPackBytes) y
  las dos lecturas de collect_sources vía read_capped; lo que excede
  el cap es un pre_error (fallo de compilación listado, el pack sigue)
  y el manifiesto gigante deja la versión vacía (su semántica actual).
  Sin cambios de comportamiento por debajo del cap.
- Rutas que voy a tocar:
  - sensor/src/yara.rs (const + collect_sources + 2 tests)
  - changelog.d/sensor-yara-sources-cap.md (NUEVO)
  - docs/agentes/estado/SEG.md
- Verificación: cargo test del sensor en host (yara.rs es
  platform-independent), clippy -D warnings, cargo fmt --check.
- Sin solape: pol1c-collector (IMP-1) es collector.rs y submódulos
  nuevos; yara.rs no está reclamado por nadie.

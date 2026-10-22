# claim: doctor-yara-check

- ID: IMP-1
- Fecha: 2026-10-22 (sesión 4)
- Tarea: doctor-yara-check (mi columna, pequeña adoptada) — `engine
  doctor` valida el directorio de reglas YARA como ya hace con intel:
  mismo patrón de doctor_intel.go, usando el loader del propio motor
  (yara.Load + Refresh + Snapshot de internal/yara) para que el
  diagnóstico no pueda divergir de lo que el motor hace al arrancar.
  Flag `-yara-rules` añadido al flagset de doctor (mismo default
  ./yara-rules y misma resolución resolveDataDir que loadYara, así el
  doctor valida el directorio que el motor usaría de verdad).
  Semántica: sin directorio → skip (el pack es opcional); sin
  ficheros → warn; problemas por fichero (no UTF-8, ilegible, pasa el
  cap por fichero) → warn por problema con el nombre; total del pack
  por encima de MaxPackBytes → error (la descarga del bundle falla
  entera); pack sano → ok con ficheros, bytes y sha16 para comparar
  con el latido de la flota.
- Rutas que voy a tocar:
  - cmd/engine/doctor_yara.go (NUEVO: doctorYaraChecks)
  - cmd/engine/doctor_yara_test.go (NUEVO)
  - cmd/engine/doctor.go (solo cableado: campo yaraDir en
    doctorOptions, flag, y la llamada en runDoctor)
  - changelog.d/doctor-yara-check.md (NUEVO)
  - docs/agentes/estado/IMP-1.md
- Sin solape: SEG tiene sensor/src/yara.rs (Rust, no toco); PUL
  consolida los 9 fragmentos existentes + cifra en docs (mi fragmento
  es NUEVO y no toco CHANGELOG ni README); internal/yara no lo toca
  nadie.

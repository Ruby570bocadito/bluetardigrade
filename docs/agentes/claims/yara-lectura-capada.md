# claim: yara-lectura-capada

- ID: SEG
- Fecha: 2026-10-22 (sesión ronda 5)
- Tarea: el paquete yara del motor (internal/yara/yara.go) lee el pack
  con os.ReadFile sin tope por fichero: readPack zerpa cualquier .yar
  entero (TotalBytes solo se computa DESPUÉS de leer; el cap de 32 MiB
  solo protege el zip del bundle), manifestVersion hace lo propio con
  bundle.json (fuera del cómputo del cap) y Zip relee ambos sin guard.
  Un fichero de reglas de varios GiB en -yara-rules convierte cada
  GET /api/yara y cada arranque en un slurp OOM del motor. Fix mínimo:
  la disciplina read_capped del sensor (stat/limit+1/rechazo, ronda 4)
  en las cuatro lecturas; lo que supera el tope se lista con su fila en
  Problems y su tamaño de stat, nunca se lee. Sin cambio de
  comportamiento para packs honestos (< 32 MiB por fichero): sha16 y
  zip determinista intactos, test del ErrTooLarge del zip en verde.
- Rutas que voy a tocar:
  - internal/yara/yara.go (helper readCapped + swaps en readPack,
    manifestVersion y Zip)
  - internal/yara/yara_test.go (2 tests de regresión)
  - changelog.d/engine-yara-read-cap.md
  - docs/agentes/estado/SEG.md
- Sin solape: claims/ vacío; m3-yara-motor (IMP-1) y c4 (IMP-2) ya
  liberados. El mismo patrón sin cap en collect_sources del sensor
  (fs::read de reglas) queda como propuesta para IMP-1 en el estado:
  directorio local, lectura gated por fingerprint, fuera de este fix.

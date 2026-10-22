# claim: scan-toctou-lectura-capada

- ID: SEG
- Fecha: 2026-10-22 (sesión ronda 4)
- Tarea: el read_file del subcomando scan (sensor/src/scan.rs) lee con
  take(max): un fichero que crece entre el stat y la lectura se escanea
  TRUNCADO y el match se reporta como evidencia completa — la carrera
  que el worker defiende con take(max+1)+rechazo (read_capped en
  yara.rs, con su comentario explícito). Fix mínimo: misma disciplina
  en el helper + test de regresión. Sin cambio de comportamiento para
  ficheros honestos.
- Rutas que voy a tocar:
  - sensor/src/scan.rs (helper read_file + test)
  - changelog.d/sensor-scan-read-cap.md
  - docs/agentes/estado/SEG.md
- Sin solape: el claim activo de IMP-1 (m3-yara-motor) toca
  internal/yara/, internal/api/, fleet y cmd/engine, no el sensor.

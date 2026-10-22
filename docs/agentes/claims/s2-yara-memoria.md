# claim: s2-yara-memoria (IMP-1)

- Agente: IMP-1
- Fecha: 2026-10-22 10:02 UTC
- Tarea: lado sensor del contrato S-2<->M-3: escaneo de MEMORIA de procesos
  con yara-x según la decisión publicada de DIR (escaneo POR PROCESO — el
  sensor enumera procesos y escanea la memoria de cada uno por separado;
  atribución trivial PID + nombre en cada match; sin agregación global;
  ruido y correlación en el motor).

## Rutas que voy a tocar

- `sensor/src/memscan.rs` (nuevo: enumeración de procesos + lectura de
  regiones + emisión de yara.match con atribución; Windows-only en su parte
  de API, lógica pura testeable en cualquier host)
- `sensor/src/yara.rs` (compartir el LoadedRules compilado con el hilo de
  memoria: worker guarda Arc en slot compartido; contadores mem)
- `sensor/src/heartbeat.rs` (campos yara_mem_* del latido)
- `sensor/src/collector.rs` + `sensor/src/collector/health.rs` (arranque del
  hilo de barrido + lectura de contadores)
- `sensor/src/scan.rs` + `sensor/src/main.rs` (subcomando scan --memory bajo
  demanda + banderas --yara-mem / --yara-mem-every / --yara-mem-max-mb)
- `sensor/Cargo.toml` (features de windows-sys: ToolHelp, Memory, Debug)
- `changelog.d/s2-yara-memoria.md` (entrada de la entrega)

Zonas exclusivas de IMP-1 (OWNERSHIP.md); claims/ estaba vacío al reclamar.

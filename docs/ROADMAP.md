# Roadmap — bluetardigrade

Dirección del producto por horizontes. Cada entrada declara el problema
que resuelve y la señal de cierre (qué se considera "hecho"), porque un
roadmap sin criterios de aceptación es una lista de deseos. El estado
"shipped" de cada horizontal vive en el [CHANGELOG](../CHANGELOG.md) y
la arquitectura vigente en [ARCHITECTURE.md](ARCHITECTURE.md).

Última actualización: 2026-10-01 (ronda de detección + forense).

---

## H1 — Detección: profundidad y cobertura (siguiente)

**Problema**: la cobertura actual es fuerte en procesos y artefactos
(49 reglas, 4 cadenas) pero delgada en memoria y ficheros: un payload
que no genere patrones de línea de comandos visible sigue siendo ciego
para el motor.

- **Reglas de fichero y DLL hijacking** — `file.write` hacia rutas de
  arranque (UpnpHost, ProgramData), side-loading (DLL junto a binarios
  firmados de terceros). Cierre: paquete `rules/windows/file-staging.yaml`
  con 6+ reglas y tests de gemelos benignos.
- **ETW de imagen/driver** — el sensor Rust ya colecta
  `image.load`: reglas de drivers maliciosos y DLLs de ruta no estándar
  cargadas por servicios. Cierre: 4+ reglas sobre `image.load` validadas
  en laboratorio Windows real.
- **Sigma import real** — el convertidor existe (`cmd/engine sigma`);
  importar y mantener una selección curada del repositorio Sigma como
  fuente secundaria de reglas. Cierre: script de importación en CI con
  conteo de reglas convertidas y suite de diferencias.
- **Detección de inyección** — `process.access` con máscaras de
  escritura-remota (0x1F0FFF, 0x1010) sobre procesos que no son el
  propio: correlación con la vista de contexto del padre. Cierre: regla
  de inyección con FP documentado bajo administración legítima (AV,
  debuggers).

## H2 — Forense: de evidencia a investigación (en curso)

**Problema**: los bundles congelados responde "qué pasaba en el host";
la investigación real necesita reconstruir "quién hizo qué" a partir de
esa evidencia.

- **Árbol de procesos del bundle** — el timeline ya lleva PID/PPID de
  cada evento: derivar el árbol y renderizarlo en el panel forense de la
  consola en lugar de la lista plana. Cierre: componente de árbol en la
  consola con datos reales del E2E del laboratorio.
- **Exportación del bundle** — botón de descarga JSON/JSONL del bundle
  completo desde el panel (para adjuntar a un ticket o retenerlo más
  allá de la evicción de 256). Cierre: export funcionando + test client-side.
- **Hashes y reputación** — los eventos ya transportan `hashes`:
  exponerlos en el bundle y enlazar con TI local (MISP offline) cuando
  esté configurado. Cierre: enriquecimiento de hash en el bundle + flag
  `-misp-url`.
- **Retención configurable** — `-forensic-retention` con pruner
  periódico en vez de solo el tope de 256 ficheros. Cierre: flag +
  ticker + tests de prunning.

## H3 — Sensor: telemetría más rica

**Problema**: el sensor Rust colecta proceso/imagen; el Sysmon cubre
registro y red pero con la fricción de instalación. Falta el punto
medio: ETW nativo ampliado.

- **ETW de red y registro** — providers `Microsoft-Windows-Kernel-Network`
  y `Registry`/`Sysmon`-equivalentes vía ETW puro (sin instalar nada).
  Cierre: eventos `network.connect` y `registry.set` emitidos por el
  sensor Rust en un host real, con el pipeline de reglas validándolos.
- **Cert stream (firma de binarios)** — `Microsoft-Windows-Certificate`
  para validar firmantes de ejecutables. Cierre: campo `signer` en el
  evento + regla de binarios sin firmar desde rutas de sistema.
- **Cola local con reintento** — buffer persistente del sensor para
  cortes del motor (hoy el bookmark cubre el Sysmon watcher, no un
  buffer del ETW). Cierre: cola con tope en disco y drenaje con dedupe.

## H4 — Motor: rendimiento y escala

**Problema**: `FieldMap` serializa cada evento ~4 veces por pasada; a
50k eventos/seg el GC se convierte en el cuello de botella.

- **FieldMap sin JSON round-trip** — resolver campos con acceso directo
  tipado (un switch sobre el prefijo del path). Cierre: benchmark del
  paquete rules mostrando la mejora y paridad exacta de tests.
- **Sharding del ring por host** — el ring de eventos de la API es
  global (1000): particionar por host con cuota garantizada. Cierre:
  cambio de estructura + tests de equidad con 64 hosts.
- **Memoria del correlador** — `correlate.MaxTrackedStates` ya expone
  el tope: audit de saturación con alerta visible cuando se cruza el
  80%. Cierre: gauge en `/api/stats` + línea de consola.

## H5 — Consola y analista

**Problema**: el panel de IA consume UNA alerta; un incidente real es
un cluster de alertas correlacionadas.

- **Análisis de incidente** — agrupar alertas por host+ventana y ofrecer
  "analizar incidente" al hub IA con el bundle forense como contexto
  (ya delimitado y truncado por diseño). Cierre: prompt multi-alerta con
  el bundle adjunto y la respuesta citando eventos del timeline.
- **Vista de árbol global** — navegador de procesos del host con el
  mapa pid->padre del enriquecedor servido por la API. Cierre: endpoint
  `GET /api/hosts/{h}/tree` + vista.
- **Búsqueda guardada** — persistir hunts del operador (localStorage +
  URL). Cierre: gestión de hunts con tests.

---

## No-roadmap (decisión deliberada)

- **EDR-style quarantine nativo** — la respuesta activa se mantiene
  `kill_process` opt-in con guard de operadores: ampliarla a cuarentena
  de ficheros o aislamiento de red es una decisión de producto que
  exige un caso de uso real primero.
- **gRPC / filaments / eBPF** — registrados como design-only en la
  arquitectura: no entran hasta que el pipeline NDJSON-TCP demuestre ser
  el cuello.
- **Multi-tenant** — un motor por despliegue; el aislamiento por
  cliente es responsabilidad del orquestador (Docker/K8s), no del motor.

# Roadmap — bluetardigrade

Dirección del producto por horizontes. Cada entrada declara el problema
que resuelve y la señal de cierre (qué se considera "hecho"), porque un
roadmap sin criterios de aceptación es una lista de deseos. El estado
"shipped" de cada horizontal vive en el [CHANGELOG](../CHANGELOG.md) y
la arquitectura vigente en [ARCHITECTURE.md](ARCHITECTURE.md).

Última actualización: 2026-10-20 (plan por fases del responsable).

---

## Plan por fases (2026-10-20)

Orden fijado por dependencias: la seguridad de acceso va antes de las
funciones que abren lectura o escritura sensible (BD, YARA, acciones), y
las imágenes y el vídeo van después del rediseño para no rehacerlos. Un
PR pequeño por punto, con el CI en verde antes de fusionar.

**Decisiones tomadas**

- La rama `100agentes` se descarta (PR #23 cerrado sin fusionar).
- La regla *observe-only* pasa a ser una opción de instalación: la
  respuesta activa ampliada se elige al instalar y está apagada por defecto.
- `sf-start` arranca motor, consola, hub **y** el servicio del sensor ETW.

**F0 — Higiene del repositorio**

- CI en verde: Go 1.26.10 (9 vulnerabilidades de la stdlib en 1.26.6) y el
  oráculo de `FuzzHTMLAttribute` (cuelgue con nombre vacío). Cierre:
  `deps-audit` y `bench-nightly` en verde en `main`.
- Ramas y tags: solo quedan `main` y las ramas con PR vivo; `v1.0.0-rc1` es
  la única release publicada. Cierre: listado de ramas y tags revisado.
- Archivos: fuera los informes de rondas, el informe de auditoría y los
  diagramas desfasados. ARCHITECTURE con diagramas Mermaid verticales.
- Descripción y *topics* del repositorio actualizados.

**F1 — Uso diario**

- `sf-start` / `sf-stop` / `sf-status`. Cierre: un comando arranca y otro
  para las cuatro piezas; `sf-status` dice qué está vivo.
- Instalador silencioso: resumen por pasos, log completo a fichero,
  `-Verbose` para verlo todo. Cierre: una pantalla de salida sin ruido de
  bun/next.
- Acciones en lote: ya existían (reconocer, cerrar y reabrir con nota común,
  añadir a incidente, suprimir, exportar y analizar la selección). Asignar
  alertas a un responsable necesita un campo nuevo en el motor y pasa a F3.

**F2 — Acceso**

- Login con pantalla propia y sesión (cookie segura, cierre de sesión,
  bloqueo por intentos) sobre las cuentas con rol que ya existen.
- MFA opcional por TOTP con códigos de recuperación, obligatorio por rol
  si se configura.
- ACL de máquinas y servicios: qué operador ve y actúa sobre qué grupos
  de equipos y servicios. Por concretar: si incluye auditar en los
  endpoints los permisos débiles de servicios Windows.

**F3 — Funciones**

- Asignar alertas a un responsable (campo en el ciclo de vida del motor,
  filtro "mías" y asignación en lote desde la barra de selección).
- Respuesta activa ampliable, opt-in al instalar: aislar equipo, cuarentena
  de fichero, suspender proceso; cada acción auditada como `kill_process`.
- YARA: escaneo en el sensor Rust (`yara-x`), reglas guardadas y
  distribuidas por el motor, gestión en la consola (ver, añadir, eliminar)
  con validación al compilar, solo administradores y auditada.
- Consulta de la BD: solo lectura (la evidencia es append-only), límites de
  tiempo y filas, solo administradores, cada consulta auditada.
- AD: más lectura (grupos privilegiados, cuentas inactivas, cambios
  recientes). Las acciones sobre AD seguirían la misma regla opt-in.

**F4 — Diferenciadores**

- ML beta para el triaje: modelo local y explicable que ordena alertas por
  probabilidad de ruido aprendiendo de las decisiones de triaje, con la
  razón visible, detrás de `-ml-beta`. No sustituye a las reglas legibles.
- Ediciones: perfiles de instalación `lite` (motor, sensor, CLI) y `full`
  (consola, hub IA, SQLite, AD, SIEM) sobre un único código.

**F5 — Escaparate**

- Rediseño del dashboard, luego capturas en una VM de laboratorio (sin
  nombres de equipo, usuarios ni dominios reales), luego vídeo y README.

---

## H1 — Detección: profundidad y cobertura (siguiente)

**Problema**: la cobertura actual es fuerte en procesos y artefactos
(114 reglas, 11 cadenas), incluida una primera capa de ficheros y phishing; sigue
siendo delgada en memoria y en la confirmación de cargas de DLL.

- **Reglas de fichero: primera capa entregada** — paquete
  `rules/windows/file-staging.yaml` con seis reglas y gemelos benignos:
  Office, preparación de DLL, perfiles, inicio de Office y volcados de
  LSASS. Startup ya usa la ruta canónica aunque falte la extensión.
  Pendiente: medir ruido con telemetría real de Windows y correlacionar
  la DLL escrita con `image.load`; el nombre de una DLL no confirma
  carga lateral. Detalle: [DETECCION-Y-EVIDENCIA.md](DETECCION-Y-EVIDENCIA.md).
- **ETW de imagen/driver** — el sensor Rust colecta
  `process.create` en su implementación actual; Sysmon cubre más tipos.
  Pendiente `image.load`: reglas de drivers maliciosos y DLLs de ruta no estándar
  cargadas por servicios. Cierre: 4+ reglas sobre `image.load` validadas
  en laboratorio Windows real.
- **Sigma import real** — el convertidor existe (`cmd/engine sigma`);
  importar y mantener una selección curada del repositorio Sigma como
  fuente secundaria de reglas. Cierre: script de importación en CI con
  conteo de reglas convertidas y suite de diferencias.
- **Detección de inyección** — `process.access` con derechos de
  escritura/operación de memoria sobre procesos que no son el propio,
  correlacionado con ejecución remota y contexto del padre. Un acceso
  de lectura como `0x1010` no basta para afirmar inyección. Cierre: regla
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
- **Exportación del bundle: entregada** — descarga JSON/JSONL desde el
  panel, con alerta, metadatos y eventos completos, independiente del
  filtro de vista. Pruebas de round-trip, DOM y descargas Chromium.
  El archivo conserva la ventana capturada, no todo el histórico del host.
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
- **Cola local con reintento: entregada** — el callback ETW ya no envía:
  cola acotada en memoria (`--queue`) y spool opcional en disco con tope
  (`--spool`, `--spool-max-mb`) que sobrevive a reinicios y se drena en
  orden; las repeticiones las absorbe el almacén (primera escritura
  gana por id). Pendiente: validarlo en un host Windows real con cortes
  largos del motor.

## H4 — Motor: rendimiento y escala

**Problema**: `FieldMap` serializa cada evento ~4 veces por pasada; a
50k eventos/seg el GC se convierte en el cuello de botella.

- **FieldMap sin JSON round-trip: entregado** — el mapa se construye
  directamente desde la estructura (`pkg/model/fieldmap.go`): 1,7 µs y
  29 asignaciones frente a 8,0 µs y 83 por evento. Paridad exacta con el
  round-trip (claves, omitempty, float64, RFC 3339, UTF-8 inválido)
  fijada por un test aleatorio de 20 000 eventos y un objetivo de fuzzing.
- **Sharding del ring por host** — el ring de eventos de la API es
  global (1000): particionar por host con cuota garantizada. Cierre:
  cambio de estructura + tests de equidad con 64 hosts.
- **Escrituras SQLite por lotes: entregadas** — el bucle persiste en una
  transacción los eventos ya encolados (hasta 256) antes de publicarlos:
  de ~8 300 a ~23 600 eventos/s con `-store` en la misma máquina.
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
- **Búsqueda guardada: entregada para Alertas y Flujo** — filtros locales
  con gestión, validación, recarga, Atrás y actualización entre pestañas;
  pruebas de datos, DOM y Chromium. No incluye sincronización entre cuentas
  ni bundles capturados. Detalle:
  [INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md](INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md).
- **Progreso honesto del analista: entregado** — pasos de preparación y
  consulta reales, sin demoras cosméticas ni reproducción artificial de
  tokens. Streaming nativo del proveedor y análisis multi-alerta siguen
  pendientes; las regresiones usan respuestas aisladas, no un modelo real.

---

## No-roadmap (decisión deliberada)

- **gRPC / filaments / eBPF** — registrados como design-only en la
  arquitectura: no entran hasta que el pipeline NDJSON-TCP demuestre ser
  el cuello.
- **Multi-tenant** — un motor por despliegue; el aislamiento por
  cliente es responsabilidad del orquestador (Docker/K8s), no del motor.

## SOC — primera integración entregada; operación multiusuario pendiente

Entregado: seis adaptadores observados, 14 reglas SOC, dos umbrales nuevos,
configuración osquery de solo lectura e informes humanos en CLI/dashboard.
[Guía y límites](SOC-INTEGRACIONES-E-INFORMES.md). Pendiente: laboratorio de
proveedores con medición de falsos positivos, cola durable y cursores de
rotación, casos compartidos en backend, identidades autenticadas, permisos,
auditoría de versiones y sincronización de informes. IPS inline pertenece
al proveedor; no se anuncia un bloqueador nativo de paquetes.

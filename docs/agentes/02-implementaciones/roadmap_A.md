# Roadmap — Implementación A (motor y backend)

Archivo vivo de continuidad del carril `carril/implementacion-a`. Se actualiza al final de
cada ronda: qué está a medias, qué sigue y por qué.

## Estado actual

- Ronda 2026-10-06 10h45 cerrada (informe: `ronda_2026-10-06_10h45_A.md`).
  Primero, **publicados los 4 commits retenidos** (`9409784..c113fcb`): la
  sesión trajo la credencial de push (solo variable de entorno del proceso;
  el shell se reinicia entre llamadas → cada push con env inline y `git -C`).
  Después, **fix del hallazgo MEDIA de SEG-A r16** (`f2e6378`): el hot-swap
  de AD-6 pasa a correr SINCRÓNICAMENTE dentro del `adWriteMu` del PUT
  (`adReloadSync`; commit y publicación = UNA sección crítica — el orden
  publicación==fichero es determinista, `current` del motor toca un llamador
  por vez y no hay conectores huérfanos). Descartada la alternativa de tomar
  el cerrojo dentro de la goroutine: el entrelazado H1,H2,C2,C1 conservaría
  el lost-update en reposo. Test de regresión determinista
  (`TestADSettingsHotSwapSerializesConcurrentPUTs`, 8 PUTs + pausa de 200µs):
  fail-before = WARNING DATA RACE en la primera pasada sobre código viejo
  (worktree desprendido); pass-after = `-race -count=5` verde. **La respuesta
  del PUT ahora trae el swap resuelto** (`reload_pending:false` +
  `last_reload_*`) — comunicado a IMP-B en el informe §1. OpenAPI/OPERATIONS/
  changelog actualizados. Verificación completa en verde (race x5 api+engine,
  40 paquetes, guards 43/252/114, e2e 33+12+14+12+19). Merge-tree: 3 CLEAN +
  los 2 conflictos conocidos. Makefile roto heredado de `main`: dominio
  PUL-A, no tocado (reparo canónico `0852035` de SEG-A). Cola: REP-2 →
  purga de hosts rechazados → §2.1 (sin cargo).
- Ronda 2026-10-06 11h50 cerrada (informe: `ronda_2026-10-06_11h50_A.md`). Dos
  entregas: **(1)** `engine doctor` valida `known-software.yaml` con el parser real
  (`known.Parse`, paridad con `ingest-identities`: error = lo que el motor haría,
  warn si vacía, skip honesta si no existe); **(2) cuotas por equipo (v1.1)**:
  `MaxKeysPerHost = 2048` (25%) en threshold y beacon como techo de ADMISIÓN — las
  claves existentes del host saturado siguen contando, solo las nuevas se rechazan,
  y la evidencia muerta se purga ANTES del rechazo (auto-reparación; el techo por
  regla queda puro, semántica auditada intacta). El correlador no necesita cuota
  (maxSequences=512 ya acota la parte de un host a 6,25% del cap, por construcción).
  Los anillos de vista cuentan su rotación POR HOST. Honestidad en `/api/stats`
  (`beacon_quota_rejected`, `threshold_quota_rejected`, `ring_dropped_events`,
  `ring_dropped_alerts`, `quota_top_hosts` top-8) y `/metrics` sin etiquetas de
  host. OpenAPI 43 rutas / 56 campos stats + `QuotaHostRow`; OPERATIONS.md con la
  sección de cuotas. **RETENIDA EN LOCAL** (sin credencial de push esta sesión;
  4 commits `9409784..HEAD`; el push es la primera acción de la siguiente ronda).
  Verificación completa tras el último cambio: race x5 (api/engine/threshold/
  beacon), 40 paquetes -race 0 fallos, staticcheck 0, guards y 4 baterías e2e
  verdes. Merge-tree: 3 puntas CLEAN; los 2 conflictos conocidos (PUL-A comentarios,
  SEG-A reports_test) con resolución ya acordada.
- Ronda 2026-10-06 10h53 cerrada (informe: `ronda_2026-10-06_10h53_A.md`). Primero,
  **publicados los 8 commits retenidos** (`bc91c7d..9b82845`): la sesión trajo la
  credencial de push (usada solo como variable de entorno del proceso). Después,
  **AD-6/SET-1 parte A (motor)**: `GET/PUT /api/settings/ad` + `POST /api/ad/test`
  («Probar conexión» del TODO): validación con las reglas del cargador `-ad` ANTES
  de tocar disco, contraseña a su sobre SEC-2 (nunca en el YAML/logs/respuesta),
  YAML atómico con valores efectivos, **recarga en caliente** del conector
  (`ad.New` + `SetAD` bajo cerrojo, bucle anterior parado fuera de camino),
  drift de fichero `-ad` → 409, auditoría por nombres de campo, horario laboral
  (work_start/work_end/work_days, validado; consumidor: AD-3 cuando haya WEF).
  Transporte LDAP unificado (`openLDAP`): el probe usa el MISMO handshake que la
  sync, con `conn.Start()` explícito (su ausencia = deadlock de Bind, cazado en
  test). Guard compartida `check_openapi.py` extendida a múltiples cuerpos 403
  (segunda superficie de escritura); self-test 5/5. OpenAPI 41→43 paths
  (schemas ADSettings/ADSettingsUpdate/ADTestResult). Verificación: build+windows,
  vet, staticcheck 0, race x5 (api 50 s/ad/engine), suite completa -race 40 paquetes
  0 fallos, guards OK, e2e reports_noise 33/33 + smoke_lifecycle 12/12.
- Ronda 2026-10-06 07h58 cerrada (informe: `ronda_2026-10-06_07h58_A.md`). Primero,
  **los DOS hallazgos de SEG-A ronda 11 en mi rama, corregidos con su sonda**:
  `/api/ad/posture` ya sirve el score almacenado (MEDIA; prueba nueva con store
  temporal + conector sin red, exigía 87) y las lecturas de `h.ad`/`h.alertLatency`/
  `h.ingestCert`/`h.version` (y `h.risk`/`h.threshold`/`h.reloader`) van bajo cerrojo
  (BAJA; accesorio `adConnector()` + capturas pre-Unlock en `statsSnapshot`). Después,
  **§2.3 supresiones con condiciones**: `when` (field/operator/value) en
  `internal/suppress`, compilado con `rules.NewMatcher` (mismos operadores, una sola
  fuente de verdad — exporté `rules.IsValidOperator`); evaluado donde existe el evento
  (reglas, intel, línea base) y NUNCA sobre agregados (fallo hacia alertar); API de
  escritura, OpenAPI y OPERATIONS.md actualizados. Y **§2.2 software conocido**: paquete
  `internal/known` (`-known-software`, `known-software.example.yaml`), match por glob
  de imagen (insensible a mayúsculas, backslash-normalizado, `*` no cruza directorio)
  y/o sha256; etiqueta `enrichment.known_software` de clave de MOTOR (no falsificable),
  el evento nunca se borra; la línea base aprende pero no reporta novedad, el ruido lo
  excluye con contador de honestidad (`scanned.known_software_events`), las reglas
  pueden excluirse con `exclude_known_software: true` (opt-in); `/api/stats` gana
  `known_software_active`. §2.1 (Rust) sigue bloqueada sin `cargo`. Verificación: 40
  paquetes ok, race x5 (api 47,7 s / engine / suppress / enrich) y x3 (report/rules/
  known), staticcheck 0, guards OK (41 rutas, 114 reglas), e2e reports_noise 33/33 +
  smoke_lifecycle 12/12 + beacon 14/14 + threshold 12/12. Retenida en local de nuevo
  (sin credencial de push ni webhook; declarado en el informe).
- Ronda 2026-10-06 09h01 cerrada (informe: `ronda_2026-10-06_09h01_A.md`).
  Entregado el **campo de decisión de triaje** (petición MEDIA de IMP-B,
  cola #1): `Decision` en `internal/lifecycle` (`false_positive`,
  `authorized_activity`, `confirmed_incident`; typo = error duro, fichero
  sigue en versión 1 con compatibilidad hacia atrás probada), semántica de
  REEMPLAZO completo (omitir `decision` la limpia, como `note`/`by`),
  `POST /api/alerts/{id}/status` + overlay `decision` en `GET /api/alerts`
  + CSV con la columna AÑADIDA AL FINAL + línea de auditoría con veredicto,
  y `false_positive_pct` REAL en `/api/noise` (los proxies
  closed/acknowledged quedan intactos). OpenAPI (4 esquemas + 4
  descripciones), OPERATIONS.md, changelog.d. smoke_lifecycle 9 → 12.
  Dos fallos cazados en propia casa: la herramienta de edición normalizó
  lifecycle.go a espacios (gofmt lo cazó; restaurado) y la pegajosidad de
  claves JSON en un test reutilizando mapas (el servidor estaba bien; nota
  para IMP-B en el informe). Retenida en local: la sesión NO trajo
  credencial de push (declarado en el informe; commits listos para push).
- Ronda 2026-10-05 21h48 cerrada (informe: `ronda_2026-10-05_21h48_A.md`). Primero se
  publicó el cierre retenido de la ronda anterior (`2c32013..8150a37`): AD-1/AD-2/SET-3
  quedan OFICIALES y visibles (SEG-B puede auditar `internal/ad`, IMP-B puede consumir
  los contratos `/api/ad/*`). Después, entregado **SEC-2** al pie de la letra del
  contrato de SEG-B (addendum 19h10): paquete `internal/secretfile` (sobre JSON
  versionado; DPAPI con ámbito LOCAL_MACHINE en Windows vía x/sys/windows; plain con
  0600 exigido en cada lectura en POSIX; paridad de laboratorio con texto en bruto y
  aviso de re-guardado en Windows; `Zero` para el llamador), cableado en `internal/ad`
  (el secreto cruza como []byte de fichero a bind, buffer a cero tras el intento, avisos
  en `/api/ad/status`), subcomando `engine secret-write` (el secreto SOLO por stdin).
  El checklist de SEG-B tiene un test por exigencia: la ida y vuelta DPAPI real corre en
  el job `engine-windows` del CI; las cuatro formas JSON de `/api/ad/*` se escanean sin
  secreto (crudo/base64/hex y longitud con frontera de dígito); higiene de logs ante
  bind fallido. Docs: OPERATIONS.md (subsección SEC-2 + icacls), ad.example.yaml,
  changelog.d. OpenAPI sin cambios (sin rutas nuevas; 41 verificadas).
- Ronda 2026-10-05 12h36 cerrada (informe: `ronda_2026-10-05_12h36_A.md`). Entregado SIM-1 y
  SIM-2 completos: biblioteca `scenarios/` con 127 escenarios (114 reglas habilitadas + 13
  cadenas), etiqueta `simulation` propagada a toda alerta derivada de evidencia simulada,
  reproductor `engine scenarios list|replay` solo-loopback, red de regresión en CI y E2E
  contra motor de laboratorio real. La rama se publicó esta ronda: los commits de la ronda
  anterior estaban solo en local (faltaba credencial de push; ya resuelto).
- Ronda 2026-10-05 14h45 cerrada (informe: `ronda_2026-10-05_14h45_A.md`). Entregado SIM-4
  parte A: superficie API de validación bajo demanda (`GET /api/scenarios`,
  `POST /api/scenarios/run`, `GET /api/scenarios/runs`, `GET /api/scenarios/runs/{id}`),
  flag `-scenarios`, historial en SQLite (`scenario_runs`, últimos 200) o en memoria
  (últimos 50), paquete `internal/scenrun`, ejecución aislada reutilizando el runner de CI
  (nada de una ejecución llega a los anillos/store/webhook del motor), OpenAPI actualizada
  (34 rutas) y E2E ampliada con la fase E (19 comprobaciones; 21 en modo completo, batería
  127/127 por API). También el ALTA de Seguridad B: `x/text` v0.3.8 → v0.39.0
  (GO-2026-5970) en esta rama (hereda de `feat/enrollment`).
- Ronda 2026-10-05 14h55 cerrada (informe: `ronda_2026-10-05_14h55_A.md`). Entregado
  **REP-1 parte A** (catálogo `GET /api/reports` + `GET /api/reports/{kind}`:
  executive, incident, fleet, soc; JSON y CSV; honestidad de origen store/ring y tope de
  escaneo declarado), la **API de ruido** §2.4 (`GET /api/noise`: procesos por imagen,
  dominios DNS, reglas con overlay de triage; por host y flota) y el fix **SEC-A-1**
  (unicidad del nombre de identidad en el alta). OpenAPI 34 → 37 rutas. E2E nueva
  `e2e_reports_noise.sh` (33 comprobaciones). Flake determinista corregido en
  `TestScenarioEndpointsRoundTrip` (código propio de la ronda SIM-4). El entorno se
  reinició entre rondas: Go re-instalado (1.26.0) y GOPROXY alternativo documentado en
  el informe.
- Ronda 2026-10-05 21h15 cerrada (informe: `ronda_2026-10-05_21h15_A.md`). Entregados
  **AD-1** (conector LDAP de solo lectura: `internal/ad`, flag `-ad`, snapshot SQLite
  reemplazado atómicamente por sincronización, LDAPS/StartTLS con CA obligatoria,
  contraseña en fichero propio re-leída por sincronización, filtros literales,
  paginación RFC 2696 crítica, tope de objetos, fixture LDAP propio en loopback para
  los tests) y **AD-2** (`internal/ad/posture.go`: 10 hallazgos del TODO, severidad,
  objetos afectados con tope 50, remediación, puntuación 0-100 con historial de 500
  puntos; recomputado tras cada sincronización), más **SET-3 lado motor**
  (`version`, `alert_latency` p50/p95/max, `store_size_bytes`, `certificates` en
  `/api/stats`) y la fila `-scenarios` en `docs/OPERATIONS.md` (petición de PUL-A).
  OpenAPI 37 → 41 rutas. Nueva dependencia `github.com/go-ldap/ldap/v3` (justificación
  para SEG-B en el informe). El entorno se reinició de nuevo: Go 1.26.8 re-instalado.

## A medias

- Nada a medias: AD-1, AD-2, SET-3, SEC-2 y el campo de decisión de triaje quedaron
  completos y verificados.
- AD-1/AD-2 quedan a la espera de su parte de consola (AD-5/AD-6, IMP-B): los contratos
  JSON están publicados en OpenAPI y en el informe de esta ronda.
- El botón «añadir a software conocido» de la pestaña de ruido de IMP-B YA TIENE backend:
  `known-software.yaml` (§2.2) existe con recarga en caliente; falta su parte de consola.
- SIM-4 sigue a la espera de su parte B (pantalla de la consola, IMP-B); REP-1 igual.
- El informe de ruido sirve `false_positive_pct` (decisiones registradas, real) DESDE
  la ronda 2026-10-06 junto a los proxies `closed_pct`/`acknowledged_pct`; la pestaña
  de ruido de IMP-B ya puede pintar el FP% por regla, y VIZ-3 puede pintar «falso
  positivo» desde `decision` en `GET /api/alerts`.

## Cola de tareas del carril (orden pretendido)

1. ~~Publicar la retención~~ — HECHO al abrir la ronda 10h53 (`bc91c7d..9b82845`).
   **Pendiente de nuevo**: publicar la ronda 11h50 (4 commits, `9409784..HEAD`)
   — primera acción de la próxima sesión si llega credencial.
2. **REP-2** informes programados (diarios/semanales en `data/reports` con
   retención, SMTP/webhook opcional): la maquinaria de datos ya existe tras REP-1 A.
3. **Purga de hosts rechazados/revocados** en el registro de alta (observación de
   SEG-A: hoy cuentan para siempre en `MaxHosts`).
4. ~~v1.1 Ruido residual: doctor `known-software.yaml`~~ — HECHA (ronda 11h50).
   **§2.1 agrupación de arranques** (Rust) sigue bloqueada sin `cargo`.
5. **Diseño**: cuotas por equipo en la memoria del motor — HECHAS (ronda 11h50);
   queda el trabajo por hash de equipos de la fase B «Escala SOC» cuando llegue.
6. **AD-3** cuando WEF exista. **AD-7** cuando el responsable decida el mapa
   grupos→roles. REP-1 parte B (PDF vía vista imprimible) es de IMP-B.

## Decisiones y motivos (histórico vivo)

- **SIM-4 ejecuta el runner aislado de CI, no el camino por cable**: la batería bajo demanda
  reutiliza `internal/scenario.Runner` (enriquecimiento → reglas → correlador, orden de
  producción, Manager de alertas privado). Una ejecución no toca anillos, store, webhook ni
  stream del motor: una validación nunca puede confundirse con evidencia (el mismo límite
  que la etiqueta `simulation` garantiza en el camino por cable, que sigue cubierto por
  `engine scenarios replay`). Ventaja añadida: CI y consola validan con el mismo motor de
  ejecución, por construcción; sin dedup cruzada entre escenarios ni necesidad de sufijos de
  host por ejecución.
- **La biblioteca se recarga en cada ejecución y en cada listado**: un YAML editado surte
  efecto sin reiniciar y un fichero mal formado se ve en la consola como 500 con el fichero
  en el error, no enterrado en un log. El estado armado (`-scenarios`) se anuncia en el
  arranque; desarmado las rutas responden 501 con `hint` (patrón forense: «feature off»
  distinguible de un 404).
- **Una ejecución a la vez** (409 con el `run_id` actual en `hint`); el resultado por
  escenario se registra a medida que termina, así que el detalle de una ejecución en vuelo
  muestra progreso real.
- **Historial en SQLite cuando hay `-store`** (tabla `scenario_runs`, JSON de resultados por
  fila, retención de 200 ejecuciones) o en memoria (50) sin él: la tendencia sobrevive al
  reinicio en despliegues con almacén, que es donde tiene sentido.
- **Etiqueta `simulation` de extremo a extremo** (ronda anterior): se propaga a TODA alerta
  derivada de eventos simulados — reglas, cadenas, beacons, umbrales, intel, línea base.
- **Los eventos del escenario se decodifican vía JSON** (el esquema de la capa de
  transporte), no con tags YAML nativos: evita bifurcar el contrato del sensor.
- **Cobertura obligatoria por detección en CI** (`TestScenarioLibraryCoversEveryDetection`).
- **El reproductor CLI solo acepta loopback literal** y valida las expectativas contra el
  catálogo del motor de laboratorio antes de repetir (`FALTA-CATALOGO`).
- Corrección de CLI descubierta en la ronda SIM: los subcomandos nuevos deben registrarse en
  `cmd/engine/main.go` (`isRoutedSubcommand`) ADEMÁS de en el árbol Cobra.
- **El conector AD no tiene primitiva de escritura** (ronda AD): el paquete solo compila
  `bind` y `search` sobre `ldap.Conn`; «solo lectura» es la ausencia de la capacidad, no
  una política. El control de paginación se envía con criticality TRUE (un servidor que
  no sepa paginar FALLA en vez de devolver el árbol sin paginar) y el tope abandona el
  cursor con página 0, no leyendo todo y recortando.
- **La contraseña se re-leé en cada sincronización** desde su fichero: rotar la
  credencial no exige reiniciar el motor; vive solo en variables locales del stack de
  llamada del bind.
- **Snapshot atómico**: `ReplaceADSnapshot` borra e inserta dentro de UNA transacción
  (WAL): los lectores ven el directorio viejo o el nuevo, nunca una mezcla.
- **La postura se congela con cada snapshot** (se guarda en `ad_posture_history`, se
  sirve del almacén): `/api/ad/posture` no recomputa por petición (no quema el almacén
  ni puede ser más actual que el snapshot que sirve) y `ready=false` honesto hasta la
  primera sincronización — nunca una puntuación fabricada.
- **API = copias**: `Connector.Snapshot()` devuelve el `Status` por valor y copia el
  slice de avisos; el postura servido es un documento decodificado del almacén. La
  lección de scenrun (ronda 1) aplicada por construcción, verificada con
  `-race -count=5` en `internal/ad`, `internal/api`, `cmd/engine`, `internal/ingest` e
  `internal/alert`.
- **`go-ldap/ldap/v3` elegida por necesidades del protocolo**: StartTLS, control
  RFC 2696 (con criticality TRUE exprés, construido en BER a mano porque la librería
  no lo expone), lectura cruda de `objectSid` y rendición de SIDs binarios. El
  razonamiento completo para la auditoría de SEG-B está en el informe de ronda.
- `TestExampleConfigLoads` carga `ad.example.yaml` con el cargador real (KnownFields
  estricto): el ejemplo documentado no puede desincronizarse del esquema.
- Entorno de esta ronda: workspace reiniciado de nuevo (Go ausente); instalado
  Go 1.26.8 linux/amd64 en `/home/z/go`; staticcheck re-instalado; `DISCORD_WEBHOOK_URL`
  sigue sin definirse (sin notificaciones, como en rondas previas); sin `cargo` ni
  `pwsh`: sensor y PowerShell no se tocaron.
- Entorno de la ronda 14h55 (histórico): push resuelto con el token del responsable; sin
  `cargo` ni `pwsh` (sensor y PowerShell no se tocaron); bun disponible pero la consola
  no cambió.

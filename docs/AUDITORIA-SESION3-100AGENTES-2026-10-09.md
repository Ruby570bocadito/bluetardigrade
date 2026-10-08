# Auditoría Sesión 3 — 40 agentes con roles, 4 rondas, funciones nuevas y estrés 6/6

**Rama:** `100agentes` · **Fecha:** 2026-10-09 · **Método:** despliegue de 40 agentes paralelos con roles asignados en 4 rondas (mínimo 10 por ronda), implementación de fixes y funciones nuevas por ronda (Ronda 11–14 de la rama), verificación completa tras cada ronda y prueba de estrés con el scrubber de secretos activo.

**Sesiones anteriores:** `docs/AUDITORIA-2026-10-08.md` (18 agentes, rondas 1–5 equivalentes) y `docs/AUDITORIA-SESION2-100AGENTES-2026-10-08.md` (32 agentes, rondas 6–10). Esta **sesión 3** cubre el backlog P1/P2 pendiente y añade **4 funciones nuevas**.

**Commits:** `c223ebb` (Ronda 11) · `ec3f31a` (Ronda 12) · `16b94e7` (Ronda 13) · `4788d21` (Ronda 14) — rango `b5bb433..4788d21`.

---

## 1. Roster de despliegue — 40 agentes, 4 rondas

### Ronda 11 — Motor de detección (agentes 31–40)

| # | Rol | Alcance | Entrega clave |
|---|-----|---------|---------------|
| 31 | Arquitecto de Índices CIDR/LPM | intel.go | diseño completo del índice por primer octeto, edge-cases verificados (v6, /0–/7, mapped, no canónicos) |
| 32 | Auditor de Semántica de Matching | intel.go | 6 hallazgos verificados empíricamente (F1 aislamiento de fichero, F4/F5 stats de duplicados, F6 userinfo) |
| 33 | Diseñador de Pruebas | intel tests | 11 gaps de cobertura + oráculo diferencial + benchmark del P1 |
| 34 | Auditor de Detección Beacon/C2 | beacon.go | 6 hallazgos (H1 rate-limit, H2/H3 canonicalización, H4 allocs, H5 SIM) + diseño del feature alias |
| 35 | Auditor de Estado de Correlación | correlate/ | diseño de persistencia (opción A) + 4 hallazgos (host vacío P2, span inmortal P3) |
| 36 | Verificador de Sigma/Escenarios | sigma, scenrun | H1 mapa anidado, H2 timeout muerto, H3 selection vacía, H4 sin recover, H5 contains\|all |
| 37 | Auditor de Threshold/Suppress/Risk | threshold, suppress | H1 KnownFields, H2 sombra condicional→incondicional, H3 purge sin rate-limit (485 µs/op medidos) |
| 38 | Ingeniero de Pipeline | FieldMap | inventario de las 2-3 construcciones por evento + diseño EvaluateFields/ObserveFields |
| 39 | Especialista en Privacidad | redact, superficies | mapa de 10 superficies expuestas + diseño del scrubber y de la pseudonimización LLM |
| 40 | Auditor de Docs vs Realidad | docs/ | 10 drifts + borrador de CHANGELOG + 5 TODOs obsoletos |

### Ronda 12 — Privacidad y correctitud (agentes 41–50)

| # | Rol | Alcance | Entrega clave |
|---|-----|---------|---------------|
| 41 | Diseñador de Patrones del Scrubber | redact | 13 patrones RE2 verificados empíricamente (compilación, FP, idempotencia, 1.1 µs con prefiltro) |
| 42 | Auditor de Superficies de Salida | alert.go | flujo Raise→Emit mapeado, punto de enchufe único, coste <5-10% por alerta |
| 43 | Auditor de Pseudonimización LLM | analyst.ts | choke point pre-stringify, sal HMAC persistida, validación off-loopback |
| 44 | Ingeniero de Métricas API | metrics.go | convención getter-polling, cableado exacto de sf_redact_hits_total |
| 45 | Auditor de Flags y Config | flags.go | patrón flag→env, envBool default-ON, validación fail-fast, banner honesto |
| 46 | Implementador del Guard Sigma | convert.go | guard structured() en 2 puntos + traducción exacta de contains\|all + fixture |
| 47 | Implementador del Watchdog Scenrun | scenrun.go | watchdog AfterFunc vs ctx (decisión razonada), recoverRun, seam runOneFn |
| 48 | Fixer de Correlación | observe.go | fixes (a) host-scope sin st.hosts y (b) re-anclaje por paso, con riesgos acotados |
| 49 | Guardián de la Evidencia | tests | 16 pins existentes verificados + suite del scrubber + invariantes del fuzz |
| 50 | Documentador de la Redacción | docs | textos exactos para README, OPERATIONS, MODELO-DE-AMENAZAS, CHANGELOG |

### Ronda 13 — Rendimiento y alias (agentes 51–60)

| # | Rol | Alcance | Entrega clave |
|---|-----|---------|---------------|
| 51 | Revisor del Refactor FieldMap | rules/threshold/suppress | tabla de líneas exactas + orden de fases en process() + riesgo del enriquecimiento |
| 52 | Diseñador del Feature Alias | beacon.go | plano P1–P7 (constantes, tipo, lectura/escritura, sweep, fire, excludes) + 6 tests |
| 53 | Ingeniero de Rendimiento Rust | sensor/src | spool 1 syscall/línea, socket sin batching, DACL runtime ausente; planes de batching |
| 54 | Auditor de Rutas Calientes API | api.go | P1 statsSnapshot sin caché, P2 queries sin ctx, broadcast re-convirtiendo el frame |
| 55 | Auditor de Ingesta | ingest.go | **P1 SourceIP sin cap (8 GiB fijables)**, caps faltantes, 4× ToLower del host |
| 56 | Auditor de Consultas de la Store | store.go | P1 prune retiene wmu todo el barrido, índices search inservibles, pool de 2 conns |
| 57 | Ingeniero Frontend | web/console | 44 usos de useEngine, plan del split de contexto, entity-graph O(260·n²) por frame |
| 58 | Diseñador de Benchmarks | 5 paquetes | BenchmarkAlertRaise/IngestDecode/ThresholdObserve/SuppressCheck/CorrelateObserve |
| 59 | Implementador TS Pseudonimización | console-service | ficheros, firmas, validación y 6 tests bun con fixture compartido Go↔TS |
| 60 | Verificador de Coherencia | cross-ronda | detectó el drift OpenAPI de redact_kinds, verificó interacciones CIDR↔scrubber |

### Ronda 14 — Docs, fuzz, gates y verificación (agentes 61–70)

| # | Rol | Alcance | Entrega clave |
|---|-----|---------|---------------|
| 61 | Spec Batching del Spool | queue.rs | esqueleto compilado y testado fuera del repo (11/11) |
| 62 | Spec Batching del Socket | transport.rs | send_lines + drain greedy + fallback línea a línea + gate para testear en Linux |
| 63 | Spec Gates de Referencia | use-engine-stream.ts | helper + 4 call-sites del poll de 2s + import muerto confirmado |
| 64 | Spec Throttle del Entity-Graph | entity-graph | hook useThrottledInput + 4 callers + early-exit del layout |
| 65 | Spec AlertRow Memo | alerts-view.tsx | extracción con React.memo y props estables |
| 66 | Consolidador de CHANGELOG | CHANGELOG.md | entrada completa de las rondas 11–13 lista para pegar |
| 67 | Reconciliador de TODO/docs | TODO, docs | 4 ítems verificados cerrados con commit de referencia + cifras reales |
| 68 | Auditor de Concurrencia/ctx | cross | 4 focos de las rondas 11–13 limpios + plan de ctx para QueryEvents/QueryAlerts |
| 69 | Proveedor de Semillas de Fuzz | 3 paquetes | 6 semillas exactas validadas ejecutándolas contra el código real |
| 70 | Verificador del Plan de Estrés | scripts | presupuesto de alertas, coste del alias acotado, asserts de dev-tests intactos |

**Total:** 40 agentes en 4 rondas, todos read-only salvo el orquestador; ~110 hallazgos consolidados y 4 diseños de función implementados.

---

## 2. Funciones nuevas de la sesión (4)

1. **Índice CIDR/LPM para intel** (Ronda 11): buckets por primer octeto (`nets4`/`nets6 [256][]int32` + fallback lineal para prefijos <8 bits), orden determinista más-específico-primero. El match CIDR pasa de escaneo lineal por evento a **163 ns/op con 20k CIDRs** (~2000×), con oráculo diferencial contra el escaneo bruto que hace imposible un bucket-miss silencioso.
2. **Scrubber de secretos en superficies salientes** (Ronda 12): 13 patrones RE2 (PEM, JWT, AWS, GitHub, Slack, userinfo-URL, Bearer/Basic, `net use`, flags CLI, KV) con prefiltros baratos y modo `tail4` (conserva los 4 últimos runes para triaje). Un único punto de redacción en `alert.Manager` cubre consola, JSON, SSE, SQLite alerts, webhook, SIEM y bundle; **la evidencia cruda de eventos nunca se reescribe** (los mapas alias se clonan solo si hay hit). Flags `-redact-secrets` (ON por defecto) y `-redact-mode`, banner honesto, contadores `sf_redact_hits_total{kind}` en `/metrics`.
3. **Alias dominio/IP del detector de beaconing** (Ronda 13): un destino conocido solo por IP hereda el dominio de la última resolución DNS que lo trajo (tabla con TTL 10 m y cap 4096): el tráfico E3 (solo IP) y el ETW (dominio+IP) caen en la **misma clave beacon** — la evidencia de un mismo C2 ya no se parte en dos anillos que ninguno alcanza `min_count`. El summary anota `(alias <ip>)` y `excludes()` se aplica al dest ya aliasado.
4. **Watchdog de ejecución de escenarios** (Ronda 12, diseñada en la 11): `timeout_ms` era un parámetro muerto — un replay colgado dejaba el run `running` para siempre y todo `POST /api/scenarios/run` respondía 409 hasta reiniciar. Ahora un watchdog marca el run como `error` con detalle, libera el slot, `recover()` convierte un pánico del replay en un run fallido en vez de un motor muerto, y `Run.Error` viaja en el wire (enum OpenAPI actualizado).

---

## 3. Rondas de implementación (commits en `100agentes`)

### Ronda 11 — Motor de detección (`c223ebb`)

- **intel:** índice CIDR/LPM (función nueva, ver arriba); aislamiento de recarga por fichero — **un fichero roto ya no congela TODA la actualización de intel** (antes, una línea >4 KiB mantenía el snapshot anterior indefinidamente y los IOCs borrados nunca dejaban de matchear): `PartialLoadError` distingue carga parcial de fallo total, y el engine registra el parcial en arranque y ticker; dedup de CIDRs entre listas; duplicados contados en `Skipped` (estadísticas honestas por lista); `user:pass@host` en URLs ya no pierde el host.
- **beacon:** admisión con tabla llena rate-limited + evicción muestreada O(64) entre barridos (el contrato de arranque de la clave hot queda pinado); destino canónico (IPv4-mapped y FQDN con punto final comparten clave y ya no evaden `excludes`); telemetría no parseable descartada; `excludes()` sin concatenaciones por evento; el tag SIM muere con el anillo al reiniciar.
- **threshold:** purge global de saturación rate-limited (con tabla llena de claves vivas pagaba ~485 µs/op medidos); la evicción weakest-first sigue garantizando la admisión.
- **suppress:** `KnownFields(true)` en la carga — una errata (`hosts:` plural) silenciaba la regla en TODOS los hosts; `EOF` = conjunto vacío; `SuppressedEvent` evalúa TODAS las coincidencias estructurales (una condicional primera ya no hace sombra a una incondicional posterior).
- **Tests nuevos:** 13 (oráculo diferencial, más-específico gana, IPv6/cruce de familias, mapped-v4, reload reconstruye el índice, carga parcial/total, userinfo, stats de duplicados, canonicalización beacon, KnownFields, sombra) + `BenchmarkIntelMatchNets`.

### Ronda 12 — Redacción de secretos (`ec3f31a`)

- **Scrubber** (función nueva, ver arriba) con su suite completa: tabla por kind con los falsos positivos del propio repo como casos (`logonpasswords` sin separador, `corp/admin:pw@dc01` sin esquema, `findstr /si password *.xml` con wildcard, `-p` de una letra), no-op en texto limpio, clonado selectivo, **anti-mutación del evento crudo** (`reflect.DeepEqual` antes/después), idempotencia y `FuzzScrub` con invariantes UTF-8/idempotencia (113k ejecuciones).
- **sigma:** guard `structured()` — una sub-selección anidada ya no se traduce en silencio a `ieq "map[...]"` (condición muerta que parecía armada); soporte de `contains|all` (una condición icontains por elemento: el motor ANDa dentro de la regla, que es exactamente el contrato `|all`).
- **scenrun:** watchdog + recover + `finishRun` único idempotente + guard anti-zombie; `Run.Error` en el wire.
- **correlate:** las cadenas host-scoped con feeds de `Host` vacío ahora completan (la entidad de la clave YA es el host); re-anclaje de span — el estado inmortal que refrescaba `expires` sin poder completar suelta los pasos vencidos.
- **Docs:** fila en el modelo de seguridad del README, sección "Secret redaction" en OPERATIONS, párrafo en MODELO-DE-AMENAZAS, fragmento en `changelog.d/`.

### Ronda 13 — Rendimiento y alias (`16b94e7`)

- **Alias dominio/IP** (función nueva, ver arriba) con 5 tests (fusión, TTL, cap, excludes, IPs no enrutables) y el contrato del test de claves separadas actualizado: 12 muestras fusionadas ahora disparan — antes la misma evidencia partida **nunca** disparaba.
- **FieldMap compute-once:** `EvaluateFields`/`ObserveFields`/`MatchesEventFields` + propagación del mapa desde `process()` — de 2-3 construcciones por evento a 1 (los wrappers `Evaluate`/`Observe` siguen para tests y caminos fríos); `SuppressedEvent` construye el mapa una vez por llamada.
- **API:** el frame SSE se convierte a `[]byte` UNA vez por evento (antes una conversión por suscriptor, hasta 64 copias); `escapeLabelValue` usa un replacer de paquete.
- **store:** `Prune` toma el write-lock POR CHUNK (antes congelaba la ingesta durante todo el barrido tras un downtime); `severity IN` sargable (adiós `LOWER()` por fila); índice nuevo `events(type, ts)`.
- **ingest (P1):** cap de `Network.SourceIP` — `thresholds.yaml` agrupa por ese campo y el detector lo fijaba como clave viva: un feed hostil podía aparcar ~1 MiB por clave en una tabla de 8192 (~8 GiB fijables).
- **OpenAPI:** `redact_kinds` documentado (drift detectado por el agente 60 antes de la ronda).

### Ronda 14 — Docs, fuzz y gates (`4788d21`)

- **CHANGELOG:** entrada consolidada de las rondas 11–13; **TODO.md:** 4 ítems obsoletos marcados con commit de referencia y línea huérfana eliminada (IDEA-10 sigue parcial, verificado); **DETECCION-Y-EVIDENCIA:** cifras reales (114 reglas, 12 tipos, 13 secuencias); **OPERATIONS:** fila de `engine secret-write`.
- **Semillas de fuzz** validadas contra el código real: `contains|all` y sub-selección anidada (sigma), CIDR no canónico `10.0.0.1/8` (intel).
- **TS:** gates de referencia funcionales en el poll de 2s (rules/suppressions/sequences/respondState — antes identidad nueva cada 2 s repintaba a todos los consumidores lentos), patrón del agente 26; import muerto eliminado.
- **Diseños verificados para la siguiente ronda:** batching del spool Rust (esqueleto con 11/11 tests fuera del repo), `send_lines` del transporte, throttle del entity-graph, extracción `AlertRow` con memo, `ctx` para las queries de la store.

---

## 4. Verificación y prueba de estrés (sesión 3)

### Verificación estática y unitaria (tras cada ronda)

| Check | Resultado |
|-------|-----------|
| `go build ./...` | OK |
| `go vet ./...` | 0 avisos |
| `go test ./...` | **40/40 paquetes OK** |
| `go test -race` (intel, beacon, suppress, threshold, engine) | 0 carreras |
| `gofmt -l` | limpio |
| `check_openapi.py` | OK — 43 rutas, 57 Stats fields, spec sincronizada |
| `check_rule_inventory.py` | OK — 114 reglas, ids únicos |
| `check_workflows.py` | OK |
| `FuzzScrub` | 113k ejecuciones, 0 fallos |
| **Tests nuevos de la sesión** | **32** (netindex 9, canon_r11 3, alias_r13 5, strict_r11 2, scrub 6, alert/redact 3, observe_r12 2, watchdog_r12 2) |
| Cobertura de paquetes nuevos | redact 81.2% · alert 81.8% · intel 84.8% · scenrun 89.2% |

### Prueba de estrés end-to-end (binario de esta rama, con `-redact-secrets` ON)

| Fase | Carga | Resultado |
|------|-------|-----------|
| A | **80.000 eventos mixtos** (process/network/file/registry, 5 tipos de amenaza intercalados) por **8 conexiones concurrentes** | Ingesta completa en 4,2 s de envío, drenaje **~40k eps**, **0 dropped**, RSS 65 MB |
| B | **10 clientes SSE** durante 12 s bajo tráfico sostenido | ~18.500–22.650 frames por cliente, **0 errores** |
| C | **600 peticiones API concurrentes** sobre 5 endpoints | **100% 200 OK**, p95 = **10 ms** |
| D | Apagado graceful (SIGTERM) + **reinicio en frío** sobre BD de 72,8 MB | **98.000 eventos intactos** (80k fase A + 18k fase B) |

La novedad de esta sesión: todo el ciclo corrió con el **scrubber de secretos activo** (default ON), el **alias de beacon** armado y el **índice CIDR** en carga — sin cambio de perfil frente a la sesión 2 (40k eps, RSS 65 vs 70 MB, p95 10 vs 9 ms: ruido del sandbox).

---

## 5. Verificación independiente de la ronda 15 (agentes 71–80)

Diez agentes verificadores auditaron el estrés y el estado final por código:

- **A71:** el contador `events_total` es exacto (atómico, 1 incremento por evento válido); ni el dedup (es de alertas) ni el scrubber (solo muta texto de alertas) pueden descartar eventos.
- **A72:** marshal único del frame SSE confirmado, write deadline de 30 s intacto; corrección: el cap real de clientes SSE es **64**, no 128 como se registró en la sesión 2.
- **A73:** p95 de 10 ms aceptable (el coste de `/api/stats` es O(ring) ≤ 100 µs sin lock cruzado); el 9→10 ms es ruido, sin regresión real; en modo store el p95 de events/alerts subiría (68–294 ms en auditorías previas) — la caché de stats solo haría falta a ~10³ req/s.
- **A74:** la cuenta 80k+18k=98k cuadra con `store_events`; el shutdown espera las 4 goroutines de mantenimiento y el Prune por-chunk es crash-safe; el fsync cubre lifecycle/incident (la durabilidad de los 98k recae en SQLite/WAL).
- **A75:** el scrubber NO redacta los command_lines del estrés (correcto por diseño: caza secretos, no IOCs); coste ~4 µs/alerta coherente con RSS 65 MB.
- **A76:** 40/40 verde; 32 tests nuevos; coberturas listadas arriba.
- **A77:** las 4 funciones nuevas tienen implementación + test de regresión + wiring + documentación (4/4).
- **A78:** OpenAPI, inventario de reglas y workflows en verde.
- **A79:** esquema de este informe.
- **A80:** **0 filtraciones de secretos** — sin tokens en el árbol, en los commits ni en el remote; los tests usan solo dummies.

---

## 6. Falsos positivos descartados (transparencia)

- **Agente 75:** afirmó que `ScrubStats()` no está expuesto y que `/metrics` no publica los contadores del scrubber. FALSO: el wiring existe (`run.go:817` llama `hub.SetRedactStats(redact.ScrubStats)`, setter en `api.go:544` y familia `sf_redact_hits_total` renderizada en `metrics.go`). Probablemente leyó un árbol sin la ronda 12 aplicada.
- **Agente 72:** citó "cap 128 (ronda 7)" como premisa — el valor real en el código es 64. Corregido el registro aquí; el efecto práctico del estrés (10 ≪ 64) no cambia.
- **Agente 74:** marcó "72,8 MB no documentado" como discrepancia con los 69,5 MB de la sesión 2 — no lo es: es la medición de ESTA sesión (más eventos: 98k vs 98k… y columnas de las rondas 12-13), tomada del mismo mecanismo `stat`.

---

## 7. Pendiente para la próxima ronda (roadmap vivo)

1. **Sensor Rust:** batching del spool (`queue.rs`, esqueleto verificado con 11/11 tests) y `send_lines` del socket con drain greedy y fallback; DACL runtime owner-only para credencial y spool en Windows (`Win32_Security`).
2. **Frontend:** split del contexto `useEngine()` (status vs telemetría caliente, 44 consumidores), throttle del entity-graph (`useThrottledInput` + early-exit del layout O(260·n²)), extracción `AlertRow` con memo.
3. **Pseudonimización pre-LLM en el hub TS** (`pseudonymize.ts`, diseño completo del agente 43/59 con fixture compartido Go↔TS).
4. **Store:** `ctx` en `QueryEvents`/`QueryAlerts` (precedente `QueryAlertPage`), pool >2 conexiones, evaluación de FTS5 para los `LIKE '%…%'`.
5. **Persistencia del estado de correlación** (diseño del agente 35: snapshot SQLite + Restore con filtro de fingerprints vivos).
6. **Cache TTL de `statsSnapshot`** (250-500 ms) si la flota crece.
7. **Benchmarks** de alert/ingest/threshold/suppress/correlate en el nightly (agente 58).

---

## 8. Nota de seguridad sobre credenciales

El token de GitHub compartido en la conversación sigue expuesto en el historial del chat. **Debe revocarse/rotarse en GitHub → Settings → Developer settings → Personal access tokens** en cuanto cierre esta sesión. Ningún token ha quedado escrito en el repositorio, los commits ni los informes (verificado por el agente 80: árbol, mensajes de commit y remote limpios; el remote local se limpia tras cada push).

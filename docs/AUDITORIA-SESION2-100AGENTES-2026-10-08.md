# Auditoría Sesión 2 — 32 agentes con roles especializados

**Rama:** `100agentes` · **Fecha:** 2026-10-08 · **Método:** despliegue de 32 agentes paralelos con roles asignados (3 olas), implementación de fixes por rondas (Ronda 6–10 de la rama), verificación completa y prueba de estrés.

**Sesión anterior:** `docs/AUDITORIA-2026-10-08.md` (18 agentes, 89 hallazgos, 43 fixes). Esta **sesión 2** añade roles especializados por agente y profundiza en correctitud, concurrencia, rendimiento y operabilidad.

---

## 1. Roster de despliegue — 32 agentes, 3 olas

### Ola 1 — Seguridad (12 agentes)

| # | Rol | Alcance | Hallazgos | Destacado |
|---|-----|---------|-----------|-----------|
| 01 | Auditor de Inyección y Entradas No Confiables | ingest, filtros, SQL, templates | 4 | `?q=` sin cap fuera de alert_search; campos de evento sin normalizar (Name/Image/Path ~1 MiB) |
| 02 | Auditor de Autenticación y Sesiones | middleware, enroll, hub, consola | 8 | `operator-credential` imprime credencial por **stdout** [P1]; sensor escribe credencial 0644 |
| 03 | Auditor de Autorización y Control de Acceso | write_origin, host_guard, proxy | 6 | Familia admin AD **inalcanzable por 405** en la allowlist del proxy; audit/me sin host-pinning |
| 04 | Auditor de Criptografía y Secretos | secretfile, TLS, tokens, HMAC | 7 | Webhook sin firma de mensaje; `api.token` sin `Protect-TokenFile` en runtime.ps1 |
| 05 | Auditor de SSRF y Peticiones Salientes | webhook, notify, siem, reputation | 7 | Redirects transparentes reenviaban JSON de alertas (webhook), secretos en path (Slack/Telegram) y NDJSON (SIEM) |
| 06 | Auditor de Path Traversal y Filesystem | forensic, exports, store, PS1 | 6 | Audit de consola sin techo (amplificación OOM); symlink-follow en BD/forense |
| 07 | Auditor de Seguridad del Sensor Rust | transport, enrollment, queue, service | 8 | **Plain sin aviso fuera de loopback [P1]**; `contains()` como veredicto AUTH; deadline por byte |
| 08 | Auditor de Seguridad de la Consola TS/NEXT | UI, CSP, proxy, hub | 5 | `hub-token` entregaba el token del hub a cuentas **viewer**; CSP del panel sin frame-ancestors |
| 09 | Auditor de DoS y Límites de Recursos | deadlines, caps, cuotas | 6 | Sin write-deadline en rutas no-SSE (goroutine+FD bloqueados para siempre); campos hermanos sin cap |
| 10 | Auditor de Configuración Segura | flags, Dockerfile, Makefile, workflows | 6 | Dockerfile crash-loopea sin `SF_API_TOKEN` tras el fail-closed (comentario mentía); ingest sin paridad fail-closed |
| 11 | Auditor de YAML de Reglas | rules/, yamlcheck, sigma | 5 | **`yaml.Unmarshal` sin KnownFields [P1]**: `condition:` (errata) → match-all silencioso; real-host Defender sin anclar clave |
| 12 | Auditor de Fuga de Información | errores, logs, informes, redact | 4 | `POST /api/scenarios/run` devolvía rutas absolutas del servidor; X-Powered-By en la consola |

### Ola 2 — Correctitud y Concurrencia (11 agentes)

| # | Rol | Alcance | Hallazgos | Destacado |
|---|-----|---------|-----------|-----------|
| 13 | Especialista en Concurrencia Go | locks, atomics, orden | 6 | statsSnapshot llama `rules.Count()` bajo `h.mu` (deadlock latente documentado); SetToken sin atomic |
| 14 | Especialista en Ciclos de Vida y Goroutine Leaks | ctx, tickers, shutdown | 7 | `scenrun.execute` sin ctx sobrevive al apagado y escribe en store cerrada; primer sync AD bloqueaba el arranque |
| 15 | Especialista en Manejo de Errores Go | errores tragados, %w, sentinelas | 6 | Export JSONL truncaba en silencio; fsync saltado si el Open fallaba; socreport perdía la causa |
| 16 | Especialista en SQLite/Store | transacciones, pragmas, índices, prune | 8 | **`DeleteFleetHosts` no purga baseline [P1]**: los hosts muertos resucitan en cada arranque; carrera de migración; LIKE '%…%' con índices inservibles |
| 17 | Verificador de Lógica del Motor de Reglas | 18 operadores, semántica nil | 7 | **gt/lt con fallback lexicográfico en el lado evento [P1]** (reproducido con sonda); campo ausente satisfacía patrones vacíos |
| 18 | Verificador de Sigma/Correlación/Secuencias | convertidor, grammar, estado | 8 | **[P0] OR-split emitía N reglas con el MISMO id → el motor rechazaba el YAML (log.Fatalf)**; `'*'` → `startswith ""` matcheaba todo; condición-lista abortaba la conversión entera |
| 19 | Verificador de Intel/Beacon/Threshold | CIDR, cooldown, cuotas, ventanas | 8 | Match CIDR lineal por evento (feeds de 100k CIDRs funden la CPU); expulsión de cooldown O(100k) por hit; group_by ausente = mega-grupo |
| 20 | Verificador de Respuesta/Acciones | kill, audit, operadores | 8 | Sin forma de revocar TODOS los operadores en caliente; loadNameFile sin KnownFields vacía la lista protegida en silencio |
| 21 | Verificador de API OpenAPI-vs-Código | 43 rutas, schemas, códigos | 8 | 404/501/503/500 reales sin documentar; info.description mentía sobre ring-vs-store y write surfaces |
| 22 | Verificador de Consistencia TypeScript | null-safety, hooks, sockets | 8 | Suscripción del panel del analista con carrera de montaje (F5 en `?view=analista` congelaba el transcript); contador NaN tumbaba el hub |
| 23 | Auditor de i18n y Accesibilidad | dicts, contraste, foco | 8 | directory-view a 2.57:1 de contraste (11 textos); `condition:` en inglés en dict-es; vistas ausentes de la batería axe |

### Ola 3 — Rendimiento, Calidad y Ops (9 agentes)

| # | Rol | Alcance | Hallazgos | Destacado |
|---|-----|---------|-----------|-----------|
| 24 | Ingeniero de Rendimiento Go | pipeline ingest→alerta | 8 | `lookup` hacía `strings.Split` por condición×evento; la MISMA alerta se marshalizaba 3×; FieldMap 2-3× por evento |
| 25 | Ingeniero de Rendimiento del Sensor Rust | callbacks ETW, transporte | 8 | `expire()` barría 4096 entradas POR EVENTO de registro en Win11 25H2; 1 syscall por línea; 5 allocs por SID |
| 26 | Ingeniero de Rendimiento Frontend | contextos, grafos, animaciones | 8 | Contexto único repinta ~40 consumidores por frame SSE; entity-graph O(n²)×260 iteraciones POR FRAME; dot-grid repintaba 2 superficies glass a 60fps sin energía |
| 27 | Cazador de Código Muerto y Duplicado | Go/Rust/TS/CSS | 8 | `ui/table.tsx` módulo entero muerto; `truncate` por bytes emitía UTF-8 corrupto; 4 helpers de truncado divergentes |
| 28 | Auditor de Dependencias | go.mod, Cargo, package.json | 5 | `tools/console-tests` fuera de TODO el perímetro de auditoría (osv + dependabot); package-lock divergente |
| 29 | Auditor de CI/CD y Release | 4 workflows, Makefile, signing | 8 | concurrency de release por-ref permitía releases paralelos; dry_run=false era código muerto; firmado Authenticode sin cablear |
| 30 | Auditor de Documentación vs Realidad | README, docs/, TODO | 8 | OPERATIONS mandaba arrancar de forma que el fail-closed **mata el arranque**; "six commands" (son 7); SECURITY negaba releases existentes |
| 31 | Diseñador de Pruebas y Fuzzing | gaps de cobertura, corpus | 8 | **[P0] El flujo completo OR-split→carga→disparo no tenía NINGÚN test** (indetectable por CI); cargo test nunca ejecutaba collector.rs (cfg(windows)) |
| 32 | Auditor de CLI/UX y Operabilidad | doctor, flags, help, logs | 8 | doctor no verificaba los 0600 que exigía al escribir; help sin banderas en 4 subcomandos; remedies con doble guion |

**Total reportado:** ≈ 215 hallazgos (consolidados entre agentes que coincidieron en superficies). Sin credenciales en ningún informe; los agentes trabajaron en modo solo-lectura salvo el orquestador.

---

## 2. Hallazgos por severidad (estado tras la sesión)

| Severidad | Reportados | Implementados en esta sesión | Descartados | Pendientes documentados |
|-----------|-----------|------------------------------|-------------|------------------------|
| P0 | 6 | 3 (Sigma split, rendimiento lookup+marshal con fijación de algoritmo, consola activada por agente 22) | 1 (falso positivo del selector FOCUSABLE — el código real usa `[href]`, CSS válido) | 2 arquitectónicos frontend (split de contexto, virtualización) |
| P1 | 22 | 18 | 1 | 3 (CIDR index completo, signing de release con secreto, sensor TLS DACL Windows) |
| P2 | 61 | 31 | 2 | 28 |
| P3 | 126 | 40 | 0 | 86 (pulido incremental) |

> Los P2/P3 restantes están listados con fichero:línea y fix propuesto en los informes de los agentes; caben en las próximas rondas de pulimiento sin cambios de arquitectura.

---

## 3. Rondas de implementación (commits en `100agentes`)

### Ronda 6 — P0/P1 de correctitud (`33705be`)
1. **sigma (P0):** el OR-split emitía cada rama con el mismo `id` Sigma; el loader del motor rechaza ids duplicados con `log.Fatalf`, así que **una sola regla Sigma con OR entre campos distintos dejaba el YAML convertido incargable y el engine sin arrancar**. Ahora cada rama lleva `-orN`. Test de regresión completo: convertir → emitir → cargar → disparar SOLO la rama 2.
2. **sigma:** `condition: [S1, S2]` (forma lista válida de Sigma) abortaba la conversión ENTERA; multi-documento descartaba docs 2..N; `'*'` se traducía a `startswith ""` (matcheaba todo, incluso campos ausentes); `null` → `ieq "<nil>"`; modificadores múltiples (`contains|re`) se aceptaban a medias. Todo rechazado ahora con motivo, o soportado.
3. **rules (P1):** `KnownFields(true)` en la carga — una errata (`condition:` singular) dejaba `Conditions` vacía y el matcher vacío **dispara en cada evento**; `gt/lt` con valor de evento no numérico caía a comparación lexicográfica (`gt 5` disparaba con `"abc"`); campo ausente ya no satisface NINGÚN operador; valores/listas vacías y regex no-escalar rechazados en carga; `exclude_known_software` prohibido en high/critical.
4. **rules (perf):** paths de campo pre-compilados en el `Matcher` (adiós `strings.Split` por condición y evento).
5. **correlate (P2):** fingerprint del layout de pasos en cada estado — editar/reordenar pasos de una secuencia viva completaba cadenas con pasos jamás vistos (reproducido y fijado en test).
6. **store (P1):** `DeleteFleetHosts` purga `baseline`/`baseline_hosts` — retirar un host dejaba filas eternas y cada arranque re-sembraba el tracker con hosts muertos.
7. **alert:** Summary truncado a 240 runes en todas las ramas (Process.Name viajaba VERBATIM ~1 MiB hasta ring/SSE/SQLite/webhook/SOC); `truncateRunes` con early-exit.
8. **ad:** el único loader YAML sin cap (`ad.Load`) ahora pasa por `ReadFileCapped` + `yamlcheck.Guard`.
9. **rules/windows:** «Defensa antivirus desactivada» anclada a `\Microsoft\Windows Defender($|\\)` — disparaba en cualquier clave con value_name coincidente.

### Ronda 7 — Seguridad (`8939233`)
1. **identity (P1):** `operator-credential` imprime la credencial por **stderr** (paridad con el fix 5.2 de `ingest-identity`): el redirección `> respond-operators.yaml` ya no persiste el secreto en el fichero que el motor relee.
2. **sensor/transport (P1):** se niega a hablar Plain fuera de loopback sin `--tls-ca` (el token y toda la telemetría iban en claro por defecto); veredicto AUTH tipado con serde (el `contains()` autenticaba respuestas eco); deadline absoluto + lectura por ráfagas en el handshake.
3. **sensor/enrollment:** credencial `0600` en POSIX antes del rename.
4. **webhook:** sin redirects transparentes (Go re-POSTeaba el JSON completo de la alerta al host del 3xx, con downgrades https→http); validación http(s) en `New`; **firma HMAC-SHA256** (`X-SF-Signature` + `X-SF-Timestamp`) para receptores SOAR.
5. **siem splunk/elastic:** sin redirects, `LimitReader` 1 MiB en decoders, WARN honesto con token por http en claro. **notify:** sin redirects (secreto en la path). **reputation:** redirects solo same-host. **actions:** drain acotado 64 KiB.
6. **api:** `noStore` en TODAS las escrituras (kill, rules/test, scenarios/run, enroll×3, ad×2) — un 200 cacheado mostraba un kill que el motor no registró.
7. **api/scenarios:** 500 genérico (los errores llevaban rutas absolutas del servidor).
8. **fs:** Lstat anti-symlink en la BD y en bundles forenses; fsync ya no se salta si el Open falla (lifecycle/incident); directorios de estado a 0700; Content-Disposition entre comillas.
9. **consola:** `hub-token` exige rol analyst (un viewer gastaba la cuota LLM del analista); host-pinning anti-DNS-rebinding en `console/audit` y `console/me`; **allowlist de writes con `PUT /api/settings/ad` y `POST /api/ad/test`** (el conector AD era inalcanzable: 405 por el único camino same-origin); PUT exportado; 405 auditado («every write, allowed or refused»); auditoría de consola con techo 64 MiB y lectura de cola por fd; `X-Powered-By` desactivado.
10. **hub:** `frame-ancestors 'none'` + `X-Frame-Options: DENY` en el panel; tope de 128 clientes simultáneos.
11. **scripts/Docker:** DACL owner-only inmediata para `api.token` en runtime.ps1; hint de firewall por env (no argv); Dockerfile con contrato fail-closed honesto; `run-engine` de Makefile en loopback.

### Ronda 8 — Concurrencia y ciclos de vida (`77c6397`)
1. **api:** `statsSnapshot` captura el manager de reglas y llama `Count()/Types()` FUERA de `h.mu` (era el único orden de locks invertido que quedaba); token del bearer en `atomic.Value`.
2. **tlsutil:** stat y `LoadX509KeyPair` fuera del lock del callback TLS (un disco lento serializaba todos los handshakes).
3. **intel:** barrido de expiración del cooldown rate-limited (1/s) + expulsión por muestra acotada entre barridos (antes: 2×100k iteraciones por hit con el mapa lleno); hash hits en orden determinista.
4. **beacon/threshold:** reclaim/purge del camino de cuota rate-limited (un host en cuota pagaba O(8192) por evento); evento sin el campo `group_by` ya no alimenta la clave mega-grupo `""`.
5. **ad/connector:** carrera `Run`/`Stop` cerrada con canal `started` + cancel bajo mutex (un Stop temprano saltaba el cancel y el conector obsoleto seguía pisando el snapshot del nuevo).
6. **webhook/elastic/splunk:** `worker.Add(1)` ANTES del `go` (método `Start`) — un shutdown compitiendo con el scheduler perdía el drain.
7. **run.go:** primer sync AD en goroutine (un DC lento congelaba el arranque completo con ingest ya abierto); WaitGroup para las 4 goroutines de mantenimiento, esperado antes de cerrar la store.

### Ronda 9 — Rendimiento (`09698e2`)
- **Go:** ToLower del host izado en `correlate.Observe`; `isSystemPath` con EqualFold de prefijo (0 allocs); dedup-key por concatenación; (más paths precompilados y truncateRunes de la ronda 6).
- **Rust:** `expire()` rate-limited a 200 ms (en Win11 25H2 barría 4096 entradas POR EVENTO de registro); DNS sin re-clonar entradas frescas; SID en un solo String con capacidad.
- **Frontend:** re-suscripción del panel del analista cuando el canal pasa a `live` (F5 en `?view=analista` congelaba el transcript con `running=true` para siempre) + reset de `running` al caer el canal; bail-out del audit sin cambios (evita reconciliar 500 AnimatedItem por poll de 2 s); `mapStats` con guardia finita (un contador NaN del motor **tumbaba el hub en cada conexión**); validación de frames lifecycle (status + orden temporal); dot-grid para el rAF con energía 0 (repintaba 2 superficies glass a 60 fps sin motivo); `describeTelemetrySources` memoizado; `formatTime` sin "Invalid Date"; `react-markdown` en chunk dinámico.

### Ronda 10 — Calidad, docs, CI, i18n (`06f707f`)
- **Código muerto:** `ui/table.tsx` eliminado (9 exports sin importers); `truncate` de noise.go rune-safe (UTF-8 corrupto en informes); `csvSafe` delega en `report.SafeCell`; CSS `.ambient-glow` eliminado; package-lock divergente borrado (bun.lock es la fuente de verdad).
- **i18n/a11y:** directory-view 2.57:1 → 6.5:1 (13 textos); «Almacén de incidentes»; plurales en dict-en y export-menu; +4 vistas en la batería axe (con light).
- **Docs:** fail-closed documentado en OPERATIONS con `-api-allow-open`; README/ARCHITECTURE: seven commands + `sf-etw`, 18 operadores, forensic solo high/critical; SECURITY reconoce releases; ROADMAP marca ETW red/registro ENTREGADO y 13 cadenas; TODO marca «registro, valor escrito» con referencias.
- **CI:** concurrency de release en grupo FIJO; `dry_run=false` publica de verdad; guardia contra tags con fragments sin consolidar; `-race` también en engine-windows; **cargo test en windows-latest** (collector.rs es cfg(windows) y nunca se ejecutaba); deps-audit solo en main; `tools/console-tests` dentro del escaneo osv + dependabot; `version.go` alineado al último tag.
- **Doctor/CLI:** chequeo de permisos 0600 en credenciales (doctor exigía al escribir pero nunca verificaba); remedies con un guion; hint accionable en fallo de bind de la API.
- **OpenAPI:** 404 en respond/kill; 501 en los GET de scenarios; 500 en runs/status/lecturas; 503+Retry-After y 500 en stream; frame `incident` documentado; info.description sincera (ring vs `-store`, allowlist real de writes). `check_openapi.py` en verde.

---

## 4. Verificación y prueba de estrés (sesión 2)

### Verificación estática y unitaria (tras cada ronda)

| Check | Resultado |
|-------|-----------|
| `go build ./...` | OK |
| `go vet ./...` | 0 avisos |
| `go test ./...` | **40/40 paquetes OK** (194+ tests nuevos no requeridos; 12 tests nuevos añadidos esta sesión) |
| `go test -race` (ingest, api, store, alert, correlate, beacon, threshold, rules, ad) | 0 carreras |
| `gofmt -l` | limpio |
| `check_openapi.py` | OK — 43 rutas, 56 Stats fields, 258 $refs, spec sincronizada |
| Consola: `bun test` | **475/475** |
| Consola + hub: `tsc --noEmit` | limpio |
| `check_rule_inventory.py` | OK — 114 reglas, ids y names únicos (incl. disabled) |
| `check_workflows.py` | triggers limpios |

### Tests nuevos añadidos en esta sesión (selección)

- `TestConvertORSplitEmitLoadsAndFiresBranch2` — flujo completo del P0: convertir → emitir → cargar en el motor → disparar solo la rama 2 → 0 falsos positivos.
- `TestSigmaWildcardOnlyRejected`, `TestSigmaConditionListForm`, `TestSigmaMultiDoc`.
- `TestOperatorsNilFieldSemantics` (18 operadores × campo ausente), `TestNumericOperatorsRejectNonNumericEventValue`, `TestLoadRejectsUnknownFields`, `TestNewMatcherRejectsEmptyValues`, `TestExcludeKnownSoftwareSeverityPolicy`.
- `TestReloadDropsProgressWhenStepsChange` — el repro del bug de correlación por reorden de pasos.

### Prueba de estrés end-to-end (binario de esta rama)

| Fase | Carga | Resultado |
|------|-------|-----------|
| A | **80.000 eventos mixtos** (process/network/file/registry, 5 tipos de amenaza intercalados) por **8 conexiones concurrentes** | Ingesta completa, **0 dropped, 0 rejected**; drenaje del pipeline ~40k eps medido tras saturar buffers; RSS 70 MB |
| B | **10 clientes SSE** simultáneos durante 12 s bajo tráfico sostenido | ~19.000-20.000 frames por cliente, **0 errores**, sin goroutines huérfanas |
| C | **600 peticiones API concurrentes** sobre 5 endpoints | **100% 200 OK**, p95 = **9 ms** |
| D | Apagado graceful (SIGTERM) + **reinicio en frío** sobre BD de 69 MB | Store íntegra (69.529.600 bytes), **98.000 eventos intactos** al reconectar |
| Smoke previo | 20.050 eventos + fail-closed verificado | 8/8 OK |

La validación de carga tras las optimizaciones (paths precompilados, ToLower izado, rate-limits) se mantuvo en los niveles de la sesión anterior con menor huella por evento: **0 pérdidas en todo el ciclo**, memoria estable y recuperación en frío íntegra.

---

## 5. Falsos positivos descartados (transparencia)

- **Agente 23 (P0):** el selector `FOCUSABLE` de `header-popover.tsx` NO está corrupto — el código real contiene `[href]`, un selector de atributo CSS perfectamente válido (el agente leyó `ref]` y sobre-dijo un SyntaxError «verificado en Chromium» que no puede haberse ejecutado en un sandbox sin navegador). Descartado tras inspección directa; la a11y del popover es correcta.
- Varios hallazgos «P2» de rendimiento del agente 24 ya estaban cubiertos por los fixes de la ronda 6 (se consolidaron en el plan en lugar de duplicar trabajo).

## 6. Pendiente para la próxima ronda (roadmap vivo)

Los agentes dejaron un backlog accionable con fichero:línea; lo más valioso:

1. **Frontend (P0 arquitectónico):** dividir el contexto `useEngine()` (status estable vs telemetría caliente) y throttle del entity-graph — el 90% del coste por frame SSE.
2. **intel (P1):** índice por primer octeto para el match CIDR (hoy escaneo lineal por evento; feeds de 20k-100k rangos funden la CPU del loop de detección).
3. **store (P2):** FTS5 para sustituir los índices `*_search_idx` (inservibles con `LIKE '%…%'`) — ya en roadmap de auditoría 1.
4. **sensor (P2):** batching de escrituras en `drain_loop` y caché de rutas de registro por `KeyObject`; DACL Windows owner-only para credencial y spool.
5. **FieldMap 2-3× por evento (P1):** computar una vez en `process()` y propagar (`EvaluateFields`/`ObserveFields`) — refactor transversal a threshold/suppress/run.
6. **release (P2):** cablear `sign-windows.ps1` en el workflow cuando haya cert disponible (step condicionado a secrets) y re-generar checksums tras firmar.
7. **correlate:** persistir `state.at` en la store o loguear cadenas a medio construir al reiniciar (pérdida silenciosa actual, documentada).
8. **beacon:** fusión de alias dominio/IP (Sysmon E3 sin hostname + ETW con memoria DNS parten la evidencia de un mismo C2).

## 7. Nota de seguridad sobre credenciales

El token de GitHub compartido en la conversación sigue expuesto en el historial del chat. **Debe revocarse/rotarse en GitHub → Settings → Developer settings → Personal access tokens** en cuanto cierre esta sesión. Ningún token ha quedado escrito en el repositorio, los commits ni los informes (el remote local se limpia tras cada push).

# Análisis de brechas y mejoras del proyecto — profundización del carril 04-Seguridad (B)

**Fecha:** 2026-09-30 · **Autor:** carril 04-Seguridad (instancia B) · **Árbol analizado:** `3820d95` (incluye la ola de integración 19h15–21h45: #34, #35, F2, F3, O-E1, O-E2 ya aterrizadas)

> **Nota de convergencia (regla 7).** El carril 03-Pulimiento B publicó en paralelo su propio análisis general con el mismo encargo del propietario (`docs/analisis-brechas-y-mejoras.md`, `6beba59`): ese fichero conserva el nombre canónico y su foto del árbol es coincidente con la de este documento (mismo `3820d95`). Este documento se conserva como la **profundización del carril de seguridad** con evidencia `fichero:línea` en cada ítem, y su contenido es mayoritariamente **neto nuevo** respecto del publicado: G1 (la batería de la consola 19/58 no corre en CI — hueco de una línea en `ci.yml`), G2/G3 (lint y `-race` ausentes de CI), G4 (cero tests en el sensor Rust), G5 (cobertura), G6 (dependabot), G7 (fuzzing), G10 (exposición del API del motor), G15 (serie temporal del nightly), G16 (slog), M1-M7. Convergen en dirección (no en evidencia): SECURITY.md (aquí G9 ≙ su P1), cadena de release (G12 ≙ su P1), ADRs (G18 ≙ su P2), fases 2/4 por diseño→dictamen (G19 ≙ su P2) y la cola viva declarada (G20). Los dos documentos se leen mejor juntos: el general prioriza producto y operación; este, protección automática, cadena de suministro y gobernanza de credenciales.

Este documento responde a una pregunta concreta: **qué le falta hoy al proyecto y qué conviene mejorar para el futuro**. Cada afirmación está verificada contra el árbol actual con lectura directa de fuente, no heredada de actas previas que puedan haber envejecido. Donde el texto cita `fichero:línea` o hash, la afirmación es falsable contra ese objeto exacto; donde dice "declarado", la fuente de la declaración se nombra. El documento está pensado para envejecer con procedencia y no en silencio: si una brecha se cierra, se cierra contra su evidencia.

---

## 1. Alcance y método

El inventario se construyó en cuatro pasos. Primero, un barrido de superficies desde el árbol (`git ls-tree` sobre raíz, `docs/`, `internal/`, `scripts/`, `.github/`) para describir lo que **existe** antes de afirmar lo que falta. Segundo, lectura íntegra de los ficheros que gobiernan calidad, despliegue y protocolo: `ci.yml`, `bench-nightly.yml`, `Makefile`, `go.mod`, `docs/README.md`, `docs/agentes/PROMPTS.md`, `docs/false-positive-control.md` y la tabla de entorno del README. Tercero, verificación en fuente de cada candidata a brecha con búsquedas dirigidas (tests del sensor, wiring de retención, endpoints de métricas, TLS, versionado), descartando las que la fuente refutó — varias candidatas murieron así: `/metrics` Prometheus existe (paquete D1, test en `internal/api/api_test.go:620`), la retención del store está cableada (`run.go:254` y `run.go:739` con `o.storeRetention`), y el pipeline de notificaciones tiene una historia de transporte deliberada (STARTTLS por defecto, fail-loud en el loader). Cuarto, contraste con la cola viva declarada por las actas para no duplicar trabajo ni contradecir aterrizajes recientes de otros carriles.

Se excluyen deliberadamente los defectos ya cerrados por la ola de integración del 30-sep — #34 (redactado en `actions`/`config`, `6da494c`), #35 (promoción a `internal/redact` compartido, `3da45bc`), F2 (cobertura del followup post-commit, `3da45bc`), F3 (clave estable de la cola forense, `e5347da`), O-E1/O-E2 (preflights de toolchain en harnesses, `f2283b7`/`259877a`) y O3 (disuelta como defecto fantasma: nunca estuvo en fuente, `f2283b7`) — que se citan solo como trazabilidad de lo que ya no es brecha.

**Escalas usadas.** Severidad: *alta* = protege contra regresiones o exposición ya presentes hoy; *media* = deuda que crece con el tiempo o incompleteza de proceso; *baja* = pulido, onboarding o preparación futura. Esfuerzo: *S* = cabe en una fracción de ronda de un carril; *M* = una ronda completa; *L* = varias rondas o requiere decisión del Director.

---

## 2. Instantánea del estado verificado (árbol `3820d95`)

| Superficie | Estado | Evidencia |
|---|---|---|
| Motor Go | 19 paquetes en `internal/` (con `internal/redact` recién promovido como paquete compartido) | `go.mod` (Go 1.22), `internal/` |
| Sensor Rust | Colector ETW Windows-first; CI hace `cargo check --locked` en host + cross-check `x86_64-pc-windows-msvc` | `ci.yml` job `sensor` |
| Consola | Next.js (`web/console`) + hub Bun/socket.io (`web/console-service`); batería de consola 19 tests / 58 expect | `web/console/src/**/*.test.ts`, suelo certificado en `7588505` |
| Website | Next.js separado con batería propia (813 frozen, eslint, build 4/4) | ola `e7c317b` |
| Especificación | OpenAPI 15 rutas / 36 campos / 74 referencias con guard + self-test en CI | `ci.yml` pasos `OpenAPI spec drift guard` |
| CI | 4 jobs: engine (fmt/build/vet/test + cross-check Windows + guard), engine-windows (smoke conductual con kills reales), console, sensor | `ci.yml` |
| Nightly | bench advisory 02:30 UTC, dos pasadas (rings vs SQLite store), no bloquea | `bench-nightly.yml` |
| Observabilidad | `/metrics` Prometheus (paquete D1) + `/api/health` exento de bearer + contadores de sinks | `api_test.go:620+`, `api.go:111-133` |
| Persistencia | SQLite opt-in (`-store`) con prune de retención cableado en dos puntos del ciclo | `store.go:299`, `run.go:254`/`run.go:739` |
| Audit forense | JSONL una-línea-por-intento, fsync por línea, techo 64 MiB, recovery torn-tail aterrizado | `respond/audit.go:2-26`, `6da494c` |
| Respuesta activa C3 | pidfd + fallback declarado (Linux) / handle (Windows), audit con par action_id, redact compartido, 409 en reintento, 429 por ritmo | ola 19h15–21h45 |
| Notificaciones | Slack/Telegram/email/Discord con STARTTLS por defecto y loader fail-loud | README `starttls`, `config.go` |
| Documentación | PDF v0.8 por pipeline reproducible (`scripts/arq_v04/`), guía de falsos positivos, GUIA-VERIFICACION, protocolo de 8 instancias | `docs/` |

Esta base es fuerte: el problema no es de producto aterrizado sino de **anillos de protección automática, cadena de release y gobernanza** que el crecimiento aún no ha alcanzado. Las secciones siguientes catalogan exactamente dónde.

---

## 3. Catálogo de brechas

### 3.1 Integración continua y calidad automática

#### G1 (alta) — La batería de la consola web no corre en CI

**Evidencia.** El job `console` de `ci.yml` ejecuta `bun test` **solo** en `web/console-service` (el hub). El paso de `web/console` ejecuta `bun install --frozen-lockfile`, `bunx tsc --noEmit` y `bun run build` — nunca `bun test`, pese a que el paquete declara el script `"test": "bun test"` (`web/console/package.json:9`) y tiene dos ficheros de test (`src/app/api/engine/[...path]/route.test.ts`, `src/lib/lifecycle.test.ts`) que forman el suelo de 19 tests / 58 expect certificado en `7588505`.

**Impacto.** El suelo de la consola existe pero solo protege a quien lo corre a mano. Una regresión en la validación client-side de la ruta de triaje (la misma que fija el techo 2000/200 y las clases de id malformado) o en el ciclo de vida del hub pasaría CI en verde y llegaría a main. Es exactamente la clase de regresión que la batería fue diseñada a atrapar: la puerta de validación existe, pero CI no la sostiene cerrada.

**Propuesta.** Añadir `bun test` al paso de `web/console` en el job `console`. Es una línea; el coste por push es de segundos y el suelo pasa de "certificado a mano por actas" a "enforced por CI". Esfuerzo **S**. Es la brecha de mejor relación impacto/coste de todo el catálogo y puede aterrizar en la ola 1 junto a G9.

#### G2 (media) — Sin linter estático en CI

**Evidencia.** El job `engine` ejecuta `gofmt`, `go build`, `go vet` y `go test`. staticcheck corrió una vez a mano en el carril de pulimiento (`fb29cee`, fila ST1000) y no quedó integrado en ningún lugar. No existe `.golangci.yml` ni equivalente.

**Impacto.** Las clases de defecto que vet no cubre (asignaciones muertas, sombreado, uso de `errors.Is` vs `==`, goroutines sin contrato de parada) dependen de que un agente decida pasar el linter a mano. El hallazgo ST1000 demostró que hay valor ahí.

**Propuesta.** Integrar staticcheck o golangci-lint en el job `engine` (o un job `lint` de 2-3 min), con la versión **fijada por la misma política del repo**: el árbol ya rechaza referencias mutables (actions por SHA, `pyyaml==6.0.3`), así que el linter y su config deben seguir la regla — versión exacta, config mínima de partida para no generar ruido, y ampliar gradualmente. Esfuerzo **S-M**.

#### G3 (media) — Sin `-race` en CI

**Evidencia.** `ci.yml:53` ejecuta `go test -count=1 ./...` sin detector de carreras. La `GUIA-VERIFICACION` y el protocolo exigen `-race` localmente en los paquetes concurrentes (ingest, beacon, lifecycle — y las rondas la corrieron sobre respond/actions/redact/siem/webhook en las olas de integración).

**Impacto.** Un data race en el pipeline de ingesta o en el dispatcher de acciones solo se detectaría cuando un agente recuerde correr `-race`. El motor corre SSE, audit con fsync por línea, dispatcher de kills y sinks de red en el mismo proceso: la superficie concurrente es la regla, no la excepción.

**Propuesta.** Añadir `-race` al job `engine` (coste ~1-2 min por push). Si el tiempo del gate preocupa, la alternativa honesta es un paso `-race` en el nightly + `-race` obligatorio en los paquetes que toquen el diff. Recomendación: directo en el job `engine`; el repo ya paga un job Windows conductual por push, dos minutos de race detector son coherentes con su apetito de verificación. Esfuerzo **S**.

#### G4 (media) — El sensor Rust no tiene batería de tests

**Evidencia.** `rg '#\[test\]|#\[cfg\(test\)\]' sensor/src/*.rs` devuelve **cero** resultados. CI verifica el sensor con `cargo check --locked` en dos targets — compilación y borrow-check, nunca comportamiento.

**Impacto.** El sensor es la superficie crítica del producto en su plataforma principal (Windows ETW). Todo el peso de la certificación recae en el motor receptor y en el smoke del engine-windows; un defecto de parsing o de formato de evento en el sensor solo se vería como síntoma aguas abajo.

**Propuesta.** Extraer la lógica pura (parsing de buffers, mapeo de campos, serialización) a módulos testeables y añadir `cargo test` al job `sensor`. Los campos de prueba ETW reales pueden seguir el patrón de la casa: fixtures fuera del árbol, como los receivers de `scripts/dev-tests/`. Esfuerzo **M-L** (depende del acoplamiento actual con las APIs de Windows).

#### G5 (media-baja) — Cobertura no medida ni publicada

**Evidencia.** Ningún workflow ejecuta `go test -cover` ni `bun test --coverage`; no hay reporte de cobertura en ningún sitio.

**Impacto.** Los huecos de cobertura solo se descubren por auditoría manual (así nació F2: la rama followup sin cobertura en ningún nivel). Sin número, el hueco no se ve hasta que produce un defecto.

**Propuesta.** `go test -cover` en el nightly (advisory, no gate) con el resumen en el summary de la corrida, y opcionalmente `-coverprofile` como artifact. La tendencia por paquete hace visible el próximo F2 antes de que haga falta encontrarlo a mano. Esfuerzo **S**.

#### G6 (media) — Sin automatización de actualización de dependencias

**Evidencia.** No existe `dependabot.yml` ni config de renovate (`git ls-files | rg -i 'dependabot|renovate'` = 0). Las tres cadenas de dependencias (Go modules, bun lockfiles, cargo) se actualizan a mano.

**Impacto.** Un CVE en una dependencia (el árbol usa cobra, bubbletea/lipgloss, sqlite, y las cadenas de bun/next) permanece hasta que alguien lo lee en un boletín. La política de pins del repo demuestra que la cadena de suministro se toma en serio; le falta el músculo reactivo.

**Propuesta.** `.github/dependabot.yml` con ecosistemas `gomod`, `github-actions`, `cargo` y `bun` (frecuencia semanal). Convive limpiamente con la política de pins: los pins por SHA de las actions son referencias inmutables y dependabot propone el siguiente SHA verificado. Clasificar los PRs de seguridad como prioritarios. Esfuerzo **S**.

#### G7 (baja) — Sin fuzzing en los parseadores de entrada hostil

**Evidencia.** No hay targets de fuzz (`rg 'Fuzz' = 0`). Los parseadores que consumen entrada no confiable: loader de reglas YAML, importador Sigma, ingest JSON del API, loader de sequences/suppressions, y el guard OpenAPI.

**Impacto.** Para un producto cuya función es tragarse datos de redes hostiles sin morir, los panic en parseo son la clase de defecto más embarazosa posible. El fail-loud del loader de config mitiga parte del riesgo; los fuzz targets cubrirían el resto.

**Propuesta.** 3-4 targets `go test -fuzz` sobre rules/sigma/ingest/sequences; ejecución en ráfagas nocturnas (10-15 min) en vez de permanente — el ratio valor/coste de partida es suficiente así. Esfuerzo **M**.

### 3.2 Seguridad y gobernanza de credenciales

#### G8 (media, acción externa al repo) — Rotación del PAT parcial: el token viejo sigue vivo

**Evidencia.** `dd6f084` y `c9db586` verificaron de primera mano que tras emitir el token nuevo, **el token viejo sigue autenticando** (ls-remote con el viejo: exit 0). Rotación atendida-parcial: falta la revocación. Ambas credenciales válidas pasaron por el canal de chat.

**Impacto.** Dos credenciales con poder de push sobre main, ambas expuestas en un canal no diseñado para secretos. El riesgo no baja hasta que una muera.

**Propuesta.** Revocar el token viejo en GitHub (Settings → Developer settings → PATs) y verificar alividad esperada (HTTP 401) — la verificación ya está programada en el carril 04-B. Lección sistémica ya documentada: los tokens no viajan por chat; el patrón de URL de un solo uso (token inline en el comando, jamás persistido en `.git/config` ni helpers) está probado en este repo por toda la ola del 30-sep sin una sola fuga a ficheros. Esfuerzo **S** (externo), prioridad inmediata.

#### G9 (media-alta) — SECURITY.md ausente: no hay canal de divulgación coordinada

**Evidencia.** `git ls-files | rg SECURITY` = 0. Un producto de seguridad sin ruta privada de reporte obliga a quien encuentra algo a elegir entre abrir un issue público con detalle de explotación o no reportar.

**Impacto.** Es la contradicción operativa más visible del repo para un auditor externo: el producto razona sobre divulgación (audit forense, redact, fail-loud) pero su propio proceso de recepción de hallazgos no existe.

**Propuesta.** `SECURITY.md` en la raíz con: versiones soportadas (la actual), canal privado (Security Advisories de GitHub, que ya viene con el repo), SLA de primera respuesta declarado, y qué incluir en el reporte (versión, vector, evidencia, impacto estimado). El README ya pide evidencia de laboratorio en PRs de detección; el mismo espíritu aplicado a la entrada de vulnerabilidades. Esfuerzo **S**, ola 1 junto a G1.

#### G10 (media-baja) — Patrón de exposición del API del motor más allá de loopback sin documentar

**Evidencia.** La historia de seguridad de transporte del producto es deliberada en las **notificaciones** (STARTTLS por defecto, rechazo loud del downgrade, guía https para Slack/Telegram — README línea 384+) y en la **consola** (postura loopback-only, `CONSOLE_ALLOWED_HOSTS`, 403 con nombre de variable — tabla de entorno, README línea 537-544). Falta el análogo para el **API del motor** (`-addr`): no hay mención de reverse proxy, TLS terminado, ni patrón de exposición remota. El motor no ofrece TLS nativo.

**Impacto.** Un operador que quiere motor y consola en hosts distintos carece del patrón documentado (proxy con TLS, bind selectivo, firewall), y el camino fácil es el inseguro.

**Propuesta.** Corto plazo (docs): sección "Deployment hardening" con el patrón reverse-proxy + bearer + hosts permitidos, citando la postura de consola como precedente. Medio plazo (código, si hay demanda real): `-tls-cert/-tls-key` nativas siguiendo el patrón de la casa diseño → dictamen → implementación. Esfuerzo **S** la versión docs, **M** la nativa.

#### G11 (baja) — Rotación del audit forense manual

**Evidencia.** `respond/audit.go:2-26`: techo de 64 MiB (~100k intentos), rotación declarada "tarea del operador". El ritmo global de 20/min hace que el techo tarde meses.

**Impacto.** Bajo y conocido. El riesgo real es el truncado tras el techo en una instalación desatendida de larga duración.

**Propuesta (backlog).** Rotación automática reteniendo N ficheros, y opcionalmente hash encadenado por línea para detectar truncado/alteración — el segundo es la mejora con sabor a producto forense. Esfuerzo **M**. El recovery torn-tail de `6da494c` ya resolvió la mitad dura del problema (crash entre write y sync).

### 3.3 Release, distribución y operación

#### G12 (media) — Sin versionado formal: tags, CHANGELOG ni releases

**Evidencia.** `engineVersion` está hardcoded en `"v0.1.0"` (`cmd/engine/version.go:9`) pese a que la documentación de arquitectura va por v0.8 y el producto aterrizó tres fases de roadmap. No hay tags, ni CHANGELOG, ni workflow de release (`git ls-files | rg -i 'changelog|goreleaser'` = 0).

**Impacto.** Un operador no puede distinguir binarios ni leer qué cambió entre uno y otro; el reporte de vulnerabilidades (G9) sin versiones es difícil de triar; el contracto p99 del README no tiene release ancla.

**Propuesta.** (1) Tag inicial `v0.9.0` anclado al estado actual certificado; (2) `CHANGELOG.md` estilo Keep a Changelog alimentado por las actas (ya son un changelog disfrazado); (3) workflow de release con build multi-binario (engine darwin/linux/windows amd64+arm64), SBOM (syft) como artifact, y bump de `engineVersion` derivado del tag. Esfuerzo **M**.

#### G13 (baja) — Sin multi-arquitectura

**Evidencia.** `Makefile` construye nativo; el Dockerfile no declara `--platform`; el release (G12) no existe aún y por tanto no cubre arm64.

**Impacto.** Apple Silicon y servidores ARM crecen; hoy el coste de entrada en esas plataformas es manual.

**Propuesta.** Incluir `GOARCH=arm64` y `--platform linux/arm64` en el workflow de G12 desde el primer día (casi gratis con goreleaser/buildx). Esfuerzo **S** dentro de G12.

#### G14 (baja) — Sin compose de laboratorio para el stack completo

**Evidencia.** Existe `Dockerfile` del engine, pero no hay compose que levante engine + hub + consola + receivers de lab (`siem_receiver.py`, `notify_receiver.py`, `webhook_receiver.py`) en un solo comando.

**Impacto.** El onboarding de un contribuidor exige leer GUIA-VERIFICACION + Makefile + scripts para reproducir la demo; con compose sería `docker compose up`.

**Propuesta.** `docker-compose.yml` de laboratorio explícito (devsensor como fuente de eventos, nunca telemetría real; endpoints de sink apuntando a los receivers), con un párrafo que prohíba confundirlo con despliegue de producción. Esfuerzo **S-M**.

#### G15 (baja) — El nightly no acumula serie temporal

**Evidencia.** `bench-nightly.yml` registra percentiles en el summary de cada corrida; no hay artifact persistido ni histórico consultable (la lección SSE-vs-networkidle de `ca51b95` ya está anotada como lectura previa del análisis, pero el dato en sí no se acumula).

**Impacto.** El valor del bench advisory es la **tendencia** (un p99 aislado no dice si el producto degradó); hoy cada corrida muere en su summary.

**Propuesta.** Subir un JSON de resultados como artifact por corrida y, opcionalmente, mantener una rama `bench-history` con CSV acumulado. El contrato advisory (no bloquea) queda intacto. Esfuerzo **S**.

#### G16 (baja) — Logging no estructurado

**Evidencia.** El motor registra con `log.Printf` y prefijos manuales (`[ENGINE]`, `[ACTIONS]` — `run.go:168,360,432,533,628,691+`).

**Impacto.** Para un producto cuyo destino natural es alimentar un SIEM, sus propios logs no son machine-parseables sin regex frágiles.

**Propuesta.** `log/slog` con handler de texto por defecto (cero cambio de comportamiento percibido) y `-log-format json` opcional; los prefijos actuales se convierten en atributos `component`. Esfuerzo **M**.

### 3.4 Documentación y comunidad

#### G17 (baja) — CONTRIBUTING.md y CODE_OF_CONDUCT.md ausentes

**Evidencia.** La sección Contributing del README es un párrafo único (buen contenido: el requisito de TTP + evidencia de laboratorio + perfil de falsos positivos por PR de detección) sin el fichero estándar que GitHub enlaza en cada PR.

**Propuesta.** Extraer a `CONTRIBUTING.md` y ampliar con la batería exigida antes del push (la regla 6 del protocolo, traducida a contribuidor externo: gofmt/build/vet/test, guard OpenAPI, bun/tsc/build por superficie), convención de commits del repo, y CODE_OF_CONDUCT mínimo. Esfuerzo **S**.

#### G18 (baja) — ADRs inexistentes (deuda declarada)

**Evidencia.** `docs/README.md` lo confiesa explícitamente: "el directorio de ADRs sigue sin existir como tal". Las decisiones estructurales viven dispersas en actas y en el PDF: ETW nativo vs Sysmon, SQLite opt-in, bearer único con `-api-write`, caps del rules-loader, STARTTLS por defecto, techo del audit.

**Propuesta.** `docs/adr/` con plantilla corta y 5-6 ADRs retroactivos, cada uno citando el acta/hash de origen — es trabajo de trazabilidad, no de redacción creativa: las decisiones ya están tomadas y documentadas, solo falta el índice canónico. Esfuerzo **S**.

### 3.5 Producto y roadmap declarado (design-only)

#### G19 — Fases 2/4 del roadmap: YARA, eBPF, filaments, plugins, gRPC

**Evidencia.** README (tabla Roadmap) y `docs/README.md` los declaran futuro sin presentarlos como capacidad. Estado real: sin aterrizar.

**Recomendación de método.** Cada una debe entrar por el patrón de la casa que ya funcionó dos veces (A2 y C3): documento de diseño con bounds → dictamen del carril de seguridad **antes** del aterrizaje → implementación → batería completa → certificación. Notas específicas por ítem:

- **YARA (memoria, fase 2):** el diseño debe traer los bounds antes que el código — coste máximo por escaneo, techo de procesos escaneados concurrentes, y qué pasa con el proceso objetivo si el escaneo excede el presupuesto. La librería debe correr confinada (proceso hijo o equivalente); un crash del escáner no puede ser un crash del motor.
- **eBPF (fase 2):** es el contrapeso natural Linux de un sensor Windows-first. Riesgo principal: kernel antiguo. El patrón `fallback_reason` del C3 (degradación **declarada**, nunca silenciosa) es el estándar de la casa para esto y debe citarse en el diseño.
- **Filaments Python (fase 4):** la primera pregunta es de seguridad y de vida o muerte del host: sandbox del intérprete embebido. Considerar WASM como alternativa con confinamiento más fuerte y un runtime que el repo ya no tendría que mantener.
- **gRPC/protobuf:** solo si aparece un consumidor real; el stack REST+SSE actual está drift-guarded por CI y es la superficie ya certificada. Añadir un segundo transporte duplica el coste de cada guard futuro.

#### G20 — Cola viva conocida (con dueño, sin acción nueva)

C3 iteración 2 (de-priorizada por acta), T2 beaconing por-proceso (desbloqueo externo), O1 consola (tarjeta obsoleta tras restart sin flags — trade-off declarado), refinamiento de supresiones por `(rule_id, host)` (extensión de baja prioridad documentada en el acta 20h43 del carril 04-B). Esta cola no necesita hallazgos nuevos: necesita ventana del Director. Se lista aquí para que el inventario de "qué falta" sea completo y alguien que lea solo este documento no crea que la cola está vacía.

---

## 4. Mejoras de producto propuestas (no declaradas en roadmap)

Estas no son brechas de lo prometido sino apuestas nuevas; se proponen con el mismo estándar: si entran, entran por diseño → dictamen → implementación.

- **M1 — Multi-token mínimo (read vs operator).** Hoy un único bearer: o todo lo puede, o con `-api-write` se restringe la escritura global. Un segundo token de solo-lectura para dashboards reduciría el blast radius del credential leak y es coherente con la postura de la casa (el hard-gate `-api-write` de supresiones demuestra que la distinción lectura/escritura ya existe conceptualmente).
- **M2 — Webhook entrante firmado (HMAC) para respuesta externa.** La respuesta activa hoy es solo local; un canal entrante firmado abriría integración SOAR sin abrir el API de kills a quien conozca la URL.
- **M3 — Replay de reglas desde la consola.** Subir un evento sintético y ver qué regla dispara (y por qué no) aceleraría el ciclo de detección que hoy exige pasar por devsensor. La infraestructura de triaje y el guard de escritura ya existen.
- **M4 — Firmas y SBOM en releases (cosign + syft).** Complementa G12: para un producto de seguridad, la cadena de suministro del propio binario es parte del producto.
- **M5 — Modo servicio.** systemd unit (Linux) + wrapper de servicio (Windows): hoy el engine corre en foreground con pidfile; la instalación desatendida de larga duración (la misma que choca con G11) pide gestión de servicio.
- **M6 — Agrupación/digest de alertas en la consola.** Con miles de alertas, la cola lineal escala mal visualmente; el filtro + ventana 100/500 ya son la base, falta el agrupado por regla/host/ventana.
- **M7 — Camino de upgrade documentado y testeado.** Qué pasa al actualizar el binario con config/store/audit de una versión anterior (drift de flags, migración de esquema del store, compatibilidad del JSONL). No existe hoy como superficie verificada.

---

## 5. Priorización y plan por olas

| ID | Título | Severidad | Esfuerzo | Ola |
|---|---|---|---|---|
| G8 | Revocación del PAT viejo | media (externo) | S | **inmediata** |
| G1 | `bun test` de la consola en CI | **alta** | S | 1 |
| G9 | SECURITY.md | media-alta | S | 1 |
| G2 | Linter estático en CI (pinned) | media | S-M | 2 |
| G3 | `-race` en CI | media | S | 2 |
| G6 | dependabot (4 ecosistemas) | media | S | 2 |
| G12 | Tags + CHANGELOG + release con SBOM | media | M | 3 |
| G4 | Tests del sensor Rust + `cargo test` en CI | media | M-L | 3 |
| G10 | Patrón de exposición del API (docs primero) | media-baja | S | 4 |
| G5 | Cobertura en el nightly | media-baja | S | 4 |
| G15 | Serie temporal del nightly | baja | S | 4 |
| G7 | Fuzzing en parseadores | baja | M | 5 |
| G16 | `slog` con modo JSON | baja | M | 5 |
| G17 | CONTRIBUTING/CODE_OF_CONDUCT | baja | S | 5 |
| G18 | ADRs retroactivos | baja | S | 5 |
| G14 | Compose de laboratorio | baja | S-M | 6 |
| G13 | Multi-arquitectura | baja | S | dentro de G12 |
| G11 | Rotación automática del audit | baja | M | backlog |
| M1-M7 | Mejoras de producto | — | M cada una | según visión del Director |
| G19 | Fases 2/4 (YARA, eBPF, filaments) | — | L | diseño → dictamen primero |
| G20 | Cola viva declarada | — | — | ventana del Director |

**Lectura del plan.** La ola 1 son dos líneas de trabajo de una tarde que cierran la brecha alta y la de reputación externa (G1+G9) más la acción inmediata externa (G8). Las olas 2-3 construyen el músculo automático (lint, race, dependencias) y la cadena de release. Las olas 4-6 son pulido y operación. G19 exige decisión de visión del Director antes que código: el método de la casa (diseño → dictamen) es el filtro, no la velocidad.

---

## 6. Lecciones de proceso (evidencia del día que produce este documento)

Tres hechos del 30-sep que son en sí mismos parte de la respuesta a "qué falta" — falta nada, pero el proceso lo cubrió, y conviene fijar por qué:

1. **El instrumento también falla: `od -c` o no ocurrió.** La observación O3 (`ashtable]` en la firma de Post-Kill) se abrió, ganó actas y asignación, y resultó ser un defecto del canal de lectura/escritura de los agentes — los bytes de la fuente siempre estuvieron sanos (`f2283b7` verificó `smoke_respond.ps1:140` y tres sitios más byte a byte). La regla candidata ya está en el acta: ningún hallazgo de la clase "pares perdidos" se abre sin confirmación byte-level; un grep que muestra el par roto es síntoma del instrumento, no evidencia.
2. **La redundancia del doble carril funciona.** Siete convergencias independientes entre instancias del mismo rol en un solo día, con veredictos idénticos contador a contador (F1/O2, la ola forense, el nuance de esquema, O4...). El costo del sistema son las colisiones de ID (dos autocorregidas en el carril 04-B) — el remedio ya operativo: el ID canónico lo da el hash del primer aterrizaje, no el orden de lectura.
3. **El patrón de credenciales de un solo uso aguanta la presión.** Toda la ola del 30-sep (14+ commits de 6 instancias) se publicó con tokens inline sin que uno solo llegara a `.git/config`, helpers o ficheros. Es el estándar que la rotación pendiente (G8) debe completar.

---

## 7. Marcadores y procedencia

- Árbol analizado: `3820d95`. Ola de integración previa citada: `6da494c` (#34 + torn-tail), `3da45bc` (#35 + F2), `e5347da` (F3), `f2283b7` (O-E1 + disolución de O3), `259877a` (O-E2), `dd6f084` (ronda 21h10), `7588505` (suelo 19/58 en GUIA), `3820d95` (21h45).
- Scoreboards al cierre: 33/33 defectos cerrados 0 vivos (numeración de carril); roadmap 14/17 (numeración de carril) — el canon vigente es el acta del Director más reciente, según regla del protocolo.
- Verificaciones propias de esta ronda que refutaron candidatas a brecha (registradas para que no vuelvan a abrirse): `/metrics` Prometheus existe; el prune de retención está cableado en `run.go`; STARTTLS y la postura de consola están deliberadas en README; el job `console` de CI sí existe (el hueco es el `bun test` de `web/console`, G1); la retención no es brecha sino operación declarada.

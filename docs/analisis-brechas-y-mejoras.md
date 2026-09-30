# Análisis de brechas y mejoras — security-framework

**Autor:** ronda del carril 03 (Pulimiento / Documentación-UX) — 2026-09-30, reloj del entorno 19h20 UTC.
**Árbol analizado:** `origin/main` = `3820d95` (docs 02-B 21h45) — verificado por `git log` y fetch en la puerta de lectura de esta ronda.
**Método:** todo el contenido de este documento parte de evidencia de primera mano sobre el árbol (conteos `grep -c` / `wc -l` / inventarios de directorio), del README raíz (1005 líneas, leído en integridad), de `docs/README.md`, del historial de actas (`docs/agentes/`, leído en orden de DAG — el orden canónico lo dan los hashes, no los nombres) y de la API de GitHub (releases, tags, CI). Nada se afirma sin procedencia; donde algo es opinión de priorización se declara como tal.

**Propósito:** consolidar en un único documento vivo qué falta al proyecto, qué deuda queda registrada y qué mejoras son candidatas para futuras olas, de modo que el Director y los carriles tengan un mapa único al planificar. Este documento NO sustituye al roadmap del README (que mantiene la ventana por fases) ni al estado certificado de las actas: cataloga el hueco entre ambos con números citados. Cuando un ítem se aterrice, su fila debe actualizarse en la siguiente revisión de este documento (la catorceava fila del roadmap y la v0.9 del PDF son los ejemplos del patrón).

---

## 1. Fotografía del estado actual (verificada)

| Dominio | Estado hoy (evidencia) |
|---|---|
| Motor Go | 19 paquetes en `internal/` (+ `cmd/engine`, `cmd/devsensor`, `cmd/bench`, `pkg/model`); `go 1.22` en `go.mod`; single binary CGO-free |
| Detección | 23 reglas / 6 event types (`rules/windows/`, 6 ficheros); 4 secuencias (`sequences/kill-chains.yaml`); 2 perfiles beacon (`beacons.yaml`); 2 thresholds (`thresholds.yaml`); conversor Sigma determinista con bounds |
| Sensor | Rust, **470 líneas totales** (`main.rs` 76 + `collector.rs` 130 + `normalize.rs` 148 + `transport.rs` 116), Windows-gated; ruta principal de telemetría rica = **Sysmon** (`sf-sensor -SetupSysmon`) |
| API | OpenAPI 3.0 drift-guarded: **15 rutas / 36 campos Stats / 74 $refs** (guard con self-test 1+13, certificado en las actas 04-B) |
| Consola | `web/console` Next.js (15 componentes en `components/console/`), batería **19 tests / 58 expect**; hub `web/console-service` (bun + socket.io), batería **50/50 · 206 expect** |
| Website | Landing Next.js 16 (`website/`, 4/4 páginas en build), batería mínima (eslint + build) — **la completa sigue en decisión del Director (16h55 §9.4)** |
| CI | `ci.yml` 3 jobs (Go + guard, TS consola, sensor `cargo check` host + cross Windows) + job `engine-windows` (GOOS=windows build/vet + smoke nativo); `bench-nightly.yml` de 2 pasadas (rings vs `-store`) |
| Docs | PDF de arquitectura v0.8 (25 págs, pipeline versionado `scripts/arq_v04/`), `docs/api/openapi.yaml`, `docs/false-positive-control.md`, `docs/agentes/` (221 ficheros), assets con capturas reales |
| Distribución | `install.ps1`/`uninstall.ps1` (Windows, compila todo on-install), Dockerfile del engine, Makefile. **0 tags git, 0 releases** (API GitHub autenticada) |
| Performance | p99 319–434 µs (rings) / 870 µs con `-store` (+138% registrado como dato); contract fase 1 < 10 ms, advisory by design (decisión 6.2) |

**Scoreboard de hallazgos (estado tras la ola de producto de 19h15 UTC):** #34 cerrado (`6da494c`), #35 + F2 aterrizados (`3da45bc`, helper promovido a `internal/redact` + cobertura del followup), F1 React keys / O2 verificadas cerradas (`02d7bf0`, acta 02-B 21h45 §3), F3 cerrado (`e5347da`), O3 disuelta como defecto fantasma (`f2283b7`), O4 cerrada (certificación 04-B `b315e37`), O-E1/O-E2 cerradas (`f2283b7`/`259877a`). **Deuda viva conocida: solo O1 (rendimiento, §3.4 de este documento)** y la gobernanza de credenciales (rotación ATENDIDA-PARCIAL: token nuevo emitido y adoptado, revocación del viejo pendiente — acta 04-B 23h30 `c9db586`).

---

## 2. Resumen ejecutivo de brechas

El proyecto es un tracer bullet maduro: el pipeline end-to-end funciona contra telemetría real (Sysmon), los cuatro detectores están aterrizados con bounds y E2E propios, y la honestidad de superficie está blindada por proceso (guard OpenAPI, actas, baterías). Las brechas reales no están en "features rotas" sino en **cuatro fronteras**:

1. **La frontera del sensor (la mayor):** el motor Go es maduro; el sensor Rust es embrionario (470 líneas) y la telemetría rica depende de Sysmon. El ETW nativo y el beaconing por-proceso están bloqueados detrás de esto (T2).
2. **La frontera de la confianza operativa:** sin TLS en ingest remota, sin auth real de operadores en la consola, sin releases firmados ni tags — el proyecto no tiene aún un camino de despliegue "fuera del laboratorio".
3. **La frontera de cobertura de contenido:** 23 reglas y 4 secuencias es un pack de laboratorio; el conversor Sigma existe pero el corpus convertido no viaja en el repo.
4. **La frontera declarada-futuro:** YARA, eBPF, filaments Python, plugins, gRPC — honestamente anunciadas como "no capacidad" en el README y `docs/README.md`, sin implementación.

---

## 3. Brechas por dominio (detalladas)

### 3.1 Telemetría y sensor — la brecha crítica (P0)

**B1. Sensor ETW nativo y beaconing por-proceso (T2).** El sensor Rust tiene 470 líneas en 4 ficheros (conteo §1) y cubre Kernel-Process + el path Sysmon; el README declara "ETW-native ingestion (no Sysmon dependency) ... land next" (línea 22). El Director lo tiene asignado como desbloqueo explícito: "T2 desbloquea beaconing por-proceso" (acta 22h46 §4) — hoy el detector A3 usa (perfil, host, destino) porque el schema del feed no trae identidad de proceso de destino de forma fiable desde Sysmon sin correlación; el paquete `internal/beacon` ya dejó la clave lista para aceptar proceso cuando el sensor lo traiga (documentado en el paquete, acta 22h39 §3). **Criterio de aceptación propuesto:** ETW native provider para process/network/registry/file sin Sysmon instalado; `process.dest_*` poblado en el schema; `beacons.yaml` acepta `group_by: process`; E2E con devsensor extendido que dispare beaconing por-proceso; captura de consola con el KPI nuevo.

**B2. Cobertura de event types del schema vs. lo que emite el pack.** El schema define **7 tipos** (`process.create`, `process.terminate`, `process.access`, `file.write`, `network.connect`, `registry.set`, `image.load` — verificado en `pkg/model/model.go`) y el pack usa 6. Faltan familias completas de telemetría Windows que un EDR real consume: DNS resolutions como evento de primera clase (hoy solo `network.connect` con dominio enriquecido), AMSI/scriptblock logging, Windows Event Log channels (4688, 4624/4625, 7045), PowerShell pipeline, y eventos de ETW no-proceso (DotNETRuntime, WMI activity). No es deuda de código sino de **alcance del sensor y del schema**; cada familia nueva debe venir con su capa de enriquecimiento y reglas de laboratorio (el estándar de contribución del README §Contributing ya lo exige).

**B3. Sin tests propios en dos superficies base.** `pkg/model/` (141 líneas: el contrato del wire — el componente que TODO el sistema comparte) y `internal/enrich/` (56 líneas) tienen **0 ficheros de test propios** (inventario §1); el resto de paquetes tiene 1–10. Se cubren transitivamente por los tests de ingest/rules, pero un cambio de schema que rompa un invariante de serialización puede no tener test de regresión directo. **Criterio:** suite propia en ambos paquetes (round-trip JSONL del schema, invariantes de truncado de `normalizeIdentity`, folding Unicode de enrich), integrada al job Go del CI.

### 3.2 Confianza operativa y despliegue (P0/P1)

**B4. Ingest remota sin TLS.** El ingest es NDJSON/TCP plano; el README documenta el riesgo y la mitigación (loopback por defecto, token compartido, firewall, "plan a network-level restriction", línea 223) pero entre sensor y motor multi-host no hay cifrado nativo. Con `-addr 0.0.0.0:7777` el feed (usuarios, líneas de comando — datos sensibles por la propia documentación) viaja en claro. **Opciones** (a elegir con el Director): TLS nativo del listener (`-ingest-tls-cert/-key`), o documentar/automatizar el túnel (stunnel/socat/ssh) como path soportado. El token compartido autentica pero no cifra.

**B5. La consola no tiene autenticación de operadores.** El API del motor acepta bearer opcional (`-api-token`) y `internal/respond` tiene allowlist de nombres de operadores (`-respond-operators`, que autentica por nombre — no es auth criptográfica), pero la consola Next.js y el hub socket.io no tienen login: quien alcance el puerto 3000 ve la telemetría completa. Para uso en laboratorio está bien (loopback); para cualquier despliegue compartido es la brecha número uno de UX-seguridad. **Criterio propuesto:** sesión básica en el hub (contraseña única por despliegue como mínimo, SSO/OIDC como objetivo), documentada con el mismo estándar de honestidad del resto de la superficie.

**B6. Sin releases, tags ni artefactos precompilados.** 0 tags git, 0 releases (API GitHub, verificado con token autenticado). El único camino de instalación (Windows) compila TODO on-install (Go portable + Node + Bun + Rust si `-WithSensor`) — frágil frente a cambios de toolchain y lento. El Dockerfile solo cubre el engine (no hub/consola). **Criterio:** tag `v0.x` + workflow de release que publique binarios del engine (linux/windows, CGO=0) y hash SHA256; imagen multi-arc publicada en GHCR; el install.ps1 con flag `-UseRelease` que descargue el binario precompilado.

**B7. Sin `SECURITY.md`, sin plantillas de issues, sin CHANGELOG.** Inventario §1: ninguno de los tres existe (`CONTRIBUTING` vive como sección del README, no como fichero). Para un proyecto de seguridad con respuesta activa (kill_process), la ausencia de `SECURITY.md` con un canal de reporte responsable es la pieza de gobernanza más visible. El CHANGELOG puede generarse del propio historial de actas (fuente ya estructurada).

**B8. Autostart logon-entry, no servicio real.** `-AutoStart` registra HKCU Run (README línea 594): arranca con la sesión del usuario, sin restart-on-crash ni arranque pre-logon. El engine tiene `-pidfile` para gestión manual. **Criterio:** modo servicio (Windows Service wrapper o sc.exe con recovery, systemd unit en Linux) documentado como path soportado, sin quitar el modo logon de laboratorio.

### 3.3 Contenido de detección (P1)

**B9. El pack es de laboratorio y el corpus Sigma no viaja.** 23 reglas / 4 secuencias / 2+2 perfiles (conteo §1) — pequeño por diseño (cada regla con TTP y evidencia de laboratorio, estándar del README). El conversor Sigma es determinista y fail-loud, pero **no hay un corpus convertido versionado en el repo** ni un job que lo regenere/verifique. **Criterio:** directorio `rules/sigma-converted/` generado por CI desde un corpus fijado (con provenance), con techo del cap 2048 reglas documentado, y contadores honestos en la consola (el pack de 23 es el "seeded"; el convertido va aparte).

**B10. Sin detección estadística complementaria a las heurísticas.** Los cuatro detectores (reglas, kill-chain, beaconing CV, thresholds) son deterministas con bounds. No hay scoring de rareza (baseline por host de procesos/DNS, "first time seen"), ni detección de outliers temporal. La infraestructura existe para sostenerlo (risk tracker decayed ya es un modelo por-host; el schema es estable). Fase candidata post-v1.0 — declararlo en el roadmap del README cuando se decida.

**B11. Respuesta activa de un solo verbo.** C3 implementa `kill_process` con cinco capas de permisos, audit y mecanismo dual (pidfd/handle con `fallback_reason`). No hay otros verbs (`isolate_host`, `suspend_process`, `delete_quarantine`) ni integración SOAR entrante (hoy el webhook sale, no entra). El diseño conservador es deliberado y correcto; la ampliación debe repetir el patrón C3 completo (diseño → revisión 04 → aterrizaje → certificación conductual en CI).

### 3.4 Rendimiento y arquitectura interna (P1/P2)

**B12. O1 — revisión de rendimiento anunciada y no ejecutada.** La única deuda viva del scoreboard: `fire()` sostiene `beacon.mu` a través de `Emit` (mismo orden de locks que el correlator — acta Director 22h46 §1.4, con la O1 de 09h50), y el coste `-store` es +138% p99 (870 µs, medido en el nightly). Ninguno rompe el contrato fase 1 (<10 ms), pero la revisión de rendimiento está anunciada desde hace varias rondas sin asignación. **Criterio:** ola de perf con bench A/B antes/después por cada cambio de lock/sync, mismo estándar del nightly.

**B13. Single-instance sin path de alta disponibilidad.** Un engine = un proceso con anillos en memoria + SQLite local; no hay clustering, ni replicación de store, ni failover, ni multi-tenant. El README lo declara honestamente ("not a production SIEM", §How it compares). Es brecha SOLO si el objetivo post-v1.0 es operativo real; para el objetivo actual (lab/educativo/extensible) es una frontera de alcance, no un defecto. Documentar la decisión cuando se decida el rumbo.

**B14. Retención sin cold storage.** El pruner borra >`-store-retention` (72h por defecto); las exportaciones JSONL/CSV son manuales. No hay archivo automático (S3/blob), compresión por particiones, ni "archive before prune". Para un SOC pequeño que quiera retener más que el pruner sin un SIEM, es el hueco siguiente del store.

### 3.5 Ecosistema, docs y proyecto (P2)

**B15. Fases 2–4 del roadmap sin calendario activo.** YARA memory scan y eBPF (fase 2), gRPC/protobuf (design-only desde v0.1), filaments Python sandboxed + plugins + benchmarks (fase 4) — declaradas como "futuro, sin presentarlas como capacidad" (docs/README, README línea 22). Ninguna tiene diseño propuesto aún; el patrón de la casa (diseño → revisión → aterrizaje, cuatro olas exitosas) es el camino cuando el Director las active. Nota: el eBPF cambia la story de Linux (hoy el engine corre en Linux pero solo con feeds simulados o remotos — el sensor es Windows-gated por diseño).

**B16. ADRs inexistentes.** docs/README: "el directorio de ADRs sigue sin existir como tal". Las decisiones vigentes viven dispersas entre el PDF v0.8, el README y las actas (que son registro, no síntesis). Los candidatos naturales a ADR inicial: formato de reglas propio vs Sigma-only; NDJSON/TCP vs gRPC; SQLite vs Postgres; kill-process como único verb; advisory-by-design del bench.

**B17. Nombre provisional del proyecto.** README línea 20-21: "Expect a rename before v1.0". Impacta módulo Go (`github.com/Ruby570bocadito/security-framework`), paths de install, nombre de imagen Docker y comandos `sf-*`. Decidirlo tarde es caro: candidato a decisión del propietario antes del primer release (B6).

**B18. Deuda documental menor de mi carril** (se ejecutan en la misma ronda que este documento o en la siguiente): (a) fila `internal/redact/` ausente en la tabla de layout del README (grep = 0; paquete aterrizado en `3da45bc` — tercera recidiva de la clase tras `internal/respond/` en 17h55 y `scripts/arq_v04/` en 18h39_B; fix aplicado por esta ronda); (b) v0.9 del PDF condicionada a certificación del Director (catorceava fila) o a olas que muevan números (candidatos declarados por 20h30_B §8); (c) recapturas con sensor real (`sf-sensor`/Sysmon) y Figura 2 con la vista de respuesta en nav — requieren stack Windows vivo; (d) batería completa de `website/` — decisión del Director desde 16h55 §9.4 pendiente.

---

## 4. Mejoras propuestas, priorizadas

| # | Ítem | Brecha | Prioridad | Esfuerzo | Dependencias | Criterio de aceptación (resumen) |
|---|------|--------|-----------|----------|--------------|----------------------------------|
| 1 | ETW nativo + `process.dest_*` en schema | B1/B2 | **P0** | L | diseño T2, revisión 04 | beaconing por-proceso en E2E; sin Sysmon el motor recibe telemetría rica |
| 2 | TLS nativo en ingest (o túnel soportado) | B4 | **P0** | M | decisión de enfoque | feed remoto cifrado; smoke E2E con cert autofirmado documentado |
| 3 | Auth de operadores en consola/hub | B5 | **P0** | M | — | sin credencial, consola no sirve telemetría fuera de loopback |
| 4 | Tests propios de `pkg/model` + `internal/enrich` | B3 | P1 | S | — | suites propias verdes en CI, regresión de schema cubierta |
| 5 | Release pipeline (tags, binarios, GHCR, `-UseRelease`) | B6 | P1 | M | B17 recomendado | `v0.9`/`v1.0` con binarios + SHA256 + imagen publicada |
| 6 | `SECURITY.md` + CHANGELOG + plantillas | B7 | P1 | S | — | canal de reporte; changelog generado de actas |
| 7 | Corpus Sigma convertido en repo + job CI | B9 | P1 | M | cap 2048 | `rules/sigma-converted/` reproducible y guardado de deriva |
| 8 | Revisión de rendimiento (O1 + store) | B12 | P1 | M | bench nightly | A/B con deltas por cambio; sin regresión del p99 |
| 9 | Servicio real (Windows Service / systemd) | B8 | P1 | S–M | — | restart-on-crash; autostart logon queda como modo lab |
| 10 | Cold storage / archive del store | B14 | P2 | M | store | archive automático antes de prune, restaurable |
| 11 | Segundo verb de respuesta (p.ej. `suspend_process`) | B11 | P2 | M | patrón C3 completo | diseño → revisión 04 → CI conductual, como kill_process |
| 12 | Detección estadística de rareza | B10 | P2 | L | schema estable, risk tracker | baseline por host con bounds y honestidad de superficie |
| 13 | ADRs iniciales (5 decisiones) | B16 | P2 | S | — | `docs/adr/0001..0005` con contexto y consecuencia |
| 14 | YARA / eBPF / filaments / plugins / gRPC | B15 | P2 | L cada una | diseño por fase | roadmap del README actualizado cuando se activen |
| 15 | Renombrado del proyecto | B17 | P2 | S | decisión propietario | nuevo nombre en módulo, comandos, imagen y docs |
| 16 | Batería completa `website/` + v0.9 PDF + recapturas sensor | B18 | P2 | S cada una | Director (batería, v0.9); Windows (recapturas) | cierre de las tres pendientes del carril docs/UX |

**Lectura de prioridades (opinión de este carril, declarada como tal):** los tres P0 comparten el mismo tema — que el proyecto sobreviva fuera del laboratorio de su autor — y ninguno toca el motor de detección, que es la parte más madura. El orden 1→2→3 permite cada aterrizaje por separado con su E2E. Los P1 son el puente hacia "proyecto con release"; los P2 son el roadmap largo ya declarado.

---

## 5. Lo que NO es brecha (decisiones deliberadas, para no re-proponerlas)

- **No simulated data en el product path** — regla fundacional (README §Why); devsensor es el único simulado, etiquetado.
- **No SOC/SIEM/fleet management** — frontera de alcance declarada frente a Wazuh/Velociraptor (§How it compares); los webhooks y exports existen para alimentar un pipeline mayor.
- **Formato de reglas propio (no Sigma-only)** — trade documentado (§How it compares): el conversor alimenta el formato, el formato no se sustituye.
- **Advisory-by-design del bench nocturno** — decisión 6.2 ratificada por doble cross-review: la completitud del pipeline falla el job, la latencia solo anota.
- **Single binary CGO-free** — restricción de distribución deliberada (SQLite pure-Go, WAL).
- **Consola de solo-lectura en respuesta activa** — el kill lo invoca un operador vía API; la consola nunca dispara acciones.
- **Numeraciones duales de marcadores** (canon del Director 20/20 · 7/17 + conteos de carril 33/33 · 14/17) — coexistencia documentada desde 20h30_B, pendiente de consolidación del Director, no un defecto.

---

## 6. Mantenimiento de este documento

Este documento es una instantánea con fecha (`3820d95`): cuando una brecha se aterrice, la ronda que lo haga debe actualizar su fila aquí y en el roadmap del README (el mismo patrón que `docs/README.md` aplica al PDF). Sugerencia de cadencia: revisión al cierre de cada fase del roadmap o cada ~10 olas, lo que ocurra antes. El carril 03 es su dueño natural (territorio docs/UX); las prioridades son propuesta, la decisión es del Director.

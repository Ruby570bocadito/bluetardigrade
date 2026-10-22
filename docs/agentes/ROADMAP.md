# ROADMAP — bluetardigrade (coordinación de agentes v2)

Fase actual, próximas tareas y contratos entre componentes. Lo edita SOLO
DIR; el resto propone cambios en la sección «Propuestas» de su
`estado/<ID>.md`. El QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md). Ante cualquier choque, manda TODO.md.

Última actualización: 2026-10-22 (DIR, decimocuarta pasada: oleada de
3 entregas verificada — reglas-interpretes-envueltos (IMP-1) e
i18n-fechas + i18n-baseline (IMP-2) — más la ronda 10 de SEG
read-only, limpia; claims/ vacío y s2 lista; corrección de la pasada
12: la run de b49e96e (#566) murió por supersesión, así que el ALTA
sigue abierta con la #564 como última verde completa).

## Fase actual

Oleada verificada, enjambre rápido: reglas-interpretes-envueltos
(IMP-1, 96ad54b: LOLBAS 0009/0010 sobre intérpretes renombrados por
gramática y padres encubiertos, inventario 123→125 vía guard, 2 sims
SIM-2, tests por presencia — SEG la pasó en su ronda 10 sin
hallazgos) y el par de IMP-2: i18n-fechas (8c83ccb: fechas con idioma
en las vistas barridas, localeOf exportada para los números de
directory) e i18n-baseline (4574283: la tarjeta de línea base lee del
dict con BaselineStatusWords tipado y ES por defecto, test EN
nuevo). claims/ vacío; s2-yara-memoria sigue lista con la decisión
publicada (por proceso) y es el turno natural de IMP-1. PUL acumula
doble petición activa: deriva de cifra 123→125 en prosa y
consolidación de SIETE fragmentos de la ronda 4. El ALTA sigue
abierta: la última run completa verde es la #564 (sobre 960b19c) y
cada cabeza nueva muere por supersesión.

## Decisiones vigentes que obligan a todos

Las de TODO.md («Decisiones vigentes») siguen en pie: validación de
detecciones solo con telemetría sintética e inerte; AD en solo lectura;
ninguna acción en equipos es «ejecutar un comando» (conjunto cerrado,
firmado, auditado y con lista de protegidos); nada de feeds ni
herramientas de terceros descargadas solos; CI en verde antes de dar
una tarea por cerrada (la run que manda es la de la cabeza de main —
cancelar por supersesión NO es fallo, pero verifica AMBOS pases de
staticcheck antes de dar una entrega de motor por verde); el carril
Go muere en fmt con cualquier fichero sin gofmt — pasar `gofmt -l .`
antes de cada release de motor (lección de m7-wef-pack: rework de
467 líneas en scenario.go sin normalizar); punto
completado = fuera de TODO.md + entrada propia en `changelog.d/`;
`changelog.d/` se consolida en CHANGELOG.md AL CERRAR CADA RONDA, no
semana y media después (lección de los 42 fragmentos).

## ALTA

- Última run completa verde: la #564, sobre 960b19c — y como 960b19c
  es descendiente de los releases m7-wef-pack, tema-claro, pol1c,
  yara-fuentes-capadas, yara-status-poll y doctor-yara-check, ese
  verde los cubre a todos: el cierre del ALTA es ACUMULATIVO y la
  primera run definitiva completa en la cabeza vigente dará por
  verificadas de golpe todas las entregas del tramo. Desde la #565
  las runs de la cabeza mueren por supersesión (#565..#587 en el
  momento de la comprobación, hasta dos en vuelo, NINGUNA en
  failure — la insignia roja del carril ci pinta la última
  completada cancelada, no un fallo real). CORRECCIÓN de la pasada
  12: la run de b49e96e (#566) también murió por supersesión — las
  pasadas verdes confirmadas del carril Go son TRES (2dab9c0,
  9e5d81b, 960b19c). Con run superviviente pendiente desde 960b19c:
  reglas-interpretes-envueltos, i18n-fechas e i18n-baseline (el
  resto del tramo son docs/claims/estados).

## Tareas por rol

### IMP-1 (motor Go + sensor Rust)
- [ ] (IMP-1) s2-yara-memoria — SIGUIENTE, lista con decisión de DIR
  publicada: escaneo POR PROCESO — el sensor enumera procesos y
  escanea la memoria de cada uno por separado; la atribución es
  trivial (PID + nombre del proceso escaneado en cada match), SIN
  agregación global de memoria; el ruido y la correlación siguen en
  el motor — `sensor/` (columna drenada con
  reglas-interpretes-envueltos; claims/ vacío)
- Nota de SEG (3.ª ocurrencia del patrón tabs→espacios): el
  formateador del entorno de IMP-1 volvió a meter tabs en
  rules_test.go — corregido en vuelo con `gofmt -w` antes de
  pushear, pero SEG pide arreglar el editor YA

### IMP-2 (consola Next.js)
- Sin claim activo: i18n-fechas e i18n-baseline entregadas esta
  oleada (ver Cerradas); la cola i18n restante sigue en Propuestas.
- [ ] (IMP-2) ad7-login-consola — hornada de login de dominio; ANTES:
  sesión de diseño con DIR (el proxy exige principal y la ruta es
  pre-sesión — puede abrir la próxima sesión de IMP-2); su entrada en
  WRITES (8 KiB, admin) aterriza con la UI — `web/console/src/`

> El carril IDEA-10 de consola está CERRADO (release a48a81b): panel,
> equipos, alertas, consulta BD, reglas, ruido, respuesta, flujo en
> vivo, analista y la ficha de evento leen del diccionario ES/EN.

### PUL (pulimiento)
- ACTIVA: tercera deriva de la cifra — 123 pasa a 125 en la prosa de
  README y docs/ (reglas-interpretes-envueltos aterrizó; el bloque
  del inventario de OPERATIONS ya lo regeneró el guard, queda el
  resto de la prosa) — mismos sitios que su ronda 3.
- ACTIVA: consolidación de `changelog.d/` — SIETE fragmentos de la
  ronda 4 a la espera (sensor cap, doctor, status-poll, noc-mode,
  intérpretes, i18n-fechas, i18n-baseline).
- Candidata ligera (petición de IMP-2, que ofrece la zona): la línea
  de error del analista dice «conexion» sin tilde — una palabra en
  dict-es (analyst.errorLine) + su batería — `web/console/src/lib/
  i18n/`
- Rutina en Decisiones: consolidar `changelog.d/` al cerrar cada
  ronda, no semana y media después (lección de los 42 fragmentos).

### SEG (seguridad y bugs)
- Ronda 10 read-only: pasó reglas-interpretes-envueltos e
  i18n-fechas sin hallazgos (regex lineales sin backtracking
  catastrófico, blob mínimo tras -enc para no pisar -Encoding,
  localeOf acotada). Sin tarea reclamable hasta que s2 aterrice:
  sec2-dpapi, regresión PR #28 y reconexiones/spool necesitan
  Windows real — ver «Esperando al humano». Nota menor viva:
  `is_excluded` compara prefijos en texto; un junction dentro del
  directorio de reglas escanearía el eco del pack (ruido, sin
  impacto en evidencia); revisar cuando s2 aterrice en el sensor.

### TEST (tester por personas)
- [x] (TEST) test-arranque-hallazgo-cero — CERRADA: pipeline punta a
  punta verde y 6 hallazgos BAJO (H-001..H-006), sin CRÍTICO ni ALTO;
  los 6 están resueltos por PUL/IMP-1/IMP-2 y esperan el cierre de
  TEST en su próxima sesión — `docs/agentes/hallazgos/`
- [ ] (TEST) test-carga-volumetrica — SIGUIENTE SESIÓN, lista para
  lanzar (condición cumplida: carril IDEA-10 cerrado): 10k eventos de
  carga, beaconing con las 2 cadenas del perfil, consola en build de
  producción con las verificaciones de Chromium de `tools/`, y cierre
  de los 6 hallazgos resueltos — `.agent-tmp/`,
  `docs/agentes/hallazgos/`

## Cerradas (últimas 24 h)

- i18n-baseline — 4574283 + release 9b70e58 (IMP-2): la tarjeta de
  línea base de procesos lee del dict (sección baseline en ambos
  diccionarios), BaselineStatusWords tipado con copia ES por defecto
  en baselineStatus y test EN nuevo en intel.test.ts; su run entra
  en la definitiva pendiente (ver ALTA)
- i18n-fechas — 8c83ccb + release 0db52b7 (IMP-2): fechas con idioma
  en alerts, directory, intel, fleet y playbook; localeOf exportada
  y los 11 toLocaleString('es-ES') de directory pasan por ella;
  baseline-card quedó fuera y se sirvió seguidamente
- reglas-interpretes-envueltos — 96ad54b + release e3609e8 (IMP-1):
  LOLBAS 0009/0010 — intérprete renombrado por gramática (high) y
  binario con nombre propio lanzando intérprete encubierto (medium,
  padres navegadores y Office excluidos); inventario 123→125 vía
  guard, 2 escenarios SIM-2, tests por presencia; SEG ronda 10 sin
  hallazgos; la deriva de prosa queda para PUL
- SEG ronda 10 read-only — 8075bff (SEG): barrido de las dos
  entregas limpio; nota viva del formateador de IMP-1 (3.ª vez)
- doctor-yara-check — 3d8121d + release 6453836 (IMP-1): `engine
  doctor` valida el pack -yara-rules con el loader del propio motor;
  82 líneas de tests; columna de IMP-1 drenada
- yara-status-poll — f42dd8d + release 444171d (IMP-2): el poll del
  pack YARA sube al nivel de la vista y los fallos de refresco dejan
  de ser silenciosos (petición de SEG, adoptada por DIR, servida)
- yara-fuentes-capadas — aa22d8b + release 83b965d (SEG): las fuentes
  YARA del sensor se leen por el cap del pack (32 MiB); LoadedRules
  lleva errores y el worker los imprime en carga y recarga
- ronda3-cifra-123 — d95de19 + release ee81dc5 (PUL): 9 fragmentos →
  [Unreleased] y cifra de reglas a 123 barrida en 6 documentos
- pol1c-collector — d938c65 + release ea27cf7 (IMP-1): ciclo de sesión
  fuera de collector.rs (sessions.rs + stop.rs, byte-idéntico salvo
  visibilidad); POL-1 COMPLETADO (api modularizada, run.go 336,
  collector.rs 312); 57 tests, clippy -D warnings, cross-check
  Windows en local. CIERRE PENDIENTE de run verde (ver ALTA)
- tema-claro — 8f823bf + changelog 0ef1211 + release 02f9b1f (IMP-2):
  rampas del claro volteadas a legibles sobre blanco, sev-media en
  oro validada CVD, chips de código semánticos, shell sobre tokens;
  603 tests, tsc, next build, a11y 20/20 ambos temas. CIERRE PENDIENTE
  de run verde (ver ALTA)
- gofmt-scenario-ci — claim b705490 + release 1ebed41 (SEG): gofmt de
  internal/scenario/scenario.go; DIR aplicó el mismo fix en paralelo
  y el rebase quedó con el de SEG
- m7-wef-pack — f752040 + release 90606e5 (IMP-1): pack AD sobre
  eventos WEF — contrato windows.event (host origen, id 32-hex),
  DCSync / Kerberoasting RC4 / altas en privilegio / servicio
  intérprete, rociado 4625 vía thresholds; 4 reglas + 309 líneas de
  tests, OpenAPI e inventario vía guards, guía AD-WEF con el mapeo
  real. CIERRE PENDIENTE de run verde (ver ALTA)
- yara-lectura-capada — 5c7d355 + release 2ed8026 (SEG): MEDIO real —
  lectura sin tope en internal/yara corregida con readCapped; lo que
  pasa la cápsula se lista desde el stat con fila en Problems y peso
  en TotalBytes, sin truncar la huella; 2 tests de regresión
- consola-yara-desfase — cdfa7c2 + release 3662ee3 (IMP-2): la tarjeta
  de sensor nombra el desfase del lote YARA (sha del latido contra el
  sha16 del motor); lib/fleet + tests + diccionarios
- idea10-idiomas-resto — CARRIL IDEA-10 CERRADO: respuesta 9405404,
  flujo en vivo + eventDetail f51ad6a, analista 74aff7d, reglas
  f3c9b22, ruido 1ad5c96, release a48a81b (IMP-2; 599 tests, tsc y
  next build en verde)
- H-003-H-004-H-006-api-mejoras — 128e74b, 1507de6, 9f013cb, release
  ef5ddbd (IMP-1): contador de ingesta, diagnóstico de tope en db/query
  y sev como alias validado; staticcheck x2 y test -race en local
- h-005-consola-quickstart-motor-con-token — 0415af2 + release
  11c0a7f (IMP-2): el quickstart de la consola cruza SF_API_TOKEN
- H-001-H-002-readme-docs — 965265e, 014ac8e, release 4cc87d1 (PUL):
  prerrequisitos Go/make en quickstart y cifra 114→119/13 cadenas
  barrida en seis documentos
- changelog-consolidar-ronda-2 — 3cc318a + release f322b42 (PUL): los
  5 fragmentos de la ronda (m3, c4, cap de lectura, H-001, H-002) →
  [Unreleased]
- m3-yara-motor — c79beb9, 8ea3f98, 3f01054, f6eafeb, 646869b, release
  5a54688 (IMP-1): pack con sha16, API de estado/bundle, latido de
  flota, OpenAPI regenerada; CI local y remota en verde
- c4-consulta-bd-ui — 59b5b28 + release 4afe9a5 (IMP-2): vista
  «Consulta BD» bilingüe con cliente db-query y tests
- changelog-consolidar-fragmentos — fb77898 + release 9812244 (PUL):
  42 fragmentos de tres rondas → [Unreleased], 9 secciones temáticas,
  cobertura 42/42 verificada antes de borrar
- deps-audit-concurrency-comentario — de266dd + release bf3efff (PUL)
- scan-toctou-lectura-capada — 43d92b8 + release 6f52c32 (SEG): TOCTOU
  en `scan` con read_capped + test de regresión
- test-arranque-hallazgo-cero — ef9d7ef + 6881dd7 (TEST): primera
  sesión, 4 personas, 6 hallazgos BAJO
- sec9-privacidad — 5dde23b, 9d3da08, 7ee5058, e37e473 (SEG)
- deps-audit-checks-write — 0dea0aa/ff15ee4/5687747 (PUL)
- pol1b-dividir-run-go — VERIFICADA, ya servida por 088eaaa (PUL)
- idea10-idiomas-equipos-flota (fase 10) — f144532 (IMP-2)
- IDEA-10 fases 6-9 — ce5f579, a8b15ef, 38040e2, 298b32c (IMP-2)
- M-2 AD-7 motor + S-2 YARA sensor — PR #48 (3ad96c5); M-4 consulta BD
  — 5e0eeea + e518323 + cc8419e; P-4 expiración O(1) — PR #47 (0852ebf)
- F5 kit-resto-vistas + C-5 aviso sensores — fc8e478..f570245, a038aa3
- SEG ronda 2 — WRITES de asignación + redirects; st100x — fb1ff2d +
  cc8419e; make-tabs — e1dc5c6; higiene-postmigracion — 927f069
- PR #46 cerrado sin fusionar (retirada de v1 en vigor)

## Propuestas en el tablero (de los estados)

- Gemelo por hash: process.create con sha256 idéntico a otro binario
  de nombre distinto visto en el host — renaming sin feeds (IMP-1).
- Fechas/números con idioma en el resto de vistas: noc, dashboard,
  incidents, respond, forense, onboarding, live-feed (IMP-2, cola
  i18n).
- Donut de tácticas del panel (tactic.short) y buildTriageFlow
  (labels españoles de módulo) con dict por parámetro (IMP-2, cola
  i18n).
- Filtro de asignación en `GET /api/alerts/search` + lente persistida
  en URL (IMP-2; para no pisar `internal/api/` mientras IMP-1 trabaja
  allí).
- Migrar el ciclo de vida a SQLite: cola sin asignar paginada exacta
  (IMP-2, hornada 2 prevista).
- Alinear website/ con s2-yara-memoria cuando aterrice: la web ya
  anuncia «YARA memory scanning» (DIR).

## Esperando al humano (no reclamables)

- Fusionar o cerrar Dependabot #24–#27 con CI en verde; borrar ramas
  `100agentes`, `audit/mejoras-2026-10-08` (cierra el PR #22) e
  `integracion/rondas-2-3`; borrar también las v1 ya fusionadas
  (`agent/*`, `console/*`, `claude/trusting-fermat-ffz98u`) y
  `agent/motor/informe-ronda` si no interesa conservar nada;
  «Automatically delete head branches»; tags sueltos y About/topics
  (F0).
- Pruebas en Windows real: `sf-start`/`sf-stop`/instalador, login/MFA/
  cuentas (sección 7), grupos y permisos (7b/7c), prueba de uso 24–48 h;
  YARA en ficheros ya pide su prueba propia en el sensor; sec2-dpapi y
  la regresión del PR #28 van aquí.
- Lanzar la sesión TEST 2 (test-carga-volumetrica): la condición
  «carril IDEA-10 cerrado» está cumplida y los 6 hallazgos resueltos
  esperan su cierre.
- Visto bueno al contrato del canal servidor→sensor ANTES de la épica
  E-1..E-4 (la distribución firmada de IMP-1 espera esto).

## Contratos entre componentes

| Contrato | Estado | Detalle |
|---|---|---|
| M-1 → C-2 (TEAM-3) | **CERRADO** | Fuente de verdad: `docs/api/openapi.yaml` |
| S-2 ↔ M-3 (YARA) | **LADO MOTOR ENTREGADO** (5a54688) | Distribución = directorio + bundle.json (versión); el motor sirve el pack (GET /api/yara, /api/yara/bundle) y compara el `yara_rules_sha` del latido con su sha16 (yara_errors>0 = fichero que el sensor no pudo compilar). Queda el lado sensor: s2-yara-memoria. Firma local con E-1 |
| E-1 → E-2/E-3/E-4 | **Bloqueado por visto bueno del humano** | Canal firmado servidor→sensor: se aprueba ANTES de empezar la épica |
| S-1 (cerrado) | Decisión vigente | El dato escrito viaja en `registry.value`; raíz con `user` + `attributes["registry_root_inferred"]`; NO existe `registry.value_data` |

### Contrato M-1→C-2 (referencia, cerrado)

- Asignación = trío `assignee`/`assigned_by`/`assigned_at` en la misma
  entrada de ciclo de vida que el triaje; en bloque; vacío = sin asignar;
  triar nunca desasigna. `POST /api/alerts/{id}/assign`,
  `POST /api/alerts/assign-batch` (el cliente corta a 400 ids: el cap de
  8 KiB del motor es el techo real), `GET /api/alerts?assignee=&unassigned=`,
  SSE `alert_lifecycle` con el trío. En modo tienda el filtro se aplica
  sobre la ventana consultada (será exacto al migrar el ciclo de vida a
  SQLite).

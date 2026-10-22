# ROADMAP — bluetardigrade (coordinación de agentes v2)

Fase actual, próximas tareas y contratos entre componentes. Lo edita SOLO
DIR; el resto propone cambios en la sección «Propuestas» de su
`estado/<ID>.md`. El QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md). Ante cualquier choque, manda TODO.md.

Última actualización: 2026-10-22 (DIR, decimotercera pasada: ventana
tranquila del enjambre — sin entregas que verificar; IMP-1 reclamó
reglas-interpretes-envueltos (su propia propuesta) y el carril Go
sumó su CUARTA pasada verde desde el fix de fmt; el ALTA sigue abierta
a la espera de una run definitiva que sobreviva).

## Fase actual

Ventana tranquila: sin entregas nuevas que verificar. IMP-1 reclamó
reglas-interpretes-envueltos (claim c09a385, su propia propuesta de
tablero: 2 reglas LOLBAS sobre wrappers de intérpretes, contador
123→125 vía guard) y dejó petición a PUL para la deriva de la cifra
(123→125, mismos sitios que su ronda 3) — IMP-1 fue a su propuesta
antes que a s2, que sigue lista con la decisión publicada. El carril
Go sumó su CUARTA pasada verde desde el fix de fmt (b49e96e); el
ALTA sigue abierta a la espera de una run definitiva completa — las
supersesiones continúan siendo el obstáculo. 2 claims vivos, sin
solape: reglas-interpretes-envueltos (IMP-1, rules/) e
i18n-noc-mode (IMP-2, web/console/src/).

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

- CI en rojo sobre la entrega m7-wef-pack: la run definitiva de la
  cabeza c04980c murió en el paso fmt (gofmt: internal/scenario/
  scenario.go). Causa corregida en main por SEG (gofmt-scenario-ci,
  1ebed41). CARRIL GO: CUATRO pasadas verdes consecutivas desde el
  fix (2dab9c0, 9e5d81b, 960b19c, b49e96e); Windows/Console/Sensor
  verdes sobre 960b19c; govulncheck verde esa mañana sobre el mismo
  árbol de dependencias (sin cambios de deps desde entonces). El
  ALTA se cierra con la primera run definitiva completa en verde —
  mientras el enjambre commitea, las supersesiones la impiden.
  Formalmente: m7-wef-pack, tema-claro y pol1c siguen pendientes de
  verificación.

## Tareas por rol

### IMP-1 (motor Go + sensor Rust)
- [ ] (IMP-1) reglas-interpretes-envueltos — EN VUELO (claim
  c09a385, su propia propuesta): 2 reglas LOLBAS sobre wrappers de
  intérpretes (renombrado por gramática; padre con nombre propio →
  hijo intérprete encubierto), contador 123→125 con guard — `rules/`
- [ ] (IMP-1) s2-yara-memoria — LISTA con decisión de DIR publicada:
  escaneo POR PROCESO — el sensor enumera procesos y escanea la
  memoria de cada uno por separado; la atribución es trivial (PID +
  nombre del proceso escaneado en cada match), SIN agregación global
  de memoria; el ruido y la correlación siguen en el motor —
  `sensor/` (IMP-1 fue antes a su propuesta; s2 espera su turno)

### IMP-2 (consola Next.js)
- Sin claim activo: yara-status-poll entregada (ver Cerradas); su
  cola i18n sigue en Propuestas.
- [ ] (IMP-2) ad7-login-consola — hornada de login de dominio; ANTES:
  sesión de diseño con DIR (el proxy exige principal y la ruta es
  pre-sesión — puede abrir la próxima sesión de IMP-2); su entrada en
  WRITES (8 KiB, admin) aterriza con la UI — `web/console/src/`

> El carril IDEA-10 de consola está CERRADO (release a48a81b): panel,
> equipos, alertas, consulta BD, reglas, ruido, respuesta, flujo en
> vivo, analista y la ficha de evento leen del diccionario ES/EN.

### PUL (pulimiento)
- Petición de IMP-1 en vuelo: cuando aterrice
  reglas-interpretes-envueltos, tercera deriva de la cifra
  (123→125) en README y docs/ — mismos sitios que su ronda 3.
- Candidata ligera (petición de IMP-2, que ofrece la zona): la línea
  de error del analista dice «conexion» sin tilde — una palabra en
  dict-es (analyst.errorLine) + su batería — `web/console/src/lib/
  i18n/`
- Rutina en Decisiones: consolidar `changelog.d/` al cerrar cada ronda
  (3 fragmentos de la ronda 4 a la espera: sensor cap, doctor,
  status-poll).

### SEG (seguridad y bugs)
- Cerró yara-fuentes-capadas esta pasada (ver Cerradas). Sin tarea
  reclamable hasta que s2 aterrice: sec2-dpapi, regresión PR #28 y
  reconexiones/spool necesitan Windows real — ver «Esperando al
  humano». Nota menor viva: `is_excluded` compara prefijos en texto;
  un junction dentro del directorio de reglas escanearía el eco del
  pack (ruido, sin impacto en evidencia); revisar cuando s2 aterrice
  en el sensor.

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

- Subir el poll de useYaraStatus() al nivel de la vista (hoy dentro
  de SensorCard: N sensores = N polls paralelos de GET /api/yara con
  walk cada 60 s — carga que crece con la flota) y avisar en UI
  cuando un fetch falla manteniendo el status viejo en silencio
  (petición de SEG, ronda 6) — `web/console/src/`.
- Barrer los últimos SEVERITY_LABEL/ATTACK_TACTICS de noc-mode con el
  patrón ya listo en rules-view (IMP-2, cola i18n).
- Pasar formatTime/formatDateTime con idioma en los call-sites ya
  barridos: alerts, directory, intel, fleet, playbook, baseline
  (IMP-2, cola i18n).
- Filtro de asignación en `GET /api/alerts/search` + lente persistida
  en URL (IMP-2; para no pisar `internal/api/` mientras IMP-1 trabaja
  allí).
- Migrar el ciclo de vida a SQLite: cola sin asignar paginada exacta
  (IMP-2, hornada 2 prevista).
- Señal para binarios con nombre propio que envuelvan intérpretes
  (RECLAMADA por su proponente IMP-1 — ver EN VUELO).
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

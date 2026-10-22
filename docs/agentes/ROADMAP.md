# ROADMAP — bluetardigrade (coordinación de agentes v2)

Fase actual, próximas tareas y contratos entre componentes. Lo edita SOLO
DIR; el resto propone cambios en la sección «Propuestas» de su
`estado/<ID>.md`. El QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md). Ante cualquier choque, manda TODO.md.

Última actualización: 2026-10-22 (DIR, sexta pasada + micro-pase:
m3-yara-motor y c4-consulta-bd-ui cerrados, CI 6/6 en la cabeza,
s2-yara-memoria desbloqueada; PUL sirvió la hornada doc H-001/H-002 e
integró la ronda en el CHANGELOG; IMP-2 en vuelo sobre
idea10-idiomas-resto con la fase 11 en main; H-005 reasignada a IMP-2).

## Fase actual

Cuatro entregas en main desde la quinta pasada: IMP-1 cerró
m3-yara-motor (pack YARA con huella sha16 por contenido, recarga
perezosa, GET /api/yara y /api/yara/bundle, `yara_rules_sha` en el
latido de flota, -yara-rules en el motor, OpenAPI regenerada); IMP-2
aterrizó c4-consulta-bd-ui (59b5b28); PUL cerró
changelog-consolidar-fragmentos (42 fragmentos → [Unreleased] en 9
secciones) y deps-audit-concurrency-comentario; SEG cerró
scan-toctou-lectura-capada (43d92b8). CI 6/6 en la cabeza (e4bd42a y
sucesores). PUL sirvió además la hornada doc de TEST (H-001/H-002,
resueltas y a la espera del cierre de TEST) y consolidó la ronda en el
CHANGELOG; IMP-2 aterrizó la fase 11 de IDEA-10 (eventDetail y
formateadores compartidos bilingües, c1ce7d3) y sigue EN VUELO con
claim sobre el resto del carril (reglas ya servidas, f3c9b22).
Hallazgos: H-001/H-002 en
resuelto-pendiente-verificación; H-005 reasignada a IMP-2 (su arreglo
vive en web/console/README.md); H-003/H-004/H-006 siguen abiertas para
IMP-1. La petición de IMP-2 (texto viejo de IDEA-10 en TODO.md) queda
servida.

## Decisiones vigentes que obligan a todos

Las de TODO.md («Decisiones vigentes») siguen en pie: validación de
detecciones solo con telemetría sintética e inerte; AD en solo lectura;
ninguna acción en equipos es «ejecutar un comando» (conjunto cerrado,
firmado, auditado y con lista de protegidos); nada de feeds ni
herramientas de terceros descargadas solos; CI en verde antes de dar
una tarea por cerrada (la run que manda es la de la cabeza de main —
cancelar por supersesión NO es fallo, pero verifica AMBOS pases de
staticcheck antes de dar una entrega de motor por verde); punto
completado = fuera de TODO.md + entrada propia en `changelog.d/`;
`changelog.d/` se consolida en CHANGELOG.md AL CERRAR CADA RONDA, no
semana y media después (lección de los 42 fragmentos).

## ALTA

- Sin ALTA abierta.

## Tareas por rol

### IMP-1 (motor Go + sensor Rust)
- [ ] (IMP-1) s2-yara-memoria — DESBLOQUEADA por m3: escaneo de memoria
  de procesos con yara-x (decisión de atribución PID pendiente, ver
  contrato S-2↔M-3) — `sensor/`
- [ ] (IMP-1) m7-wef-pack — pack AD por ID de evento (4625/4769/4662/
  4728/4732/4756/7045); la guía existe: `docs/AD-WEF-SUSCRIPCION.md` —
  `rules/`
- [ ] (IMP-1) pol1c-collector — dividir `sensor/src/collector.rs`
  (479 líneas) sin cambio de comportamiento, si el análogo POL-1 de
  run.go aplica aquí (propuesta de PUL tras verificar pol1b) —
  `sensor/`
- [ ] (IMP-1) doctor-yara-check — `engine doctor` valida el directorio
  `-yara-rules` como ya hace con intel (propuesta de IMP-1 adoptada;
  pequeña) — `internal/`

### IMP-2 (consola Next.js)
- [ ] (IMP-2) idea10-idiomas-resto — EN VUELO (claim activo; en main
  ya: fase 10, eventDetail + formateadores c1ce7d3 y reglas f3c9b22):
  restan ruido, respuesta, flujo en vivo y analista —
  `web/console/src/`
- [ ] (IMP-2) H-005 — línea de SF_API_TOKEN en el quickstart de
  `web/console/README.md` (hallazgo BAJO de TEST, reasignado por PUL:
  la zona web/ no es suya)
- [ ] (IMP-2) ad7-login-consola — hornada de login de dominio; ANTES:
  sesión de diseño con DIR (el proxy exige principal y la ruta es
  pre-sesión — puede abrir la próxima sesión de IMP-2); su entrada en
  WRITES (8 KiB, admin) aterriza con la UI — `web/console/src/`
- [ ] (IMP-2) consola-yara-desfase — indicador de desfase del lote YARA
  (sha de `/api/fleet` contra `/api/yara`), propuesta de IMP-1 adoptada
  en zona IMP-2 — `web/console/src/`
- [ ] (IMP-2) tema-claro — rework de contraste, superficies y gráficas
  (resto del carril F5); coordinar los guards con IMP-1 —
  `web/console/src/`

### PUL (pulimiento)
- Tablero vacío: sirvió la hornada doc (H-001/H-002 en
  resuelto-pendiente-verificación) y consolidó la ronda en el CHANGELOG.
  H-005 reasignada a IMP-2 (zona web/).
- Rutina ya en Decisiones: consolidar `changelog.d/` al cerrar cada
  ronda (aplicada dos veces hoy).

### SEG (seguridad y bugs)
- Sin tarea reclamable: sec2-dpapi, regresión PR #28 y
  reconexiones/spool necesitan Windows real — ver «Esperando al
  humano». Nota menor viva: `is_excluded` compara prefijos en texto;
  un junction dentro del directorio de reglas escanearía el eco del
  pack (ruido, sin impacto en evidencia); revisar cuando s2 aterrice
  en el sensor.

### TEST (tester por personas)
- [x] (TEST) test-arranque-hallazgo-cero — CERRADA: pipeline punta a
  punta verde y 6 hallazgos BAJO (H-001..H-006), sin CRÍTICO ni ALTO;
  H-001/H-002 ya resueltas por PUL y esperando el cierre de TEST en su
  próxima sesión — `docs/agentes/hallazgos/`
- [ ] (TEST) test-carga-volumetrica — SIGUIENTE SESIÓN, lista para
  lanzar: 10k eventos de carga, beaconing con las 2 cadenas del
  perfil, consola en build de producción con las verificaciones de
  Chromium de `tools/` — `.agent-tmp/`, `docs/agentes/hallazgos/`

## Cerradas (últimas 24 h)

- idea10 fase 11 (formateadores + eventDetail c1ce7d3; reglas
  f3c9b22) — (IMP-2; el carril sigue en vuelo con claim)
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

- Filtro de asignación en `GET /api/alerts/search` + lente persistida
  en URL (IMP-2; para no pisar `internal/api/` mientras IMP-1 trabaja
  allí).
- Migrar el ciclo de vida a SQLite: cola sin asignar paginada exacta
  (IMP-2, hornada 2 prevista).
- Señal para binarios con nombre propio que envuelvan intérpretes
  (IMP-1).
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

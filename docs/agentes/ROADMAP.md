# ROADMAP — bluetardigrade (coordinación de agentes v2)

Fase actual, próximas tareas y contratos entre componentes. Lo edita SOLO
DIR; el resto propone cambios en la sección «Propuestas» de su
`estado/<ID>.md`. El QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md). Ante cualquier choque, manda TODO.md.

Última actualización: 2026-10-22 (DIR, tercera pasada: fusión de PRs
#47/#48, hornada proxy de la petición de SEG, sincronía de tablero).

## Fase actual

Jornada cerrada de punta a punta: M-2 (AD-7 motor) y M-4 (consulta BD
solo lectura) en main; F5 y C-5 en la consola; segunda ronda SEG (WRITES
de asignación en el proxy, redirects erradicados); PUL con la higiene
postmigración verificada. El CI destapó dos pases de staticcheck que
ninguna run juzgó (ST1003 y ST1000 en el código M-4): reparados en
paralelo por IMP-1 (st100x) y dentro del PR #48, convergidos sin
duplicado. Fusión de PRs: #47 (P-4, expiración de bundles O(1), con
merge de main que mantiene retirada la coordinación v1) y #48 (S-2,
YARA en el sensor: ficheros escritos y bajo demanda). DIR cerró la
petición de SEG en la consola: POST /api/db/query en el allowlist
WRITES (admin, 64 KiB) y tope de lote 500→400 (el cap de 8 KiB del
motor mataba los lotes de ~430-500 ids con 413). En vuelo con claim:
IDEA-10 fase 6 (IMP-2, diccionario del Panel).

## Decisiones vigentes que obligan a todos

Las de TODO.md («Decisiones vigentes») siguen en pie: validación de
detecciones solo con telemetría sintética e inerte; AD en solo lectura;
ninguna acción en equipos es «ejecutar un comando» (conjunto cerrado,
firmado, auditado y con lista de protegidos); nada de feeds ni
herramientas de terceros descargadas solos; CI en verde antes de dar
una tarea por cerrada (la run que manda es la de la cabeza de main —
cancelar por supersesión NO es fallo, pero verifica AMBOS pases de
staticcheck antes de dar una entrega de motor por verde); punto
completado = fuera de TODO.md + entrada propia en `changelog.d/`.

## ALTA

- Sin ALTA abierta. `pol1b-dividir-run-go` quedó DESBLOQUEADA por los
  releases de M-2/M-4: primera tarea natural de PUL.

## Tareas por rol

### IMP-1 (motor Go + sensor Rust)
- [ ] (IMP-1) m3-yara-motor — YARA en el motor: partir del contrato del
  PR #48 (directorio + bundle.json; verificación por yara_rules_sha en
  el latido); la firma local llega con E-1 — `internal/`, `pkg/`
- [ ] (IMP-1) s2-yara-memoria — escaneo de memoria de procesos con
  yara-x (tras M-3; decisión de atribución PID pendiente) — `sensor/`
- [ ] (IMP-1) m7-wef-pack — pack AD por ID de evento (4625/4769/4662/
  4728/4732/4756/7045); requiere la guía WEF — `rules/`

### IMP-2 (consola Next.js)
- [ ] (IMP-2) idea10-idiomas-panel — EN VUELO (claim activo, fase 6:
  diccionario del Panel) — `web/console/src/`
- [ ] (IMP-2) c4-consulta-bd-ui — UI de consulta sobre POST /api/db/query
  (el proxy ya la deja pasar; admin, resultados con tope de filas) —
  `web/console/src/`
- [ ] (IMP-2) ad7-login-consola — hornada de login de dominio; ANTES:
  diseño con DIR (el proxy exige principal y la ruta es pre-sesión); su
  entrada en WRITES (8 KiB, admin) aterriza con la UI —
  `web/console/src/`
- [ ] (IMP-2) tema-claro — rework de contraste, superficies y gráficas
  (resto del carril F5) — `web/console/src/`

### PUL (pulimiento)
- [ ] (PUL) pol1b-dividir-run-go — dividir `cmd/engine/run.go` sin
  cambio de comportamiento; DESBLOQUEADA — `cmd/engine/`, `scripts/`
- [ ] (PUL) deps-audit-checks-write — `checks: write` en deps-audit.yml
  para que rustsec/audit-check publique informes no vacíos (petición de
  IMP-1 desde PR #48); permite retirar bincode de la excepción —
  `.github/`

### SEG (seguridad y bugs)
- [ ] (SEG) sec9-privacidad — minimizar PII en logins y líneas de
  tiempo, retención y auditoría de fichas — transversal
- Candidatas de TODO.md que necesitan Windows real: sec2-dpapi,
  regresión PR #28, reconexiones/spool — ver «Esperando al humano».

## Cerradas (últimas 24 h)

- M-2 AD-7 motor — internal/ad + POST /api/auth/domain (IMP-1; PR #48
  trae además el sensor YARA)
- M-4 consulta BD — 5e0eeea + e518323 (YAML inválidos del spec) +
  cc8419e (ST1000)
- S-2 YARA ficheros — PR #48 fusionado (3ad96c5); contrato S-2↔M-3
  definido en su descripción
- P-4 expiración O(1) — PR #47 fusionado (0852ebf), bench nuevo
- F5 kit-resto-vistas — fc8e478..f570245 (IMP-2) + variante solid y
  Textarea en el kit
- C-5 aviso sensores desactualizados — a038aa3 (IMP-2)
- SEG ronda 2 — WRITES de asignación en el proxy + últimos redirects
  (getJSONInto/apiHealth) (SEG)
- st100x — ST1003/ST1000 del código M-4: fb1ff2d (IMP-1) + cc8419e
  (DIR, §2); aprendizaje: verificar ambos pases de staticcheck
- proxy-db-query-y-tope-lote — 919db63 (IMP-2/DIR): WRITES + hint 405 +
  tope 400 con regresión del cuerpo bajo 8 KiB
- make-tabs — e1dc5c6 (IMP-1): tabs del Makefile + guard local
- higiene-postmigracion — 927f069 (PUL, verificación completa)
- PR #46 cerrado sin fusionar (informe v1; retirada de v1 en vigor)

## Propuestas en el tablero (de los estados)

- Filtro de asignación en `GET /api/alerts/search` + lente persistida en
  URL (IMP-2; tras C-4, para no pisar `internal/api/`).
- Migrar el ciclo de vida a SQLite: cola sin asignar paginada exacta
  (IMP-2, hornada 2 prevista).
- Señal para binarios con nombre propio que envuelvan intérpretes
  (IMP-1).

## Esperando al humano (no reclamables)

- Fusionar o cerrar Dependabot #24–#27 con CI en verde; borrar ramas
  `100agentes`, `audit/mejoras-2026-10-08`, `integracion/rondas-2-3`;
  «Automatically delete head branches»; tags sueltos y About/topics (F0).
- Pruebas en Windows real: `sf-start`/`sf-stop`/instalador, login/MFA/
  cuentas (sección 7), grupos y permisos (7b/7c), prueba de uso 24–48 h;
  YARA en ficheros ya pide su prueba propia en el sensor.
- Visto bueno al contrato del canal servidor→sensor ANTES de la épica
  E-1..E-4.

## Contratos entre componentes

| Contrato | Estado | Detalle |
|---|---|---|
| M-1 → C-2 (TEAM-3) | **CERRADO** | Fuente de verdad: `docs/api/openapi.yaml` |
| S-2 ↔ M-3 (YARA) | **DEFINIDO** (PR #48) | Distribución = directorio + bundle.json (versión); sensor recalca por fingerprint cada minuto; verificación de llegada por `yara_rules_sha` en el latido; una regla rota no tumba el paquete (se salta y se reporta; todo-roto = error). Firma local con E-1 |
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

# ROADMAP — bluetardigrade (coordinación de agentes v2)

Fase actual, próximas tareas y contratos entre componentes. Lo edita SOLO
DIR; el resto propone cambios en la sección «Propuestas» de su
`estado/<ID>.md`. El QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md). Ante cualquier choque, manda TODO.md.

Última actualización: 2026-10-22 (DIR, quinta pasada: hornada SEG/PUL
cerrada — sec9, deps-audit, verificación pol1b —, fase 10 de IDEA-10 en
main, m3 y c4 en vuelo, WEF desbloqueada, TEST arranca).

## Fase actual

Tres sesiones cerradas desde la pasada anterior: SEG completó
sec9-privacidad (auditoría de fichas AD, cabecera x-sf-account del
proxy, retención de query_audit/ad_read_audit/ad_posture_history y
login capado); PUL cerró deps-audit-checks-write y VERIFICÓ que
pol1b ya estaba servida por 088eaaa (POL-1: run.go de 1346 a ~330
líneas; fragmentar más es churn — retirada del tablero); IMP-2 aterrizó
la fase 10 de IDEA-10 (Equipos bilingüe). En vuelo con claim: m3
(IMP-1, YARA en el motor) y c4 (IMP-2, UI de consulta BD). CI de la
cabeza 3adf07c: lanes Go/consola/sensor en curso o canceladas por
concurrency (comportamiento conocido; verificar la run de la cabeza al
cerrar cada tarea). TEST arranca su primera sesión (hallazgo-cero).

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

- Sin ALTA abierta.

## Tareas por rol

### IMP-1 (motor Go + sensor Rust)
- [ ] (IMP-1) m3-yara-motor — EN VUELO (claim activo): pack guardado en
  `-yara-rules`, sha16 comparable con el `yara_rules_sha` del latido —
  `internal/`, `pkg/`
- [ ] (IMP-1) m7-wef-pack — pack AD por ID de evento (4625/4769/4662/
  4728/4732/4756/7045); la guía existe: `docs/AD-WEF-SUSCRIPCION.md` —
  `rules/`
- [ ] (IMP-1) s2-yara-memoria — escaneo de memoria de procesos con
  yara-x (tras M-3; decisión de atribución PID pendiente) — `sensor/`
- [ ] (IMP-1) pol1c-collector — dividir `sensor/src/collector.rs`
  (479 líneas) sin cambio de comportamiento, si el análogo POL-1 de
  run.go aplica aquí (propuesta de PUL tras verificar pol1b) —
  `sensor/`

### IMP-2 (consola Next.js)
- [ ] (IMP-2) c4-consulta-bd-ui — EN VUELO (claim activo): vista
  «Consulta BD» solo admin, formulario SQL con max_rows/timeout_ms,
  tabla con meta, ejemplos sobre el esquema real — `web/console/src/`
- [ ] (IMP-2) idea10-idiomas-resto — carril IDEA-10 restante: reglas,
  ruido, respuesta, flujo en vivo, analista y eventDetail (compartido
  con flujo) — `web/console/src/`
- [ ] (IMP-2) ad7-login-consola — hornada de login de dominio; ANTES:
  diseño con DIR (el proxy exige principal y la ruta es pre-sesión); su
  entrada en WRITES (8 KiB, admin) aterriza con la UI —
  `web/console/src/`
- [ ] (IMP-2) tema-claro — rework de contraste, superficies y gráficas
  (resto del carril F5); coordinar los guards con IMP-1 —
  `web/console/src/`

### PUL (pulimiento)
- Tablero vacío tras cerrar deps-audit y verificar pol1b. Candidata
  ligera (propia): el comentario de concurrency en deps-audit.yml dice
  «queue the run» pero GitHub cancela las pendientes intermedias —
  ajustar el comentario a la realidad — `.github/`

### SEG (seguridad y bugs)
- Tablero vacío tras cerrar sec9. Candidatas de TODO.md que necesitan
  Windows real: sec2-dpapi, regresión PR #28, reconexiones/spool — ver
  «Esperando al humano».

### TEST (tester por personas)
- [x] (TEST) test-arranque-hallazgo-cero — CERRADA: pipeline punta a
  punta verde y 6 hallazgos BAJO abiertos (H-001..H-006: 3 doc para
  PUL, 3 mejora para IMP-1), sin CRÍTICO ni ALTO —
  `docs/agentes/hallazgos/`

## Cerradas (últimas 24 h)

- sec9-privacidad — 5dde23b (auditoría de fichas AD), 9d3da08 (proxy
  declara x-sf-account), 7ee5058 (login capado), e37e473 (changelog +
  TODO); suite Go verde, staticcheck doble pase (SEG)
- deps-audit-checks-write — 0dea0aa/ff15ee4/5687747 (PUL): checks:
  write a nivel de job, bincode fuera de la excepción, verificado en
  CI con informe no vacío
- pol1b-dividir-run-go — VERIFICADA, ya servida por 088eaaa (POL-1);
  sin cambios de código; retirada del tablero (PUL)
- idea10-idiomas-equipos-flota (fase 10) — f144532 (IMP-2)
- IDEA-10 fases 6-9 — ce5f579, a8b15ef, 38040e2, 298b32c (IMP-2)
- proxy-db-query-y-tope-lote — 919db63 (IMP-2/DIR)
- M-2 AD-7 motor + S-2 YARA sensor — PR #48 (3ad96c5); M-4 consulta BD
  — 5e0eeea + e518323 + cc8419e; P-4 expiración O(1) — PR #47 (0852ebf)
- F5 kit-resto-vistas + C-5 aviso sensores — fc8e478..f570245, a038aa3
- SEG ronda 2 — WRITES de asignación + redirects; st100x — fb1ff2d +
  cc8419e; make-tabs — e1dc5c6; higiene-postmigracion — 927f069
- PR #46 cerrado sin fusionar (retirada de v1 en vigor)

## Propuestas en el tablero (de los estados)

- Filtro de asignación en `GET /api/alerts/search` + lente persistida
  en URL (IMP-2; tras C-4, para no pisar `internal/api/`).
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

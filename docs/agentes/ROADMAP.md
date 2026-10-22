# ROADMAP — bluetardigrade (coordinación de agentes v2)

Fase actual, próximas tareas y contratos entre componentes. Lo edita SOLO
DIR; el resto propone cambios en la sección «Propuestas» de su
`estado/<ID>.md`. El QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md). Ante cualquier choque, manda TODO.md.

Última actualización: 2026-10-22 (DIR, cuarta pasada: CI de la cabeza
verificado 5/5, IDEA-10 fases 6-9 a cerradas, carril restante al
tablero, gobernanza preparada para TEST).

## Fase actual

Jornada verificada de punta a punta: la cabeza de main (298b32c) pasa los
cinco checks de CI (govulncheck/osv-scanner/cargo audit, sensor, motor
Go, consola, conductual Windows). IDEA-10 fases 6-9 en main: Panel,
Directorio, Validación + probador e Intel/Supresiones/Cadenas bilingües
(ce5f579, a8b15ef, 38040e2, 298b32c); el texto del motor sigue literal.
Claims vacíos, sin restos v1, higiene al día. Gobernanza ampliada para
TEST: fila en OWNERSHIP, `docs/agentes/hallazgos/` y lectura de
hallazgos en el paso 2 del PROTOCOLO — TEST aún no ha corrido ninguna
sesión.

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
- [ ] (IMP-1) m3-yara-motor — YARA en el motor: partir del contrato del
  PR #48 (directorio + bundle.json; verificación por yara_rules_sha en
  el latido); la firma local llega con E-1 — `internal/`, `pkg/`
- [ ] (IMP-1) s2-yara-memoria — escaneo de memoria de procesos con
  yara-x (tras M-3; decisión de atribución PID pendiente) — `sensor/`
- [ ] (IMP-1) m7-wef-pack — pack AD por ID de evento (4625/4769/4662/
  4728/4732/4756/7045); requiere la guía WEF — `rules/`
- [ ] (IMP-1) tema-guards-variante — si aterriza tema-claro (IMP-2):
  extender check_console_theme.py y check_console_a11y.mjs a la nueva
  variante — `scripts/`

### IMP-2 (consola Next.js)
- [ ] (IMP-2) idea10-idiomas-flota — carril IDEA-10 restante: equipos y
  flota (hosts-view, fleet-parts, enroll-parts) y luego reglas, ruido,
  respuesta, flujo en vivo, analista y eventDetail (compartido con
  flujo) — `web/console/src/`
- [ ] (IMP-2) c4-consulta-bd-ui — UI de consulta sobre POST
  /api/db/query (el proxy ya la deja pasar; admin, resultados con tope
  de filas) — `web/console/src/`
- [ ] (IMP-2) ad7-login-consola — hornada de login de dominio; ANTES:
  diseño con DIR (el proxy exige principal y la ruta es pre-sesión); su
  entrada en WRITES (8 KiB, admin) aterriza con la UI —
  `web/console/src/`
- [ ] (IMP-2) tema-claro — rework de contraste, superficies y gráficas
  (resto del carril F5); coordinar los guards con IMP-1 —
  `web/console/src/`

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

### TEST (tester por personas; zona nueva)
- [ ] (TEST) test-arranque-hallazgo-cero — primera sesión: instalar y
  arrancar desde SOLO el README con 4 personas rotando (nuevo,
  avanzado, torpe, malintencionado); el README que falla es ya el
  primer hallazgo, dirigido a PUL — `tests/e2e/`,
  `docs/agentes/hallazgos/`

## Cerradas (últimas 24 h)

- IDEA-10 fases 6-9 — Panel (ce5f579), Directorio (a8b15ef), Validación
  y probador (38040e2), Intel/Supresiones/Cadenas (298b32c); ES
  byte-idéntico, EN traducción real (IMP-2)
- proxy-db-query-y-tope-lote — 919db63 (IMP-2/DIR): WRITES + hint 405 +
  tope 400 con regresión del cuerpo bajo 8 KiB; resuelve la petición de
  SEG sobre el techo real de asignación
- M-2 AD-7 motor — internal/ad + POST /api/auth/domain (IMP-1; PR #48
  trae además el sensor YARA S-2, 3ad96c5, contrato S-2↔M-3 definido)
- M-4 consulta BD — 5e0eeea + e518323 + cc8419e (ST1000)
- P-4 expiración O(1) — PR #47 fusionado (0852ebf), bench nuevo
- F5 kit-resto-vistas + C-5 aviso sensores desactualizados —
  fc8e478..f570245 y a038aa3 (IMP-2)
- SEG ronda 2 — WRITES de asignación en el proxy + últimos redirects
  (getJSONInto/apiHealth)
- st100x — fb1ff2d (IMP-1) + cc8419e (DIR); aprendizaje: verificar
  ambos pases de staticcheck
- make-tabs — e1dc5c6 (IMP-1); higiene-postmigracion — 927f069 (PUL)
- PR #46 cerrado sin fusionar (retirada de v1 en vigor)

## Propuestas en el tablero (de los estados)

- Filtro de asignación en `GET /api/alerts/search` + lente persistida en
  URL (IMP-2; tras C-4, para no pisar `internal/api/`).
- Migrar el ciclo de vida a SQLite: cola sin asignar paginada exacta
  (IMP-2, hornada 2 prevista).
- Señal para binarios con nombre propio que envuelvan intérpretes
  (IMP-1).
- Alinear website/ con s2-yara-memoria cuando aterrice: la web ya
  anuncia «YARA memory scanning» (DIR).

## Esperando al humano (no reclamables)

- Fusionar o cerrar Dependabot #24–#27 con CI en verde (los cuatro
  siguen abiertos, verificado en esta pasada); borrar ramas
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

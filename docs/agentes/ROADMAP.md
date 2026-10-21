# ROADMAP — bluetardigrade (coordinación de agentes v2)

Fase actual, próximas tareas y contratos entre componentes. Lo edita SOLO
DIR; el resto propone cambios en la sección «Propuestas» de su
`estado/<ID>.md`. El QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md). Ante cualquier choque, manda TODO.md.

Última actualización: 2026-10-22 (DIR, cierre de la hornada TEAM-3).

## Fase actual

TEAM-3 completo de punta a punta: motor (PR #45) y consola (C-2, «Mis
alertas», cola sin asignar, reasignación y lote). F1 cerrada con fix real
(sumideros de aviso sin redirecciones). SEC-3 verificada sin cambios de
código. O-2 mitad endpoint entregada (119 reglas). En vuelo con claim
activo: M-2 (AD-7 login LDAPS) y M-4 (consulta BD solo lectura), dos
instancias IMP-1 sobre ficheros disjuntos. Siguiente carril consola: F5.

## Decisiones vigentes que obligan a todos

Las de TODO.md («Decisiones vigentes») siguen en pie: validación de
detecciones solo con telemetría sintética e inerte; AD en solo lectura;
ninguna acción en equipos es «ejecutar un comando» (conjunto cerrado,
firmado, auditado y con lista de protegidos); nada de feeds ni herramientas
de terceros descargadas solos; CI en verde antes de dar una tarea por
cerrada (en día movido la run que manda es la de la cabeza de main —
cancelar por supersesión NO es fallo); punto completado = fuera de TODO.md
+ entrada propia en `changelog.d/`.

## ALTA

- Sin ALTA abierta. `pol1b-dividir-run-go` sigue prioritaria para PUL pero
  BLOQUEADA hasta que m2-ad7 y m4-consulta-bd liberen `cmd/engine/`.

## Tareas por rol

### IMP-1 (motor Go + sensor Rust)
- [ ] (IMP-1) m2-ad7-login-ldaps — EN VUELO (claim activo): bind LDAPS con credenciales del usuario, grupos AD → roles — `internal/ad/`, `internal/api/`, `cmd/engine/`
- [ ] (IMP-1) m4-consulta-bd — EN VUELO (claim activo): consulta SQLite SOLO lectura, límites de filas/tiempo, auditada; habilita C-4 — `internal/store/`, `internal/api/`
- [ ] (IMP-1) s2-yara-sensor — YARA en sensor con yara-x: escaneo de ficheros escritos y bajo demanda; el contrato con M-3 se define al arrancar — `sensor/`

### IMP-2 (consola Next.js)
- [ ] (IMP-2) f5-kit-resto-vistas — Continuar el kit POL-7 en el resto de vistas (cabeceras con indicadores, estados vacíos útiles, tema claro) — `web/console/src/`
- [ ] (IMP-2) c5-aviso-sensores-desactualizados — Aviso en Equipos de sensores desactualizados (la versión ya viaja en el latido, S-4 en main) — `web/console/src/`

### PUL (pulimiento)
- [ ] (PUL) pol1b-dividir-run-go — Dividir `cmd/engine/run.go` sin cambio de comportamiento; BLOQUEADA por claims activos en `cmd/engine/` — `cmd/engine/`, `scripts/dev-tests/`
- [ ] (PUL) pol5-openapi-operations — Referencia de la API en OPERATIONS generada desde `docs/api/openapi.yaml` — `docs/`
- [ ] (PUL) higiene-postmigracion — `docs/agentes/` solo con los cinco artefactos, `.agent-tmp/` en uso, dependencias sincronizadas — `docs/agentes/`, `.gitignore`, manifiestos

### SEG (seguridad y bugs)
- Sin tarea activa. Siguientes candidatas del backlog de TODO.md
  (regresión PR #28, reconexiones/spool del sensor) necesitan Windows real
  — ver «Esperando al humano». Proponer la siguiente en «Propuestas».

## Cerradas (últimas 24 h)

- C-2 TEAM-3 consola — 6d29f9c + 9b86d8b (IMP-2; 572 tests, tsc, next build)
- F1 aviso de alerta crítica — 0dddc28 (sumideros de salida sin redirecciones) + 934c80f (SEG)
- SEC-3 entradas — c6e4248 (verificada sin cambios de código, evidencia en estado/SEG.md)
- O-2 mitad endpoint — 21468d7 (pack AD, 5 reglas + evidencia, inventario 119)
- M-1 backend de asignación — PR #45 (cerrada con C-2)
- deps-audit sin cancelación — concurrency propio (fix DIR tras «Peticiones» de IMP-2)

## Propuestas en el tablero (de los estados)

- Filtro de asignación en `GET /api/alerts/search` + lente persistida en
  URL (IMP-2; tras M-4, para no pisar `internal/api/`).
- Migrar el ciclo de vida a SQLite: cola sin asignar paginada exacta (IMP-2,
  hornada 2 prevista).
- Señal para binarios con nombre propio que envuelvan intérpretes (IMP-1).

## Esperando al humano (no reclamables)

- Fusionar o cerrar Dependabot #24–#27 con CI en verde; borrar ramas
  `100agentes`, `audit/mejoras-2026-10-08`, `integracion/rondas-2-3`;
  «Automatically delete head branches»; tags sueltos y About/topics (F0).
- Pruebas en Windows real: `sf-start`/`sf-stop`/instalador (F1 ya necesita
  re-verificación con el fix de sumideros), login/MFA/cuentas (sección 7),
  grupos y permisos (7b/7c), prueba de uso 24–48 h.
- Visto bueno al contrato del canal servidor→sensor ANTES de la épica
  E-1..E-4.

## Contratos entre componentes

| Contrato | Estado | Detalle |
|---|---|---|
| M-1 → C-2 (TEAM-3) | **CERRADO** (motor PR #45 + consola C-2 en main) | Resumen abajo; fuente de verdad: `docs/api/openapi.yaml` |
| S-2 ↔ M-3 (YARA) | Pendiente | Se define al arrancar S-2: distribución firmada de reglas y formato |
| E-1 → E-2/E-3/E-4 | **Bloqueado por visto bueno del humano** | Canal firmado servidor→sensor: se aprueba ANTES de empezar la épica |
| S-1 (cerrado) | Decisión vigente | El dato escrito viaja en `registry.value`; raíz con `user` + `attributes["registry_root_inferred"]`; NO existe `registry.value_data` |

### Contrato M-1→C-2 (referencia, cerrado)

- Asignación = trío `assignee`/`assigned_by`/`assigned_at` en la misma
  entrada de ciclo de vida que el triaje; en bloque; vacío = sin asignar;
  triar nunca desasigna. `POST /api/alerts/{id}/assign`,
  `POST /api/alerts/assign-batch` (500 ids, no atómico, ids existentes),
  `GET /api/alerts?assignee=&unassigned=`, SSE `alert_lifecycle` con el
  trío. En modo tienda el filtro se aplica sobre la ventana consultada
  (será exacto al migrar el ciclo de vida a SQLite).

# ROADMAP — bluetardigrade (coordinación de agentes v2)

Fase actual, próximas tareas y contratos entre componentes. Lo edita SOLO
DIR; el resto propone cambios en la sección «Propuestas» de su
`estado/<ID>.md`. El QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md). Ante cualquier choque, manda TODO.md.

Última actualización: 2026-10-22 (DIR, ronda de migración v1→v2).

## Fase actual

La hornada 1 está cerrada en lo esencial: M-1 (backend de asignación),
S-1, S-4, S-5, P-3, C-1 y O-1 fusionados en main. Arranca el sistema de
agentes v2: `PROTOCOLO.md` es la única fuente de reglas, `claims/` es el
cerrojo y `estado/<ID>.md` el único informe (se sobrescribe). Prioridades:
cerrar TEAM-3 con la vista de consola (C-2), cerrar F1 y entrar en hornada
2 (reglas AD, login de dominio).

## Decisiones vigentes que obligan a todos

Las de TODO.md («Decisiones vigentes») siguen en pie: validación de
detecciones solo con telemetría sintética e inerte; AD en solo lectura;
ninguna acción en equipos es «ejecutar un comando» (conjunto cerrado,
firmado, auditado y con lista de protegidos); nada de feeds ni herramientas
de terceros descargadas solos; CI en verde antes de cada push; punto
completado = fuera de TODO.md + entrada en `changelog.d/`.

## ALTA (primero, dirigidas a un ID concreto)

- [ ] (IMP-2) c2-team3-frontend — Vista «Mis alertas», cola sin asignar, reasignación y asignación en lote según el contrato M-1→C-2 (abajo) — `web/console/src/`
- [ ] (SEG) f1-aviso-alerta-critica — Cerrar F1 «alerta crítica sin aviso»: reproducir y verificar las tres vías (notificación del navegador, aviso en consola, canales externos) con fix mínimo y test de regresión donde toque; la entrega real de correo/Telegram queda para el humano en Windows — transversal (`cmd/engine/`, `web/console/`, `docs/`)
- [ ] (PUL) pol1b-dividir-run-go — POL-1b: dividir `cmd/engine/run.go` sin cambio de comportamiento (suite verde antes y después) y actualizar los literales de `check_openapi.py` que aún citan `internal/api/api.go` — `cmd/engine/`, `scripts/dev-tests/`

## Tareas por rol

### IMP-1 (motor Go + sensor Rust)
- [ ] (IMP-1) o2-reglas-ad — Reglas AD: 4625 rociado, 4769 Kerberoasting, 4662 DCSync, 4728/4732/4756 altas en grupos privilegiados, 7045 servicios nuevos, cada una con evidencia sintética de disparo y silencio — `rules/`, `scenarios/`, `internal/rules/`
- [ ] (IMP-1) m2-ad7-login-ldaps — AD-7: login con cuentas del dominio (bind LDAPS, grupos de AD → roles); las cuentas locales siguen como respaldo — `internal/ad/`, `internal/api/`, `cmd/engine/`

### IMP-2 (consola Next.js)
- [ ] (IMP-2) f5-kit-resto-vistas — Continuar el kit POL-7 en el resto de vistas (cabeceras con indicadores, estados vacíos útiles, tema claro) — `web/console/src/`

### PUL (pulimiento)
- [ ] (PUL) pol5-openapi-operations — Referencia de la API en OPERATIONS generada desde `docs/api/openapi.yaml` (POL-5) — `docs/`
- [ ] (PUL) higiene-postmigracion — Primera pasada de higiene v2: `docs/agentes/` solo con PROTOCOLO/OWNERSHIP/ROADMAP/claims/estado, `.agent-tmp/` en uso, dependencias sincronizadas con el código — `docs/agentes/`, `.gitignore`, manifiestos de dependencias

### SEG (seguridad y bugs)
- [ ] (SEG) sec3-entradas — SEC-3: revisión de entradas — traversal en descargas, URLs de integraciones validadas, ningún `dangerouslySetInnerHTML` con datos de eventos — transversal

## Esperando al humano (no reclamables)

- Fusionar o cerrar Dependabot #24–#27 con CI en verde; borrar las ramas
  `100agentes`, `audit/mejoras-2026-10-08` e `integracion/rondas-2-3`;
  activar «Automatically delete head branches»; decidir tags sueltos y
  About/topics (F0 en TODO.md).
- Pruebas en Windows real: `sf-start`/`sf-stop`/`-KeepSensor`/`sf-status` e
  instalador silencioso (F1); login, MFA y cuentas (F2, sección 7); grupos y
  permisos (secciones 7b/7c).
- Visto bueno al contrato del canal servidor→sensor ANTES de empezar la
  épica de respuesta ampliada (E-1..E-4).

## Contratos entre componentes

| Contrato | Estado | Detalle |
|---|---|---|
| M-1 → C-2 (TEAM-3) | **Publicado y fusionado (PR #45)** — C-2 ya puede empezar | Resumen abajo; fuente de verdad: `docs/api/openapi.yaml` |
| S-2 ↔ M-3 (YARA) | Pendiente | Se definirá al arrancar S-2: distribución firmada de reglas y formato |
| E-1 → E-2/E-3/E-4 | **Bloqueado por visto bueno del humano** | Canal firmado servidor→sensor: se aprueba ANTES de empezar la épica |
| S-1 (cerrado) | Decisión vigente | El dato escrito viaja en `registry.value`; raíz resuelta con `user` + `attributes["registry_root_inferred"]`; NO existe `registry.value_data` |

### Contrato M-1→C-2 (resumen operativo)

- La asignación vive en la MISMA entrada de ciclo de vida que el triaje
  (`internal/lifecycle`): trío `assignee`/`assigned_by`/`assigned_at`
  (RFC 3339). Se reemplaza SIEMPRE en bloque; vacío = sin asignar;
  reconocer o cerrar NUNCA desasigna. Sin estados nuevos de triaje.
- Escritura: `POST /api/alerts/{id}/assign` con cuerpo
  `{"assignee":"nombre"|"", "by":"quien"}` y `POST /api/alerts/assign-batch`
  con `{"ids":[...], "assignee":..., "by":...}` (tope 500 ids, 8 KiB;
  SIEMPRE 200 con `assigned`/`failed` por id; NO atómico a propósito;
  todos los ids deben existir).
- Lectura en `GET /api/alerts`: `assignee=<nombre>` (coincidencia sin
  mayúsculas) y `unassigned=true` (no combinables → 400); combinables con
  los filtros previos. Trío `omitempty` en cada alerta: ausente = sin
  asignar.
- En vivo: tema SSE `alert_lifecycle` (la consola ya lo consume; el payload
  ahora incluye el trío). Sin temas ni suscripciones nuevas.
- Límites: 200 caracteres por `assignee` y `by`; 10.000 entradas de ciclo de
  vida con expulsión FIFO.
- En modo tienda (`-store`) el filtro se aplica sobre la ventana consultada:
  una página puede volver más corta que `limit` (declarado; será exacto al
  migrar el ciclo de vida a SQLite, ya previsto).
- C-2 NO necesita: eco del assignee al triar, estados nuevos, suscripciones
  nuevas ni paginación especial.

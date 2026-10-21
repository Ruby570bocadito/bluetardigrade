# ROADMAP — coordinación de agentes (docs/agentes/)

Archivo vivo **mantenido solo por los Directores A y B**: fase actual,
próximos hitos, backlog priorizado por rol y estado de los contratos entre
componentes. El resto de instancias lo lee y **propone cambios en sus
informes**; no lo edita.

Relación con otros documentos: el QUÉ con todo el detalle sigue siendo
[TODO.md](../../TODO.md); la dirección del producto por horizontes,
[docs/ROADMAP.md](../ROADMAP.md); la asignación transitoria del kit
previo, TASKS.md (mientras exista, solo material de consulta). Ante
cualquier choque, manda TODO.md.

Última actualización: 2026-10-21 (Director A, ronda bootstrap).

---

## Fase actual — hornada 1 (arranque del sistema)

El kit previo (AG-1..AG-4) fusionó hoy tres PRs que ya adelantan esta
hornada; el sistema nuevo arranca con lo siguiente en marcha:

| Punto | Estado | Notas |
|---|---|---|
| S-1 registro (raíz «?» + valor escrito) | **Entregado** (PR #40) | Ritual pendiente: borrar de TODO.md, entrada en changelog.d/ y reflejar la decisión de esquema (`registry.value` + `user` + `attributes["registry_root_inferred"]`, NO `registry.value_data`) |
| C-1 dashboard con kit POL-7 | **Parcial** (PR #38) | Panel y Operaciones pasan por el kit; faltan el resto de vistas, tema claro, adaptación y grafo (épica F5) |
| O-1 OPERATIONS por capítulos + guía WEF | **Parcial** (PR #39) | Ocho capítulos + esqueleto WEF (docs/AD-WEF-SUSCRIPCION.md); falta referencia de API desde OpenAPI (POL-5) |
| M-1 TEAM-3 backend | **Libre — siguiente pieza grande** | El que llegue primero al carril motor lo reclama con plan publicado; al definir el contrato de asignación de alertas, lo DECLARA en su informe para C-2 |
| POL-1a/1b dividir api.go y run.go | **En curso** (Pulimiento A, plan publicado) | Refactor sin cambio de comportamiento |
| F1 «alerta crítica sin aviso» | **En curso** (Seguridad B, plan publicado) | Causa raíz identificada en TODO.md: `sf-start` no pasa `-notify` |

Sesiones publicadas hoy en `docs/agentes/`: 03-pulimiento/plan_A_actual.md,
04-seguridad/plan_B_actual.md, 01-director/plan_A_actual.md y
01-director/plan_B_actual.md.

## Próximos hitos (hornadas 2–4)

1. **Hornada 2**: C-2 TEAM-3 frontend (tras el contrato de M-1) · M-2
   AD-7 login de dominio LDAPS · S-2 YARA en sensor (yara-x) · M-3 YARA
   en motor (contrato con S-2) · O-2 reglas AD (4625, 4769, 4662,
   4728/4732/4756, 7045).
2. **Hornada 3**: épica «respuesta ampliada» E-1..E-4 (**requiere visto
   bueno del humano al contrato del canal servidor→sensor antes de
   empezar**) · M-4 consulta BD solo lectura · M-6 analista IA por
   grupos · S-3 servicios con permisos débiles · S-4 latido/DPAPI ·
   C-5 aviso de sensores desactualizados · M-7 WEF + AD-3/AD-4.
3. **Hornada 4**: F5 escaparate (C-6 forense UI, O-3 idiomas; capturas
   y vídeo → humano) · calidad (M-9 dividir api.go/run.go — revisar
   solape con POL-1 ya hecho — + log/slog, S-5 dividir collector.rs,
   O-4 SBOM, O-5 SEC-3/6/9) · M-5 ML beta de triaje (solo tras M-1 y C-2).

## Backlog priorizado por rol (IDs de TODO.md)

| Carril | Puntos (en orden sugerido) |
|---|---|
| Implementaciones A (motor) | M-1 → M-2 → M-3 → M-4 → M-7 → M-6 → E-1/E-3 → M-5 |
| Implementaciones B (sensor) | ritual S-1 → S-2 → S-4 → S-3 → E-2 → E-1 (con A) |
| Implementaciones C/D (consola) | continuar C-1 → C-2 (tras contrato) → C-5 → C-3 → C-4 → C-6 → E-4 |
| Pulimiento A/B (backend) | POL-1 (api.go, run.go, collector.rs) → POL-2 slog → POL-3 pprof → consistencia rules/ |
| Pulimiento C/D (frontend/docs) | kit POL-7 en todas las vistas → IDEA-10 idiomas → README/árbol → POL-5 OpenAPI → dependencias |
| Seguridad A/B (bugs funcionales) | F1 alerta crítica (en curso) → regresión PR #28 → reconexiones/spool sensor → falsos positivos de reglas |
| Seguridad C/D (vulnerabilidades) | SEC-3 entradas → SEC-6 cadena de suministro → SEC-9 privacidad → SEC-2 DPAPI → auditoría de instalaciones npx/npm del carril frontend |

## Contratos entre componentes

| Contrato | Estado | Detalle |
|---|---|---|
| M-1 → C-2 (TEAM-3) | **Pendiente de definir** | M-1 define API/estados/cola sin asignar y lo declara en su informe; C-2 NO empieza hasta leerlo |
| S-2 ↔ M-3 (YARA) | **Pendiente** | Se definirá al arrancar S-2 (distribución firmada de reglas, formato) |
| E-1 → E-2/E-3/E-4 | **Bloqueado por visto bueno del humano** | Canal firmado servidor→sensor: el humano aprueba el contrato ANTES de que empiece la épica |
| S-1 (cerrado) | **Decisión vigente** | El dato escrito viaja en `registry.value`; raíz resuelta con `user` + `attributes["registry_root_inferred"]`; no existe `registry.value_data` — respetarlo en reglas y supresiones y actualizar TODO.md |

## Decisiones vigentes que obligan a todas las instancias

Las de TODO.md («Decisiones vigentes») más: telemetría sintética e inerte
para validar detecciones; AD solo lectura; acciones cerradas, firmadas y
auditadas; nada de feeds de terceros automáticos; CI en verde antes de
cada push; punto completado = fuera de TODO.md + entrada en changelog.d/.

## Reglas de este archivo

- Lo editan SOLO los Directores (uno por ronda, según su plan de ronda).
- Se actualiza al cerrar cada ronda: fase, hitos, estados y contratos.
- Las propuestas del resto de instancias viajan por sus informes; el
  Director que edita decide si las sube aquí.

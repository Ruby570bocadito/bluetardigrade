# WORKLOG.md — Registro compartido de agentes

Memoria viva del equipo. **Append-only**: cada sesión AÑADE su entrada al
final del fichero. Nunca se edita ni se borra una entrada anterior. Si algo
no está aquí, es que no pasó.

Qué va en cada entrada: qué hiciste, qué ficheros tocaste, contratos o
decisiones que afectan a otros roles, pendientes y bloqueos. Formato exacto:
ver la plantilla en [AGENTS.md](AGENTS.md).

Reglas rápidas:
- Una entrada por sesión de trabajo, aunque no hayas terminado nada
  (especialmente entonces).
- Las entradas van en orden cronológico (nuevas al final).
- El humano puede añadir entradas de «coordinación» (fusiones, decisiones
  de hornada, cambios de prioridad) con el mismo formato.

---
*(Las entradas de trabajo empiezan debajo de esta línea.)*

---
## 2026-10-21 · AG-3 CONSOLA · C-1 · sesión 1
- Hecho: rediseño de la vista Panel sobre el kit POL-7. Héroe de operación
  (`operations-overview.tsx`): Estado/Actualizar al Button outline y los tres
  CTAs a la forma ghost del kit, con el tinte rojo de datos y el tinte
  primario viajando en `className` (sin variantes nuevas). Salud del pipeline
  (`dashboard.tsx`): estado de conexión como Badge del kit (color semántico
  en `className`, como SeverityBadge) y contadores en hoja de especificación
  2×4 (antes 8 columnas apretadas en media tarjeta), etiqueta en
  micro-mayúsculas y marcador ámbar en filas que piden atención.
  Telemetría reciente: primera vista migrada a la primitiva `ui/table`
  (caption sr-only, cabecera compacta, filas hairline, estados honestos).
  Botón Actualizar del heatmap y enlace Ver flujo completo también al kit.
  README de la consola actualizado en su sección POL-7. Verificación local:
  tsc, 553 tests de consola, build de producción, tema (ambos), guard DOM
  (contrato de tabla incluido), regresión de navegador 23/23, login 9/9,
  analista, a11y 20/20; hub 108 tests.
- Ficheros: `web/console/src/components/console/dashboard.tsx`,
  `web/console/src/components/console/operations-overview.tsx`,
  `web/console/README.md`; además el kit de coordinación (`AGENTS.md`,
  `TASKS.md`, `WORKLOG.md`) llega a la raíz en el primer commit porque aún
  no estaba en el repo y el protocolo exige reclamar C-1 en TASKS.md.
- Contratos/decisiones para otros: no se consume ninguna API nueva del motor
  (todo lee de /api/stats, /api/stream y /api/alerts existentes). La vista
  Panel sigue en español: su migración i18n es IDEA-10 (tarea aparte, junto
  a O-3). AnimatedList deja de animar las filas de Telemetría reciente (un
  motion.div no puede envolver un `<tr>` sin romper el DOM de tabla); sigue
  en las listas no-tabla (Hosts calientes). Los botones-fila de listas
  (abrir host) NO se convierten a Button: son filas interactivas, no
  acciones; el kit es para acciones.
- Cierre: PR #38 abierto (`agent/consola/c-1` → `main`, 5 commits). La
  sesión continuó con credenciales de push y rebase sobre main @ 7d99cb7
  (PR #37 fusionado antes: solo TODO.md, sin conflictos). NO fusionar
  hasta CI verde. Capturas oficiales del escaparate (F5) después, en VM
  de laboratorio real.
- Bloqueos: ninguno.
- Estado en TASKS.md: en revisión (PR #38)

---

## 2026-10-21 · AG-4 OPS/QA · O-1 · sesión 1
- Hecho: POL-5 — `docs/OPERATIONS.md` reorganizada por capítulos, sin cambiar
  contenido: 39 secciones planas agrupadas en 8 Partes (`## Part N: …`), índice
  `## Contents` tras la introducción, secciones descendidas a h3 y sus
  subsecciones a h4 (los textos de los encabezados no cambian, así que las
  anclas usadas desde `README.md`, `docs/GUIA-INICIO.md` y `TODO.md` siguen
  funcionando). Navegación reparada de paso: un ancla interna muerta
  preexistente (`#alert-noise-control`) apunta ahora a la sección que documenta
  el informe de ruido (REP-1). Segunda mitad de O-1: esqueleto de la guía de
  suscripción WEF (`docs/AD-WEF-SUSCRIPCION.md`, español) para la futura
  sección AD del TODO (F3): arquitectura propuesta (fuentes → recolector Wecsvc
  → ForwardedEvents → ingesta NDJSON del motor), requisitos, filtro provisional
  de IDs ligado a O-2, alta por GPO, retención/RGPD, plan de pruebas de
  laboratorio y tabla de decisiones abiertas. Fila en el mapa de
  `docs/README.md` y fragmentos de `changelog.d/` para ambas entregas.
- Ficheros: `docs/OPERATIONS.md`, `docs/AD-WEF-SUSCRIPCION.md` (nuevo),
  `docs/README.md`, `changelog.d/docs-operations-chapters.md` (nuevo),
  `changelog.d/docs-ad-wef-skeleton.md` (nuevo), `TASKS.md`, `WORKLOG.md`.
  Primer commit de la rama añade además el kit de coordinación a la raíz
  (`AGENTS.md`, `TASKS.md`, `WORKLOG.md`) porque el repo aún no lo tenía y sin
  TASKS/WORKLOG no había forma de reclamar la tarea ni registrar la sesión —
  revisable por separado (es el commit 1 de 4).
- Contratos/decisiones para otros: **M-7 (AG-1)** define el contrato
  transportista→motor (formato NDJSON, identidad, cómo distinguir la fuente
  real en `ForwardedEvents`); el esqueleto no inventa campos, solo recoge
  restricciones. **O-2 (AG-4, yo)** fija la lista definitiva de IDs del filtro
  WEF; la tabla actual es provisional. El transportista propuesto vive en
  `scripts/` (ámbito AG-4) cuando toque.
- Pendiente: redactar la guía WEF en firme tras validar en Windows real
  (alta por GPO, 5985/5986, identidad de reenvío, buffering) — queda marcado
  en el propio documento y en «Decisiones abiertas». Bloqueos: sin
  credenciales de push/PR en esta sesión; el humano abre el PR desde
  `agent/ops/o-1` (entrega preparada: bundle + parches + comandos).
- Estado en TASKS.md: en revisión (PR #39)

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
- Estado en TASKS.md: en revisión (rama agent/ops/o-1; el humano abre el PR)

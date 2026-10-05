# Plan de ronda — Seguridad A (2026-10-05, ronda 8, ~19h45 Madrid)

Base: `1d98208` (mi ronda 7). Novedad al abrir: IMP-B publicó
`9f35615` (IDEA-3, playbooks de respuesta a incidentes, ~1.1k líneas de
consola: incident-playbook.ts/tsx, incident-report.ts, incidents-view).
El resto de carriles sin cambios (IMP-A `2c32013` solo plan, PUL-A
`10d7364`, PUL-B `173ac11` y SEG-B `b0eaa60` docs-only).

Tareas:

1. **Revisión funcional de IDEA-3 de IMP-B** (rama ajena sin fusionar —
   anotar, no editar): `incident-playbook.ts` (estado local validado:
   límites 40/40/80, expulsión LRU, NFKC, bidi, revalidación),
   `incident-playbook.tsx` (flujo de aplicación de plantilla, nota al
   motor no bloqueante, casillas con hora, cronología
   `datetime-local`), `incident-report.ts` (export .md/imprimible con
   plan; byte a byte igual sin plan), cambios en `incidents-view.tsx`
   y `console-commands.ts` («reglas» → «detectores»).
2. **Re-verificar mis dos hallazgos de la ronda 5** en la nueva punta
   de IMP-B (noise-view supresión flota-completa MEDIA; reports-view
   generate sin guardia BAJA) — su diff no toca esos ficheros, pero se
   comprueba contra su punta.
3. **Auditoría propia si el tiempo lo permite** (continuación del
   pendiente 2 del roadmap): `internal/fleet`, `internal/baseline`,
   `internal/lifecycle` (gestores de estado con persistencia).
4. **Obligatorio de ronda**: batería de consola en la punta de IMP-B
   (bun test/tsc/build); `-race` en paquetes Go solo si el árbol Go de
   alguna rama ajena cambia (IDEA-3 es consola-only: verificar diff Go
   vacío y documentarlo) o si corrijo código propio.

Ficheros que espero tocar: `docs/agentes/04-seguridad/`,
`changelog.d/` si algún hallazgo cayera en código ya en main, y
`internal/{fleet,baseline,lifecycle}/**` si la auditoría propia
encuentra algo que corregir.

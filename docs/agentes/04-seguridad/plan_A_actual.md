# Plan de ronda — Seguridad A (2026-10-05, ronda 3, 18h35 Madrid)

Base: `c9628d3` (mi ronda 2 recién subida) + `origin/main` sin cambios.
Releídos los seis planes: IMP-B (SIM-4/REP-1/ruido/SIM-3, consola), PUL-A
(ajustado 16h20: matriz nocturna de fuzzing, POL-12, parseEnrollLine),
PUL-B (acento zinc, pestañas del dashboard) y SEG-B (superficies por el
lado de vulnerabilidades, PR #18).

**Ajuste por colisión (regla del plan primero):** PUL-A añade en
`internal/ingest` un target de fuzz de la línea AUTH/ENROLL con extracción
de `parseEnrollLine`; su plan (16h20) es anterior a mi push de
`FuzzEnrollLine` (16h30, commit `0dbf4d3`). Su descubrimiento automático
(`git grep '^func Fuzz'`) ya encontrará el mío; yo NO toco
`internal/ingest` esta ronda y dejo la coordinación anotada en el informe.

Tareas (SEC-7, SEC-8; pendiente 2 de mi roadmap):

1. **Fuzz del fichero del registro del alta** (`internal/enroll`, lado
   `Open`): `FuzzOpenRegistry` contra ficheros manipulados — nunca pánico,
   o error sonoro o registro consistente (capas MaxTokens/MaxHosts,
   estados válidos, digests bien formados). Incluye decidir y arreglar el
   segundo hallazgo menor de mi ronda 1: `Open` permite digests de hosts
   (y de tokens) duplicados, que hoy resuelve `byDigest` por última
   entrada — un fichero que el motor debe aceptar limpio en cada arranque
   no debe admitir ambigüedad de credencial.
2. **Vigilancia de carriles**: si Implementación A sube AD-1 (`internal/ad`)
   durante la ronda, auditoría de concurrencia y límites; si no, queda
   apuntado como bloqueado para la ronda siguiente.

Ficheros que espero tocar: `internal/enroll/` (fuzz nuevo + posible arreglo
en `Open`), `docs/agentes/04-seguridad/`, `changelog.d/`. Sin solape con
los cinco planes (ninguno reclama `internal/enroll`).

# Plan de ronda — Seguridad B (ronda 7, 2026-10-05)

Identificadores del TODO que cogo (seguridad B):

1. **Recuperación de rondas 5-6 (SEC-3):** el entorno se reinició y se
   perdió el clon con los commits no publicados de las rondas 5-6
   (guardia CSV de la consola con tests, informes, roadmap). La rama se
   reconstruye desde `origin/carril/seguridad-b` (`b0eaa60`, que ya
   está en remoto y conserva las rondas 3-4) fusionando `origin/main`
   (PR #18 con la cadena de dependencias coherente); el fix se
   re-aplica con el mismo contenido y método TDD y se re-verifica.
2. **SEC-5, verificación del estado fusionado:** el PR #18 entró en
   `main` **con** el bump de `x/cellbuf` v0.0.15 que lo hacía
   compilar (la coordinación que mi ronda 6 documentó). Batería Go
   completa + govulncheck + revisión de cadena de suministro de las
   indirectas nuevas (`clipperhouse/displaywidth`,
   `clipperhouse/uax29/v2`).
3. **Observación (sin código):** playbooks de respuesta de IMP-B
   (`9f35615`, en su rama) — veredicto a nivel de commit; re-auditoría
   profunda al fusionar.

Ficheros que espero tocar: `web/console/src/lib/chart-export.ts` +
test, `web/console/src/components/console/alert-actions.tsx`,
`changelog.d/`, `docs/agentes/04-seguridad/`.

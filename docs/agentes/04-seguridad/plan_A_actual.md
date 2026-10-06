# Plan de ronda — Seguridad A (2026-10-06, ronda 17, ~09h55 Madrid)

Base: `40a454b` (mi ronda 16). Al abrir solo movió **IMP-B**
(`28d6f9e..2c47271`): tercer barrido i18n de incidentes (`0380c89`),
informe de su ronda 10 (`9d329f1`), MERGE de la rama de IMP-A hacia
su carril (`9763675`) y la página SET-1 con el formulario AD-6
(`2c47271`). IMP-A sigue en `293be1d` → mi hallazgo del hot-swap AD-6
(sin serializar) sigue SIN corregir. `origin/main` sigue `35cd866` →
el reparo del Makefile sigue sin aterrizar (tercer aviso). PUL-A
(`83e3a66`), PUL-B (`744d46a`) y SEG-B (`b670e5f`) sin cambios desde
lo auditado en la ronda 16.

Tareas:

1. **Auditoría del delta de IMP-B** (consola-only, el Go del merge es
   el de IMP-A ya auditado en ronda 16): (a) `0380c89` — barrido i18n
   de incidents-view + incident-playbook + critical-notifier +
   alert-notify (interpolación de datos dinámicos en frases, sin
   HTML libre); (b) `2c47271` — SET-1: `settings-view.tsx` (+681) y
   `settings.ts` (+243) contra el wire REAL de la API de IMP-A
   (envelope SEC-2 write-only: la contraseña NUNCA debe volver al
   cliente ni quedar en estado/URL/logs; test-connection con y sin
   credencial recién escrita; drift 409 presentado al usuario;
   secciones «sin API» honestas); (c) `settings.test.ts` y
   `i18n.test.ts` (calidad de las pruebas nuevas).
2. **Cordura del merge `9763675`**: el árbol fusionado conserva ambas
   caras (API Go de IMP-A intacta + consola de IMP-B), sin hunks
   caídos ni marcadores de conflicto residuales.
3. **Octavo aviso a IMP-B**: re-verificar mis 2 hallazgos de la
   ronda 5 en la punta (`noise-view.tsx` supresión `host: ''` que
   silencia la flota completa; `reports-view.tsx` `generate` sin
   guardia de vigencia).
4. **Convergencia con PUL-A**: sus 7 recetas console con espacios
   heredadas por IMP-B — verificar en el árbol de `2c47271` y
   replicar su pre-flight (merge-tree POR EXIT CODE + guardia de
   tabs sobre el Makefile fusionado resultante) contra su punta.
5. **Hot-swap AD-6**: sin movimiento de IMP-A → el hallazgo MEDIO de
   la ronda 16 sigue vigente (re-confirmación barata del código en
   `293be1d`); documentar espera.
6. **Baterías**: worktree desprendido en `2c47271` — bun test / tsc /
   build de consola; `-race -count=5` en ad+api del árbol fusionado
   (el Go es heredado pero la COMBINACIÓN es nueva, disciplina de
   ronda 15); fuzzing de mantenimiento: trío denso en mi árbol
   (FuzzDecode/FuzzEnrollLine=ingest, FuzzParseLine=intel).
7. Cierre: cadena CI completa en mi árbol (gofmt, vet, windows
   vet+build, staticcheck, `-race -count=1` 37 paquetes),
   `merge-tree` POR CÓDIGO DE SALIDA contra las seis referencias,
   informe, roadmap, changelog solo si hay fix mío, push, worklog
   (Task ID 9).

Proceso: plan publicado ANTES del trabajo profundo (desvío de la
ronda 16 corregido).

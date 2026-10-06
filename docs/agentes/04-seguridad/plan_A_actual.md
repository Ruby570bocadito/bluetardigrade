# Plan de ronda — Seguridad A (2026-10-06, ronda 18, ~16h15 Madrid)

Base: `4d23194` (mi ronda 17). Al abrir movieron TRES carriles:

- **IMP-A `293be1d..48b81f8`** (7 commits): (a) `6cb3fe6` quotas de
  memoria por equipo (v1.1) — código NUEVO del motor; (b) `e420315`
  doctor: validación de known-software.yaml con el parser propio;
  (c) `f2e6378` **CIERRA mi hallazgo MEDIO de la ronda 16** — el
  hot-swap AD-6 pasa a ser síncrono dentro de la escritura serializada
  del PUT, con test de regresión determinista de 8 PUTs que
  reproduce la topología de producción. SEG-B afirma auditarlo limpio en su
  ronda 18: protocolo — no confiar en el reporte, leer el código y
  reproducir.
- **PUL-B `744d46a..e2bd3aa`** (17 commits): Makefile (TABs +
  `--ignore-scripts` + `--no-save --no-package-lock`), POL-7 fase A —
  primitiva `ui/badge.tsx` con SeverityBadge/MonoTag delegando
  (`54a62c4`, código de consola NUEVO), guardia de vista sobre SET-1,
  README/docs. Convergencia declarada con mi reparo de la ronda 17.
- **SEG-B `b670e5f..7b6a562`** (10 commits): reportes y planes
  (verificar que es docs-only con diff-stat).
- IMP-B sigue `2c47271` → **noveno aviso** (mis 2 hallazgos de la
  ronda 5 + los 2 BAJA de la ronda 17: trim del password y presupuesto
  30 s vs 45 s). `main` sigue `35cd866` → **cuarto aviso** del
  Makefile (roto en solitario).

Tareas:

1. **Auditoría del delta de IMP-A** (leer código, no reportes):
   (a) hot-swap síncrono `f2e6378` — serialización REAL (mismo
   cerrojo que el commit del fichero), bookkeeping de `current`
   mono-llamador, sin conector huérfano, respuesta del PUT con el
   resultado del swap; calidad del test de 8 PUTs; (b) quotas por
   equipo `6cb3fe6` — techo de admisión, honestidad de contadores,
   que un host ruidoso no lave a los demás, sin etiquetas de host en
   métricas; (c) doctor `e420315` — parser del propio motor, fallo
   duro ante esquema inválido.
2. **Verificación dinámica del hot-swap**: el test determinista de
   IMP-A bajo `-race -count=5` en su punta (worktree desprendido) +
   PUTs concurrentes adicionales míos contra la API real si el test
   no cubre la contención entre guardado y consulta.
3. **Auditoría del delta de PUL-B**: `54a62c4` (badge tokenizada,
   colores intactos en los delegados, sin XSS nuevo ni HTML libre) y
   `256b0e0` (manifest intacto); convergencia real de su Makefile con
   el mío (TABs + ignore-scripts).
4. **SEG-B**: diff-stat para confirmar docs-only.
5. **Noveno aviso a IMP-B** (4 hallazgos en pie) y **cuarto aviso**
   Makefile→main; verificación de que mis 2 hallazgos BAJA de la
   ronda 17 siguen vigentes en `2c47271` (sin movimiento, citar).
6. **Baterías**: worktree desprendido en `48b81f8` — bun test / tsc /
   build; `-race -count=5` en los paquetes delta Go (ad, api, engine,
   doctor según toque) en la punta de IMP-A; árbol FUSIONADO con mi
   carril: `-race` de la combinación (disciplina de ronda 15);
   fuzzing de mantenimiento trío denso (FuzzDecode/FuzzEnrollLine=
   ingest, FuzzParseLine=intel) si no hay Go propio.
7. Cierre: cadena CI en mi árbol (gofmt, vet, windows vet+build,
   staticcheck, `-race -count=1` 37 paquetes), `merge-tree` POR
   CÓDIGO DE SALIDA contra las seis referencias desde mi nueva punta,
   informe, roadmap, changelog solo si hay fix mío, push, worklog
   (recrear `/home/z/my-project/worklog.md`, perdido en el reset del
   entorno; Task ID 10).

Proceso: plan publicado ANTES del trabajo profundo (patrón desde la
ronda 16). Sin tocar ficheros reservados.

# Plan de ronda — Seguridad A (2026-10-06, ronda 14, ~09h50 Madrid)

Base: `ab60e91` (mi ronda 13, primer fix del fuzzing vivo). Token del
remote rotado por el responsable (fetch verificado).
`origin/main` sigue en `35cd866`. Novedad al abrir: DOS carriles
movieron.

- **PUL-A `9ee1594`** (su ronda 11): anuncia y repara un defecto REAL
  de `main` — `63fa077` (SEC-5, 5-oct) reescribió las 63 recetas del
  Makefile con 8 espacios («missing separator» en cualquier target;
  invisible porque `ci.yml` nunca invoca `make`). Reparo mecánico
  (`49afd06`), guardia nueva `check_makefile_tabs.py` (máquina de
  estados + self-test 5 fixtures), vet cross-Windows ampliado a
  `GOOS=windows go vet ./...` en `ci.yml` (anti-drift, sustituye una
  lista explícita de 3 paquetes). Cero ficheros Go de producto.
- **SEG-B `cf8997d`**: docs-only (plan, roadmap, informe).
- Sin mover: IMP-A `bc91c7d` (mis 2 hallazgos, octava espera —
  ahora con doble confirmación SEG-A+SEG-B), IMP-B `5ecbcc4` (los 2
  míos de la ronda 5), PUL-B `24c8b08`.

Tareas:

1. **Verificación independiente del hallazgo/reparo de PUL-A**
   (protocolo del carril: no me fío del informe):
   a. `63fa077` rompió el Makefile — comprobar el diff histórico
      byte a byte (espacios vs tab) y que HOY el árbol de PUL-A tiene
      tabs en las 63 recetas.
   b. Su guardia: `--self-test` 5/5, salida 0 en el árbol reparado,
      y detección real sobre una copia corrupta (fail-before de la
      guardia misma).
   c. `ci.yml`: vet `./...` + paso de la guardia cableados; lectura
      de la desviación razonada (guardia solo en ci.yml, no en
      `make ci` — argumento autorreferencial, verificar que es sano).
2. **Obligatorio de ronda**: deltas movidos sin ficheros Go
   (verificar por stat en ambos) → `-race` no aplica; evidencia de
   la ronda 13 vigente.
3. **Mi cadena se alinea con la CI nueva**: añadir
   `GOOS=windows go vet ./...` a mi checklist de ronda (la CI lo
   exige ahora; antes solo hacía build).
4. **Mantenimiento de fuzzing** (primer paseo periódico, barato):
   60 s sobre `FuzzDecode`, `FuzzEnrollLine` y `FuzzParseLine` — la
   superficie de parseo hostil más densa, vecina del fix de la
   ronda 13. Solo si el presupuesto de la verificación 1 deja.
5. **Lectura del informe de SEG-B** (`cf8997d`, docs-only).

Cierre: checklist CI completo (con el vet windows nuevo), informe,
roadmap, changelog solo si hay fix mío; push tras `merge-tree` contra
las cinco puntas.

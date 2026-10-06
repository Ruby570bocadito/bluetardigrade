# Plan de ronda — Pulimiento A (2026-10-06 08h12 UTC, ronda 13)

- **Contexto:** quinta sesión de la jornada. La ronda 12 (delegaciones
  de SEG-B: `--ignore-scripts` implementado + fuzz nocturno
  respondido) está publicada en `origin` (`10dbca9`), push verificado
  con `git ls-remote`. «continua» del responsable autoriza esta ronda
  (cuarta ronda extra sobre RONDAS_MAXIMAS=8). `origin/main` sigue en
  `35cd866`: POL-1 sigue reservada (IMP-A `bc91c7d` sin fusionar; sus
  2 hallazgos pendientes confirmados por doble fuente SEG-A+SEG-B).

## Movimientos auditados al abrir

- SEG-A `343358a→810c882`: FIX del double-BOM de `decodeText` en
  `internal/intel` (primer crasher del fuzzing vivo; fail-before/
  pass-after) + verificación byte a byte de MI hallazgo del Makefile
  («todo cierto», guardia probada en ambas direcciones). Su fix no
  solapa con mi rama (solo un comentario mío en `intel_test.go`).
- SEG-B `cf8997d→e868094`: verificación cruzada de mi trabajo de CI
  (rondas 11-12): «LIMPIO», afirmaciones confirmadas por ejecución.
  Además: su carril heredó el Makefile roto de main y su claim es que
  el merge tomará mi versión reparada sin acción en su lado.
- IMP-B `5ecbcc4→b5e26d7` (103 ficheros, +9731): ABSORBIÓ las ramas
  de IMP-A (AD-1/AD-2, SEC-2 DPAPI) y PUL-B (CSP-nonce, a11y,
  reduced-motion) y construyó encima AD-5 (vista Directorio).
  Implicación: IMP-B es ahora el fusilador probable hacia main.

## Trabajo de esta ronda: pre-flight de fusión (guardia sobre árboles fusionados simulados)

- **Motivación:** mis observaciones abiertas (PUL-B ronda 11, SEG-B
  ronda 12) predijen comportamientos de fusión distintos. Los
  merge-tree `--name-only` solo detectan CONFLICTOS, no el contenido
  resultante. Método nuevo, determinista y barato:
  1. `git merge-tree --write-tree <mi tip> <tip ajeno>` → árbol
     fusionado simulado.
  2. `git show <árbol>:Makefile` → el Makefile que RESULTARÍA.
  3. Ejecutar `check_makefile_tabs.py` SOBRE ese fichero.
  4. Ídem `.github/workflows/ci.yml` (diff contra el mío: ¿sobrevive
     mi `--ignore-scripts`? ¿alguien toca el job consola?).
- **Resultados (ya ejecutados contra los 5 carriles):**
  - SEG-A, SEG-B, IMP-A: Makefile fusionado → guardia OK; ci.yml
    fusionado idéntico al mío.
  - SEG-B: el Makefile fusionado es IDÉNTICO al mío (diff vacío) —
    **mi observación de ronda 12 era ERRÓNEA**: sus líneas
    `check_package_lifecycle` con espacios son contenido del
    merge-base (las puso `63fa077` en main), no ediciones suyas.
    El «sin acción requerida» de SEG-B era correcto. Cierro la
    observación con corrección explícita de mi error.
  - PUL-B (y por herencia IMP-B): guardia ROJA — 7 líneas de receta
    con espacios (86-96 del fusionado): targets `console-a11y`
    (86-88) y `console-lighthouse` (93-96), exactamente los de mi
    observación de ronda 11. CONFIRMADA y ahora precisada con líneas.
  - Bonus del pre-flight: el target `console-lighthouse` de PUL-B
    instala `lighthouse@12.8.2` con npm SIN `--ignore-scripts` —
    mismo patrón cadena-de-suministro que cerré en ci.yml (ronda
    12); lo añado a la observación como decisión pendiente suya.
- **NO toco el Makefile en su nombre:** reindentar yo esas recetas en
  MI rama crearía conflicto real en la zona (sus ramas también la
  tocan) y ensuciaría autoría. Remedio documentado para PUL-B/IMP-B
  con líneas y comando reproducible.

## Fuera de alcance (sin cambios)

- POL-1/run.go: IMP-A sigue sin fusionar (y con 2 hallazgos que
  corregir antes). Docs de AD-5/`/api/stats`/CSP: territory IMP,
  documentar antes de fusión sería drift inverso (regla ronda 8).
- Sin fragmento de changelog esta ronda: no cambia nada orientado al
  repo; solo docs del carril.

## Verificación prevista

Pre-flight documentado arriba (ya ejecutado, resultados en el
informe), guardias completas del árbol (7), batería Go completa
(gofmt/build/vet/windows vet/staticcheck, `-race` 37 paquetes),
merge-tree convencional 6/6, escaneo anti-credenciales, push con
verificación `git ls-remote`.

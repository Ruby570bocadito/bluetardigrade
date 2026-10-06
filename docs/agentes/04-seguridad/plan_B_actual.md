# Plan de ronda — Seguridad B (ronda 18, verificación)

- **Instancia:** Seguridad B — décima reapertura fuera de cuota.
- **Base al abrir:** mi punta `70c7637` (ronda 17, PUBLICADA y
  verificada).
- **Delta que reabre (dos carriles a la vez):**
  - **IMP-A `60a63a3..48b81f8`** — `f2e6378` aterriza EL FIX DEL
    HOT-SWAP AD-6 (MEDIA, hallazgo de SEG-A ronda 13/16) que su
    plan `60a63a3` anunció: swap síncrono dentro de la escritura
    serializada del PUT, prueba de regresión determinista 8-PUT
    con -race fail-before/pass-after; `48b81f8` lo documenta y
    cierra la MEDIA en su carril. **Esta ronda ejecuta MI plan de
    verificación registrado en ronda 17 §4.**
  - **PUL-B `744d46a..e2bd3aa`** — publicación de sus rondas 9-15:
    restauración de TABs del Makefile (lo que 63fa077 aplanó) +
    adopción `--ignore-scripts` en los 6 installs npm de consola
    (convergencia SEG-A) + `--no-save --no-package-lock` (evita
    la mutación del manifest exacto), targets nuevos
    `console-a11y`/`console-lighthouse`. Toca mi registro de
    convergencia del Makefile → preflight con tips frescos.
  - Sin mover: IMP-B `2c47271`, PUL-A `83e3a66`, SEG-A `4d23194`,
    main `35cd866`.

Tareas:

1. **Verificación del fix hot-swap AD-6** contra los tres puntos
   de mi plan r17 §4: (a) orden de publicación == orden de commit
   (el swap debe correr DENTRO del `adWriteMu` del PUT),
   (b) bookkeeping `current` del engine tocado por un único
   llamador, (c) prueba -race con fail-before determinista y
   pass-after. Cotejar además la semántica de respuesta
   (`reload_pending` false resuelto, `last_reload_*`) y que
   OPERATIONS.md + openapi.yaml no mientan.
2. **Revisión del delta Makefile de PUL-B**: TABs, flags npm y
   targets nuevos; actualizar la receta de convergencia de mi
   registro (¿desaparece el caso silencioso l.86-96?).
3. **Pre-flight desde mi punta contra las seis refs con tips
   frescos** (IMP-A `48b81f8`, PUL-B `e2bd3aa`): guardia de tabs
   sobre el Makefile fusionado de cada par CLEAN, recuento
   `--ignore-scripts`, y recetas de conflicto actualizadas.
4. **Informe + roadmap**; actualizar el estado de la puerta
   AD-6 (verificada por SEG-B → recomendar cierre, dueño SEG-A).
   Cierre: push con la credencial del responsable (solo memoria,
   salida redactada), `ls-remote`, worklog. **Recordatorio:
   revocar el token al cerrar.**

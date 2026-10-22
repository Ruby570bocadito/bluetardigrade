# SEG — estado

## Hecho (últimas 24 h)
- Ronda 8, dos hallazgos MEDIO-BAJO corregidos en el sensor
  (yara-fuentes-capadas, 9c6f525):
  1) collect_sources leía el bundle.json y cada .yar/.yara SIN tope en
  cada load() (arranque y recarga de fingerprint cada 60 s): un
  fichero gigante donde aterriza la distribución M-3 era un slurp a
  RAM del sensor de seguridad. Fix: las dos lecturas vía read_capped
  (disciplina de la propia ronda 4 en este fichero) con
  MAX_RULE_SOURCE_BYTES = 32 MiB, el techo de MaxPackBytes del motor:
  nada que el motor distribuya se rechaza en el sensor; lo que excede
  se nombra como fallo de carga, sin slurp ni truncamiento.
  2) los fallos parciales (ficheros rechazados o que no compilan
  cuando el resto carga) se DESCARTABAN en el camino de éxito de
  load(): el contrato del propio collect_sources («reported, never
  silently skipped») no se cumplía y un pack cargado a medias era
  invisible (heartbeat con sha del 95%). LoadedRules lleva ahora
  errors y el worker los imprime en carga y recarga.
- Barrido de tema-claro (IMP-2, 8f823bf): limpio — CSS puro y clases;
  CopyBox renderiza {text} como hijos React (escapado); cero
  superficies nuevas. El resto de novedades desde 1ebed41 son docs.
- Verificación replicada del job sensor de CI: cargo test 60/60,
  clippy --all-targets -D warnings, cross-check msvc en verde. La
  propuesta «collect_sources sin tope» de la ronda 5 queda servida
  (la tomé yo: IMP-1 con pol1c, yara.rs sin solape).

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- Humano: el PAT sigue vivo desde la ronda 5 — cuarta petición de
  rotación; y verificar las runs en la UI (la API anónima no las
  expone).

## Estado: VERDE

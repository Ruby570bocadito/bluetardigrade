# SEG — estado

## Hecho (últimas 24 h)
- Ronda 11, barrido read-only de i18n-baseline (IMP-2, 4574283):
  limpio — refactor mecánico de baselineStatus a objeto de palabras
  con defaults ES (misma disciplina que enrollmentPlan/runModeText),
  todo texto React escapado, encodeURIComponent preexistente intacto,
  learnText con unidades locales. Sin superficies nuevas. El resto
  del tramo es docs y el claim nuevo.
- Apuntado para la próxima ronda: s2-yara-memoria (IMP-1, en vuelo)
  toca sensor/src/yara.rs compartiendo el LoadedRules compilado vía
  Arc — mi errors de la ronda 8 viaja con él; cuando libere, barrer
  con lente de seguridad la lectura de memoria (regiones, caps,
  atribución PID) — superficie nueva real.

## En curso
- (nada)

## Bloqueado
- (nada) — carril propio sigue en «Esperando al humano» (sec2-dpapi,
  regresión PR #28, junctions).

## Peticiones a otras zonas
- Humano: PAT vivo desde la ronda 5 — séptima petición de rotación;
  verificar las runs de la cabeza en la UI (la API anónima no las
  expone).

## Estado: VERDE

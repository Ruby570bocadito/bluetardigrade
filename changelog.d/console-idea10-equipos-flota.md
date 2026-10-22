# La vista Equipos bilingüe (IDEA-10 fase 10)

- **Equipos habla los dos idiomas de punta a punta.** El índice de equipos
  (búsqueda, filtros de estado, filtro de grupos, tarjetas de la lista con
  su meta de alertas/eventos), la página por equipo (cabecera con última
  actividad, riesgo, botones de caza e incidente, mosaicos, árbol de
  procesos, grafo, línea de tiempo y destinos de red) y la pieza de línea
  base asociada leen su texto de la sección `hosts` de los diccionarios
  ES/EN tipados. El español sale byte-idéntico de lo publicado; el inglés
  es traducción real.
- El resumen de flota, la píldora de estado, el chip de sensor
  desactualizado (C-5), la ficha «Sensor y conexión» con sus avisos de sin
  señal y de versión, y el diálogo «Añadir equipos» con sus dos pestañas
  van por las secciones `fleet` y `enroll`: asistente de token (bloqueos,
  formulario, token creado, aviso sin TLS, nota de pendientes), alta
  manual, tokens en uso, pendientes de aprobación y fila de revoca.
- Los datos del motor siguen literales: hint del alta, conflictos, errores
  de escritura, kind/os/capture del sensor, identidad, peers, nombres de
  equipo y grupos, detalles de eventos y nombres de regla. Las palabras de
  severidad del mosaico reutilizan `alerts.sevLabels`; el título del
  incidente que abre la página del equipo pasa por el diccionario.
- `runModeText` y `enrollmentPlan` (lib/fleet) y `tokenEnrollmentPlan`
  (lib/enroll) aceptan palabras opcionales; los defaults mantienen el ES
  publicado, así que sus tests de unidad no cambian. Las vistas pasan las
  del diccionario. Los centinelas de valor del filtro de grupos (NO_GROUP,
  ALL_GROUPS) no son texto visible y quedan como están.
- Pines de fase 10 en el test de paridad. Suite del console: 591 tests,
  tsc, next build en verde.

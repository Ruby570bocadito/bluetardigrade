# Validación y probador bilingües (IDEA-10 fase 8)

- **La Validación de detecciones habla los dos idiomas.** Prólogo, mosaicos
  (batería cargada, última ejecución, en curso), filtro por táctica,
  lanzamientos (completa, filtrada o selección), tendencia de la tasa de
  éxito, historial de ejecuciones, panel de progreso en vuelo, detalle por
  escenario y biblioteca con búsqueda y paginación leen su texto de los
  diccionarios ES/EN tipados. El español sale byte-idéntico de lo
  publicado; el inglés es traducción real.
- **El probador de reglas también.** Ejemplos (las etiquetas viajan por el
  diccionario ligadas por índice a los eventos-fixture, que no cambian),
  errores honestos de validación del cliente, cabeceras, botones y
  resultado. La respuesta del motor sigue viajando literal.
- Las etiquetas de resultado por escenario (detectado / sin detección /
  catálogo / error) pasan del mapa de lib/simulation al diccionario;
  RESULT_STATUS_LABEL se mantiene como ES publicado para quien lo use.
- Pines de fase 8 en el test de paridad. Suite del console: 587 tests,
  tsc, next build y batería DOM en verde.

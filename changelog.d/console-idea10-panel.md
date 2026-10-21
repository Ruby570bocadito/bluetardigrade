# Panel de operaciones bilingüe (IDEA-10 fase 6)

- **El Panel habla los dos idiomas.** El dashboard completo (pestañas,
  avisos de estado, actividad del sensor, grafo de investigación, matriz
  ATT&CK, donuts, flujo del triaje, línea de la última hora, hosts
  calientes, evolución del riesgo, rejilla semanal, telemetría reciente y
  salud del pipeline), el héroe del triaje, los mosaicos de indicadores y
  la cámara compartida de gráficas (marco ChartCard con su alternancia
  gráfico/tabla y menú de exportación, grafo de entidades, matriz ATT&CK,
  ambos heatmaps y el diagrama de flujo) leen su texto de los diccionarios
  ES/EN tipados. El español sale byte-idéntico de lo publicado; la batería
  DOM fija «Motor operativo», las pestañas, los accesos del héroe y los
  estados sin datos. El inglés es traducción real, no la fuente española.
- Los avisos del pipeline (`pipelineIssues`) dejan de construir frases en
  español dentro de la librería: la librería devuelve problemas
  estructurados (id + recuento) y la copia vive en el diccionario; el test
  de unidad comprueba la estructura y el de paridad fija las frases ES.
- Los nombres de nodo del grafo de entidades, los nombres de día de la
  rejilla semanal y las etiquetas de severidad del panel viajan ahora por
  el diccionario; `weekHourTableRows` acepta nombres de día y etiqueta de
  totales opcionales (por defecto quedan los de siempre, ES intacto).
- Disciplina de fase 6 en el test de paridad (pines ES byte-idénticos y
  traducción EN real). Suite del console: 581 tests, tsc, next build y
  batería DOM en verde.

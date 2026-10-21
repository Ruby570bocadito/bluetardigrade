# Directorio activo bilingüe (IDEA-10 fase 7)

- **La vista Directorio habla los dos idiomas.** Cabecera, prólogo,
  actualización, tira del conector (estado, sincronizaciones, recuentos
  por tipo y badge de truncado), postura (puntuación, donut por
  severidad, umbrales), tendencia, cuentas privilegiadas efectivas,
  hallazgos y el explorador del snapshot (pestañas por tipo, búsqueda,
  paginación) leen su texto de los diccionarios ES/EN tipados. El español
  sale byte-idéntico de lo publicado; el inglés es traducción real.
- El texto del motor sigue viajando literal, como declara el propio
  archivo: títulos y descripciones de hallazgos, remediaciones, avisos
  del conector, último error y los hints de estado de la API.
- `severityEntries` y `uacFlagLabels` (lib/directory) aceptan etiquetas
  opcionales; por defecto mantienen el ES publicado, así que sus tests
  de unidad no cambian. La vista pasa las etiquetas del diccionario
  (severidades del donut y flags UAC de las filas).
- Pines de fase 7 en el test de paridad. Suite del console: 585 tests,
  tsc, next build y batería DOM en verde.

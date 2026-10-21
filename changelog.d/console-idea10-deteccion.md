# Inteligencia, Supresiones y Cadenas bilingües (IDEA-10 fase 9)

- **Tres vistas del grupo Detección hablan los dos idiomas.** Inteligencia
  (mosaicos, prólogo, tabla de listas con desglose por tipo, últimas
  coincidencias), Supresiones del operador (mosaicos, prólogo, tabla con
  caducidades en vivo) y Cadenas de kill chain (mosaicos, prólogo, tarjetas
  con grafo de pasos, alternativas y avisos de pasos sin regla) leen su
  texto de los diccionarios ES/EN tipados. El español sale byte-idéntico
  de lo publicado; el inglés es traducción real.
- Los datos del motor siguen literales: nombres de listas y ficheros,
  motivos declarados por el operador, descripciones y nombres de cadenas,
  detalles de los resultados.
- `kindBreakdown` y `learnText` (lib/intel) y `scopeText` (lib/sequences)
  aceptan etiquetas y unidades opcionales; los defaults mantienen el ES
  publicado, así que sus tests de unidad no cambian. La vista pasa las
  etiquetas del diccionario.
- Pines de fase 9 en el test de paridad. Suite del console: 589 tests,
  tsc, next build y batería DOM en verde.

# SEG — estado

## Hecho (últimas 24 h)
- Ronda 6, barrido sistemático read-only (sin fix necesario):
  - consola-yara-desfase (cdfa7c2): yaraSkew bien testeado, el sha
    nunca se renderiza (solo se compara), texto siempre de los
    diccionarios i18n — sin XSS. Nota a IMP-2 (ver Peticiones).
  - M-4 / POST /api/db/query auditado a fondo: guardSQL (scanner de
    estados de quote correcto, verbos bloqueados también dentro de
    comentarios, sin forma de reconstituir un verbo partido — SQLite
    ve el mismo whitespace que el scanner), caps/clamps en el handler
    (H-004 ya servida), auditoría de cada intento, y QueryRO en
    mode=ro + query_only(1) al nivel VFS con test propio de la última
    línea de defensa. Tres capas independientes: SIN hallazgos.
- CI: sin runs visibles por API anónima ni para 2ed8026 ni para la
  cabeza — verificar en la UI (queda para el humano/DIR, no bloquea).
- Ronda 5 publicada: yara-lectura-capada en main (2ed8026).

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- IMP-2: useYaraStatus() vive dentro de SensorCard (por-host): con N
  sensores son N polls paralelos de GET /api/yara cada 60 s, cada uno
  con su walk del directorio de reglas — carga que crece con la flota.
  Subir el poll al nivel de la vista y pasar el status como prop (o
  contexto). Menor: un fallo de fetch mantiene el status viejo en
  silencio.

## Propuestas para el roadmap
- El sensor lee las reglas sin tope (collect_sources, fs::read): la
  disciplina read_capped ya existe en su propio scan — para IMP-1,
  sin prisa (directorio local, gated por fingerprint).
- sec2-dpapi y la regresión del PR #28 siguen en el carril «Esperando
  al humano» (Windows real).

## Estado: VERDE

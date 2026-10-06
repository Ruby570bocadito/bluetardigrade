# Plan de ronda — Implementación B (2026-10-06, ronda 7)

- Tarea del TODO: **AD-5 «Directorio activo»** sobre la API AD-1/AD-2 que IMP-A
  publicó en su rama (`f8853eb`): estado del conector, puntuación de postura con
  donut de hallazgos por severidad, lista de hallazgos con objetos y remediación,
  cobertura (equipos del dominio frente a equipos con sensor, hallazgo
  `computers_without_sensor`), cuentas privilegiadas efectivas (hallazgo
  `privileged_effective_members`), historial de la puntuación y explorador de
  objetos (usuarios/grupos/equipos/UOs, paginado y búsqueda). 501 → «no armada»
  con el hint del motor; `ready:false` → «aún sin análisis»; nada inventado.
- También: **SET-3 cierre** — el mismo merge trajo los campos que faltaban en
  `/api/stats` (versión, latencias p50/p95/max, tamaño del almacén, caducidad de
  los dos certificados): filas nuevas en la vista «Estado» y nota al pie reducida
  a lo que sigue sin publicarse (último informe programado).
- Ficheros: nuevos `web/console/src/lib/directory.ts` (+test) y
  `directory-view.tsx`; cambios en `console-types.ts` (campos SET-3),
  `platform-status.ts` (+test), `platform-status.tsx`, `dashboard.tsx` (union
  ConsoleView), `shell.tsx` (icono + render), `console-commands.ts` (destino),
  `keyboard-nav.ts` (+test: tecla `d`), diccionarios ES/EN (chrome/destinos).
- Por qué: primera prioridad del roadmap_B — IMP-A ya empujó su ronda de AD-1
  (verificado con fetch). AD-6 sigue bloqueada: no existe API de ajustes (IMP-A
  la deja para su ronda siguiente); una pantalla que no puede persistir sería
  decorativa. Sin solape verificado: SEG-B no toca `web/console/src` ahora
  mismo; PUL-B mantiene globals.css/layout/entity-graph, que no toco.
- Diseño: la vista se llama «Directorio» y replica el contrato de honestidad del
  carril (estado del conector arriba, postura solo cuando `ready`, páginas de
  objetos desde el paginado real del motor, el texto que envía el motor —
  títulos, descripciones y remediaciones de los hallazgos, ya en español — no se
  traduce ni se reescribe). El árbol de grupos con edges exactos no es posible
  hoy: la API no expone las aristas de membresía; se muestran los caminos
  efectivos que el motor ya calcula y se declara el límite.

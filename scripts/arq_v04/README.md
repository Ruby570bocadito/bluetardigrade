# arq_v04 — generador versionado del documento de arquitectura

Este directorio es la precondición que la acta 13h03 y las rondas de Pulimiento
(17h25, 17h55) exigían antes de intentar una v0.4: el pipeline de generación
vive versionado en el árbol, de modo que la revisión es reproducible y la
siguiente versión no dependa de herramientas desaparecidas.

El nombre del directorio (`arq_v04`) registra dónde nació el pipeline (v0.4);
construye la revisión vigente de la serie — hoy la **v0.8**. Renombrarlo por
revisión rompería las referencias cruzadas de actas y READMEs sin añadir nada.

## Qué produce

`docs/arquitectura-tecnica-v0.8.pdf` (portada + índice + 8 capítulos), a partir de:

| Pieza | Fuente versionada | Herramienta |
|---|---|---|
| Cuerpo (TOC + capítulos) | `scripts/arq_v04/generator.py` | python3 + reportlab (`TocDocTemplate` + `multiBuild`, TOC automático con enlaces) |
| Portada | `docs/assets/src/cover-v0.8.html` | node + playwright (`page.pdf`, vector, 794x1123 px A4 @96dpi) |
| Fusión + metadata | `scripts/arq_v04/merge_and_meta.py` | python3 + pypdf (portada como página 0, normalizada a A4) |
| Diagrama de arquitectura | `docs/assets/src/diagram_arquitectura.html` | `render_diagram.mjs` (captura de `.canvas` a 2x, procedimiento de `docs/assets/README.md`) |

## Cómo ejecutar

```bash
bash scripts/arq_v04/build.sh
```

Requisitos: `python3` con `reportlab`, `pypdf` y `pillow`; `node` con
`playwright` (Chromium). Sin red salvo para las Google Fonts de la portada
(la caída de red degrada la fuente, no rompe la generación).

## Decisiones de diseño registradas

- **Identidad visual de la serie**: paleta de la casa (`#298bbc` acento,
  `#344a55` estructural, `#1e2021` texto) heredada de cover-v0.1..v0.3 y de
  los diagramas de `docs/assets/src/`. Se evaluó regenerar la paleta con la
  herramienta cascade y se decidió continuidad de serie: una v0.4 debe ser
  reconocible como la misma serie documental que la v0.1.
- **Numeración**: portada e índice no llevan número de capítulo; el cuerpo
  empieza en 1. El índice es auto-generado (`multiBuild`), nunca numerado a mano.
- **Paginación**: el índice muestra folio romano (`i`); el cuerpo reinicia en
  arábigo (1, 2, ...), igual que la v0.3.
- **Honestidad de cobertura**: los contadores (guard 15 rutas/36 campos/74
  referencias, marcador canónico del Director 22h46 — 20/20, 7/17 con A3
  aterrizado — con los conteos de carriles citados como numeración propia,
  conteos E2E) citan su procedencia (guard, actas del Director y de seguridad)
  en el propio texto.
- **Figuras**: se reutilizan los assets versionados de `docs/assets/`; el
  diagrama de arquitectura se regeneró desde su fuente HTML con la CAPA 4
  sincronizada a las salidas reales (webhook, notificaciones C2, SIEM nativo,
  respuesta activa C3, consola, API+forense); la v0.8 añadió las capturas reales
  de la vista de respuesta activa (olas `a3b8bd8`/`624d8ba`, Figuras 3 y 4 — el
  tracer pasó a Figura 5) y absorbió la Figura 2 recapturada sobre el árbol
  vigente por la ronda hermana 20h05_B (`ca51b95`), así como la precisión O4 del
  export (acta 02-B 20h20) y la ratificación en fuente del esquema (acta 20h15_B).

# docs/ — documentación del proyecto

Documentación del usuario y del operador. El registro histórico de rondas de
desarrollo y los informes de proceso se archivaron fuera del árbol público en
la ronda de renombrado a **bluetardigrade** (2026-10-01); el historial de git
conserva la trazabilidad completa.

## Mapa

| Ruta | Contenido |
|------|-----------|
| [INVESTIGACION-CLI-Y-TRIAJE.md](INVESTIGACION-CLI-Y-TRIAJE.md) | Búsqueda CLI por ID y términos, accesos de triaje del dashboard, navegación y regresiones |
| [DETECCION-Y-EVIDENCIA.md](DETECCION-Y-EVIDENCIA.md) | Nuevas alarmas de ficheros, correcciones de contexto/YAML/forense, exportación y pruebas |
| [GUIA-INICIO.md](GUIA-INICIO.md) | Arranque y operación en español: primera instalación, CLI, consola, histórico y resolución de problemas |
| [PALETA-Y-PRUEBAS-NAVEGADOR.md](PALETA-Y-PRUEBAS-NAVEGADOR.md) | Paleta de comandos de la consola: foco modal, proteccion de atajos y pruebas Chromium de escritorio/movil |
| [OPERATIONS.md](OPERATIONS.md) | Guía de operación (inglés): instalación (Windows, Docker, fuente), referencia de flags y variables de entorno, API HTTP, Prometheus, almacenamiento, auth de ingest con rotación, sinks SIEM, notificaciones, supresiones, triaje, riesgo, beaconing, respuesta activa, contenido de detección, CLI y CI/bench |
| [ROADMAP.md](ROADMAP.md) | Direccion del producto: entregas proximas por horizontal (deteccion, forense, sensor, consola) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitectura del sistema (inglés): diagrama, contrato del esquema de eventos, inventario de características y árbol del repositorio |
| [false-positive-control.md](false-positive-control.md) | Guía de control de ruido: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso |
| [api/openapi.yaml](api/openapi.yaml) | Contrato OpenAPI de la API del motor (mantenido en sincronía por el guard de CI) |
| [arquitectura-tecnica-v0.11.pdf](arquitectura-tecnica-v0.11.pdf) | Documento técnico de arquitectura, revisión vigente (26 páginas, español) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes en `assets/src/` |
| `assets/src/` | Fuentes de capturas y portadas + utilidades de regeneración (Playwright, assemble_gif.py) |

## Documento de arquitectura

`arquitectura-tecnica-v0.11.pdf` es la revisión vigente. Se produce con el
pipeline versionado del árbol (`scripts/arq_v04/`: cuerpo ReportLab + portada
Playwright + fusión pypdf; el nombre del directorio registra dónde nació el
pipeline, no la revisión que produce), así que cada revisión es un comando
reproducible en lugar de una edición manual.

Las revisiones anteriores (v0.1–v0.10) se movieron a los assets de GitHub
Releases para mantener el repositorio ligero. El contenido que aportaban está
supersedido por la v0.11 y por `ARCHITECTURE.md`.

Para generar la siguiente revisión: copia el cuerpo del pipeline con un nuevo
número de versión, actualiza portada y datos, y ejecuta
`scripts/arq_v04/build.sh` (requisitos en su cabecera).

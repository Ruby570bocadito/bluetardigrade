# docs/ — documentación del proyecto

| Ruta | Contenido |
|------|-----------|
| `arquitectura-tecnica-v0.5.pdf` | Documento de arquitectura v0.5 (21 páginas; **revisión vigente**): producida por el pipeline versionado `scripts/arq_v04/`; amplía la v0.4 con la superficie de lectura de C3 (`GET /api/respond/state`, `GET /api/respond/audit` y la vista de consola), guard OpenAPI 15 rutas/36 campos/74 referencias, marcador 33/33 y roadmap 13/17 con la catorceava propuesta, con procedencia citada |
| `arquitectura-tecnica-v0.4.pdf` | Documento de arquitectura v0.4 (20 páginas; conservado como referencia histórica — la v0.5 lo supersede; fue la primera revisión producida por el pipeline versionado) |
| `arquitectura-tecnica-v0.3.pdf` | Documento de arquitectura v0.3 (19 páginas; conservado como referencia histórica — la v0.4 lo supersede) |
| `arquitectura-tecnica-v0.2.pdf` | Documento de arquitectura v0.2 (19 páginas; conservado como referencia histórica) |
| `arquitectura-tecnica-v0.1.pdf` | Documento de arquitectura v0.1 (diseño original de septiembre 2026, 15 páginas; conservado como referencia histórica del diseño previo a la implementación) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes de trabajo en `assets/src/` |
| `false-positive-control.md` | Guía de operación del canal de salida: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso del pipeline |
| `agentes/` | Informes de ronda del sistema de agentes (registro histórico de auditoría y coordinación) |
| `agentes/GUIA-VERIFICACION.md` | Estándar obligatorio de verificación por conteos/bytes en las rondas (artefactos del canal de display y del editor, recetas y árbol de decisión) |

## Estado del documento de arquitectura

`arquitectura-tecnica-v0.5.pdf` es la revisión vigente, producida por el pipeline
versionado del árbol (`scripts/arq_v04/`: cuerpo ReportLab + portada Playwright +
fusión pypdf; ver su README — el nombre del directorio registra dónde nació el
pipeline, no la revisión que produce). Describe el sistema tal como está
implementado y verificado a su generación: hereda de la v0.4 las **notificaciones
externas C2** (Slack, Telegram, email STARTTLS con colas acotadas y secretos por
entorno; `16aef1a`), los **sumideros SIEM nativos** (Elasticsearch Bulk API y
Splunk HEC con spools acotados, saneado de URL de la clase #30 y contrato 4xx
permanente/transitorio; `f89d4f3` + `2bc7391`) y la **respuesta activa C3**
(`POST /api/respond/kill` con triple capa `-allow-kill` + token + auditoría JSONL
append-only; `f7428ff`), y añade la **superficie de lectura de C3** (acta de
implementaciones 18h20; `cb33da6`): `GET /api/respond/state` y
`GET /api/respond/audit` con el contrato de 404 real extendido a las lecturas, y
la vista "Respuesta activa" de la consola, solo lectura por diseño (R8). El guard
OpenAPI certifica 15 rutas / 36 campos / 74 referencias con self-test; el marcador
va 33/33 cerrados, 0 vivos, y el roadmap 13/17 certificado con la catorceava
(consola C3) propuesta a la espera de certificación del Director. Los contadores
del documento citan su fuente (guard, actas, bench) para que envejezcan con
procedencia y no en silencio.

`arquitectura-tecnica-v0.1.pdf` se conserva como **documento de visión** del diseño
original: útil para trazabilidad de decisiones, pero desactualizado en stack de consola
(planificaba React + Vite + Zustand), API del motor (planificaba Gin y OpenAPI generado)
y operadores (anunciaba `between`, no implementado). `arquitectura-tecnica-v0.2.pdf` se
conserva como la revisión que primero describió el estado implementado. La
`arquitectura-tecnica-v0.3.pdf` se conserva como la revisión de la nota de cobertura
honesta — su limitación conocida (C2/SIEM/C3 descritos solo como futuro o ausentes)
quedó cubierta por la v0.4. La `arquitectura-tecnica-v0.4.pdf` se conserva como la
primera revisión del pipeline versionado y la que documentó de primera mano C2, SIEM
nativo y C3; su limitación conocida (números del guard a 13 rutas, marcador 32/32,
superficie de lectura de C3 aún no cubierta) queda cubierta por la v0.5. Lo que la
v0.5 sigue declarando como futuro, sin presentarlo como capacidad: YARA,
gRPC/protobuf, filaments Python y eBPF en Linux (fases 2-4 del roadmap). Las decisiones
de diseño vigentes viven en la v0.5 del PDF, en el README y en los informes de
`agentes/`; el directorio de ADRs sigue sin existir como tal. Para regenerar o
evolucionar el documento: `bash scripts/arq_v04/build.sh` (requisitos y decisiones en
[`scripts/arq_v04/README.md`](../scripts/arq_v04/README.md)).

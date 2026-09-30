# docs/ — documentación del proyecto

| Ruta | Contenido |
|------|-----------|
| `arquitectura-tecnica-v0.4.pdf` | Documento de arquitectura v0.4 (20 páginas; **revisión vigente**): primera revisión producida por el pipeline versionado `scripts/arq_v04/`; incorpora notificaciones externas C2, sumideros SIEM nativos, respuesta activa C3, `website/`, guard OpenAPI 13 rutas/36 campos y roadmap 13/17 con procedencia citada |
| `arquitectura-tecnica-v0.3.pdf` | Documento de arquitectura v0.3 (19 páginas; conservado como referencia histórica — la v0.4 lo supersede) |
| `arquitectura-tecnica-v0.2.pdf` | Documento de arquitectura v0.2 (19 páginas; conservado como referencia histórica) |
| `arquitectura-tecnica-v0.1.pdf` | Documento de arquitectura v0.1 (diseño original de septiembre 2026, 15 páginas; conservado como referencia histórica del diseño previo a la implementación) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes de trabajo en `assets/src/` |
| `false-positive-control.md` | Guía de operación del canal de salida: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso del pipeline |
| `agentes/` | Informes de ronda del sistema de agentes (registro histórico de auditoría y coordinación) |
| `agentes/GUIA-VERIFICACION.md` | Estándar obligatorio de verificación por conteos/bytes en las rondas (artefactos del canal de display y del editor, recetas y árbol de decisión) |

## Estado del documento de arquitectura

`arquitectura-tecnica-v0.4.pdf` es la revisión vigente y la **primera producida
por un pipeline de generación versionado en el árbol** (`scripts/arq_v04/`:
cuerpo ReportLab + portada Playwright + fusión pypdf; ver su README). Describe
el sistema tal como está implementado y verificado a su generación: todo lo que
la v0.3 llevaba en nota de cobertura aterriza ahora en el documento de primera
mano — las **notificaciones externas C2** (Slack, Telegram, email STARTTLS con
colas acotadas y secretos por entorno; `16aef1a`), los **sumideros SIEM
nativos** (Elasticsearch Bulk API y Splunk HEC con spools acotados, saneado de
URL de la clase #30 y contrato 4xx permanente/transitorio; `f89d4f3` + `2bc7391`)
y la **respuesta activa C3** (`POST /api/respond/kill` con triple capa
`-allow-kill` + token + auditoría JSONL append-only; `f7428ff`), más la
landing `website/` y el guard OpenAPI en 13 rutas / 36 campos con self-test.
El roadmap lleva columna de estado con procedencia citada (13/17 líneas
cerradas según actas del Director 17h45 y de seguridad 17h58; marcador
32/32, 0 vivos). Los contadores del documento citan su fuente (guard, actas,
bench) para que envejezcan con procedencia y no en silencio.

`arquitectura-tecnica-v0.1.pdf` se conserva como **documento de visión** del diseño
original: útil para trazabilidad de decisiones, pero desactualizado en stack de consola
(planificaba React + Vite + Zustand), API del motor (planificaba Gin y OpenAPI generado)
y operadores (anunciaba `between`, no implementado). `arquitectura-tecnica-v0.2.pdf` se
conserva como la revisión que primero describió el estado implementado. La
`arquitectura-tecnica-v0.3.pdf` se conserva como la revisión de la nota de cobertura
honesta — su limitación conocida (C2/SIEM/C3 descritos solo como futuro o ausentes)
queda cubierta por la v0.4. Lo que la v0.4 sigue declarando como futuro, sin
presentarlo como capacidad: YARA, gRPC/protobuf, filaments Python y eBPF en
Linux (fases 2-4 del roadmap). Las decisiones de diseño vigentes viven
en la v0.4 del PDF, en el README y en los informes de `agentes/`; el directorio de ADRs
sigue sin existir como tal. Para regenerar o evolucionar el documento:
`bash scripts/arq_v04/build.sh` (requisitos y decisiones en
[`scripts/arq_v04/README.md`](../scripts/arq_v04/README.md)).

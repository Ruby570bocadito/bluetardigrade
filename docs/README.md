# docs/ — documentación del proyecto

| Ruta | Contenido |
|------|-----------|
| `arquitectura-tecnica-v0.6.pdf` | Documento de arquitectura v0.6 (22 páginas; **revisión vigente**): producida por el pipeline versionado `scripts/arq_v04/`; amplía la v0.5 con el mecanismo dual de ejecución de C3 (pidfd con fallback declarado en Linux — `mechanism` + `fallback_reason` con el errno —, handle en Windows), la certificación conductual permanente del cierre de C3 en CI (smoke 29/29 sobre motor Windows nativo), el estado del marcador con #34/#35 y F1/F2 en tránsito, y la Figura 2 regenerada con el panel de hosts calientes completo (staleness de navegación declarado en el pie de figura), con procedencia citada |
| `arquitectura-tecnica-v0.5.pdf` | Documento de arquitectura v0.5 (21 páginas; conservado como referencia histórica — la v0.6 lo supersede; amplió la v0.4 con la superficie de lectura de C3 y el guard a 15 rutas/36 campos/74 referencias) |
| `arquitectura-tecnica-v0.4.pdf` | Documento de arquitectura v0.4 (20 páginas; conservado como referencia histórica — la v0.5 lo supersede; fue la primera revisión producida por el pipeline versionado) |
| `arquitectura-tecnica-v0.3.pdf` | Documento de arquitectura v0.3 (19 páginas; conservado como referencia histórica — la v0.4 lo supersede) |
| `arquitectura-tecnica-v0.2.pdf` | Documento de arquitectura v0.2 (19 páginas; conservado como referencia histórica) |
| `arquitectura-tecnica-v0.1.pdf` | Documento de arquitectura v0.1 (diseño original de septiembre 2026, 15 páginas; conservado como referencia histórica del diseño previo a la implementación) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes de trabajo en `assets/src/` |
| `false-positive-control.md` | Guía de operación del canal de salida: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso del pipeline |
| `agentes/` | Informes de ronda del sistema de agentes (registro histórico de auditoría y coordinación) |
| `agentes/GUIA-VERIFICACION.md` | Estándar obligatorio de verificación por conteos/bytes en las rondas (artefactos del canal de display y del editor, recetas y árbol de decisión) |

## Estado del documento de arquitectura

`arquitectura-tecnica-v0.6.pdf` es la revisión vigente, producida por el pipeline
versionado del árbol (`scripts/arq_v04/`: cuerpo ReportLab + portada Playwright +
fusión pypdf; ver su README — el nombre del directorio registra dónde nació el
pipeline, no la revisión que produce). Describe el sistema tal como está
implementado y verificado a su generación: hereda de la v0.5 las **notificaciones
externas C2** (Slack, Telegram, email STARTTLS con colas acotadas y secretos por
entorno; `16aef1a`), los **sumideros SIEM nativos** (Elasticsearch Bulk API y
Splunk HEC con spools acotados, saneado de URL de la clase #30 y contrato 4xx
permanente/transitorio; `f89d4f3` + `2bc7391`), la **respuesta activa C3**
(`POST /api/respond/kill` con triple capa `-allow-kill` + token + auditoría JSONL
append-only; `f7428ff`) y su **superficie de lectura** (`GET /api/respond/state`,
`GET /api/respond/audit`; `cb33da6`), y añade el **mecanismo dual de ejecución**
(pidfd con fallback declarado en Linux — `mechanism` + `fallback_reason` con el
errno, incluso en denegaciones — y handle en Windows) con su **certificación
conductual permanente en CI** (job engine-windows: smoke 29/29 sobre motor nativo
con proceso real muerto, cebo csrss.exe sobreviviente y 404 real del desarmado;
`d065f4c`, ratificado por doble cross-review en `02c5c55`), además de la **Figura 2
regenerada** desde el stack real con el panel de hosts calientes completo (su
navegación procede del árbol `091986c` y lo declara en el pie de figura; ola
`949ef9d`). El guard OpenAPI certifica 15 rutas / 36 campos / 74 referencias con
self-test; el marcador va 33/33 cerrados, 0 vivos, con F1 aterrizada por 02-B
pendiente de certificación del cross-review, F2 con parche listo en el carril 02-A
y #34/#35 propuestos, y el roadmap 13/17 certificado con la catorceava (consola C3)
propuesta a la espera de certificación del Director. Los contadores del documento
citan su fuente (guard, actas, bench) para que envejezcan con procedencia y no en
silencio.

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
superficie de lectura de C3 aún no cubierta) queda cubierta por la v0.5. La
`arquitectura-tecnica-v0.5.pdf` se conserva como la revisión de la superficie de
lectura de C3; su limitación conocida (mecanismo dual de ejecución y certificación
Windows de CI aún no descritos, Figura 2 con la captura previa al panel completo)
queda cubierta por la v0.6. Lo que la v0.6 sigue declarando como futuro, sin
presentarlo como capacidad: YARA,
gRPC/protobuf, filaments Python y eBPF en Linux (fases 2-4 del roadmap). Las decisiones
de diseño vigentes viven en la v0.6 del PDF, en el README y en los informes de
`agentes/`; el directorio de ADRs sigue sin existir como tal. Para regenerar o
evolucionar el documento: `bash scripts/arq_v04/build.sh` (requisitos y decisiones en
[`scripts/arq_v04/README.md`](../scripts/arq_v04/README.md)).

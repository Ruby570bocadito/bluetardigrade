# docs/ — documentación del proyecto

| Ruta | Contenido |
|------|-----------|
| `arquitectura-tecnica-v0.3.pdf` | Documento de arquitectura v0.3 (19 páginas; refleja el estado implementado **anterior** a las notificaciones externas C2 y a los sumideros SIEM nativos — nota de cobertura en la sección de estado) |
| `arquitectura-tecnica-v0.2.pdf` | Documento de arquitectura v0.2 (19 páginas; conservado como referencia histórica — la v0.3 lo supersede) |
| `arquitectura-tecnica-v0.1.pdf` | Documento de arquitectura v0.1 (diseño original de septiembre 2026, 15 páginas; conservado como referencia histórica del diseño previo a la implementación) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes de trabajo en `assets/src/` |
| `false-positive-control.md` | Guía de operación del canal de salida: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso del pipeline |
| `agentes/` | Informes de ronda del sistema de agentes (registro histórico de auditoría y coordinación) |
| `agentes/GUIA-VERIFICACION.md` | Estándar obligatorio de verificación por conteos/bytes en las rondas (artefactos del canal de display y del editor, recetas y árbol de decisión) |

## Estado del documento de arquitectura

`arquitectura-tecnica-v0.3.pdf` es la revisión vigente: describe el
sistema **tal como está implementado y verificado en su revisión** — pipeline con ingest autenticada
(AUTH + rotación de token), reglas con 17 operadores (11 + familia i*) y recarga en caliente con los
techos de la casa en el loader (4 MiB por fichero, pre-scan de anidación, 2.048 reglas habilitadas),
semántica de folding Unicode única en toda la familia i* y en el fallback regex (?i), correlador de
kill-chains, riesgo por host (A1), umbrales volumétricos (A2), beaconing (A3), importación
Sigma (A4), store SQLite opt-in, webhook, export JSONL/CSV, guard OpenAPI (12 rutas / 30 campos
en su revisión), bench nocturno a dos pasadas (anillos frente a store, sobrecarga registrada como
dato) y la consola Next.js 16 con su hub Bun/socket.io. La correspondencia
diseño-implementación se declara capítulo a capítulo y el roadmap lleva columna de estado
real (11/17 líneas cerradas a su generación; la certificación del Director 17h45 suma C2 notificaciones y C3 respuesta activa iteración 1 — el pase a 12/17 de los sinks SIEM queda a la puerta del cierre de F2/O1 de su cross-review).

**Nota de cobertura (honestidad por diseño, añadida tras detectar la sobreafirmación):** dos
capacidades importantes aterrizaron DESPUÉS de la generación de la v0.3 y el documento no las
contiene — las **notificaciones externas C2** (Slack, Telegram y email vía `-notify`, con contadores
por canal en stats/metrics; `16aef1a`) y los **sumideros SIEM nativos** (Elasticsearch Bulk API y
Splunk HEC con sus familias `sf_elastic_*` / `sf_splunk_*`; `f89d4f3`); el spec OpenAPI pasó
además de 30 a 35 campos. En la v0.3 los conectores Elastic/Splunk aparecen únicamente como
intención de diseño futura — no tomar esa mención por una descripción del aterrizaje. Mientras
llega la v0.4, ambas capacidades están documentadas de primera mano en el README (secciones
«SIEM sinks» y «External notifications»), en `docs/api/openapi.yaml` (en crecimiento desde su
revisión: 30 → 35 campos con los sumideros SIEM, 13 rutas con la respuesta activa C3, guard CI
en sincronía en cada aterrizaje) y en [`false-positive-control.md`](false-positive-control.md).

`arquitectura-tecnica-v0.1.pdf` se conserva como **documento de visión** del diseño
original: útil para trazabilidad de decisiones, pero desactualizado en stack de consola
(planificaba React + Vite + Zustand), API del motor (planificaba Gin y OpenAPI generado)
y operadores (anunciaba `between`, no implementado). `arquitectura-tecnica-v0.2.pdf` se
conserva como la revisión que primero describió el estado implementado; la v0.3 añade los
techos del loader de reglas y la auditoría horizontal de la familia i* (d2d557a), el bench
nocturno a dos pasadas y su delta de store (f205a01) y sube el roadmap a 9/17 (scoreboard
oficial del Director 13h05, corregido en la revisión misma). Lo que
la v0.3 sigue declarando como futuro, sin presentarlo como capacidad: YARA, gRPC/protobuf,
filaments Python y eBPF en Linux (fases 2-4 del roadmap) — más los conectores Elastic/Splunk,
que ya no son futuro: los sumideros SIEM nativos aterrizaron (f89d4f3) y entran en la próxima
revisión v0.4. Las decisiones de diseño vigentes viven
en la v0.3 del PDF, en el README y en los informes de `agentes/`; el directorio de ADRs
sigue sin existir como tal.

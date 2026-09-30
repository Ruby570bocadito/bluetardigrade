# docs/ — documentación del proyecto

| Ruta | Contenido |
|------|-----------|
| `arquitectura-tecnica-v0.3.pdf` | Documento de arquitectura v0.3 (19 páginas; refleja el estado implementado y verificado del repositorio) |
| `arquitectura-tecnica-v0.2.pdf` | Documento de arquitectura v0.2 (19 páginas; conservado como referencia histórica — la v0.3 lo supersede) |
| `arquitectura-tecnica-v0.1.pdf` | Documento de arquitectura v0.1 (diseño original de septiembre 2026, 15 páginas; conservado como referencia histórica del diseño previo a la implementación) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes de trabajo en `assets/src/` |
| `false-positive-control.md` | Guía de operación del canal de salida: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso del pipeline |
| `agentes/` | Informes de ronda del sistema de agentes (registro histórico de auditoría y coordinación) |
| `agentes/GUIA-VERIFICACION.md` | Estándar obligatorio de verificación por conteos/bytes en las rondas (artefactos del canal de display y del editor, recetas y árbol de decisión) |

## Estado del documento de arquitectura

`arquitectura-tecnica-v0.3.pdf` es la revisión vigente: describe el
sistema **tal como está implementado y verificado** — pipeline con ingest autenticada
(AUTH + rotación de token), reglas con 17 operadores (11 + familia i*) y recarga en caliente con los
techos de la casa en el loader (4 MiB por fichero, pre-scan de anidación, 2.048 reglas habilitadas),
semántica de folding Unicode única en toda la familia i* y en el fallback regex (?i), correlador de
kill-chains, riesgo por host (A1), umbrales volumétricos (A2), beaconing (A3), importación
Sigma (A4), store SQLite opt-in, webhook, export JSONL/CSV, guard OpenAPI (12 rutas / 29
campos), bench nocturno a dos pasadas (anillos frente a store, sobrecarga registrada como
dato) y la consola Next.js 16 con su hub Bun/socket.io. La correspondencia
diseño-implementación se declara capítulo a capítulo y el roadmap lleva columna de estado
real (9/17 líneas cerradas, scoreboard del Director 13h05).

`arquitectura-tecnica-v0.1.pdf` se conserva como **documento de visión** del diseño
original: útil para trazabilidad de decisiones, pero desactualizado en stack de consola
(planificaba React + Vite + Zustand), API del motor (planificaba Gin y OpenAPI generado)
y operadores (anunciaba `between`, no implementado). `arquitectura-tecnica-v0.2.pdf` se
conserva como la revisión que primero describió el estado implementado; la v0.3 añade los
techos del loader de reglas y la auditoría horizontal de la familia i* (d2d557a), el bench
nocturno a dos pasadas y su delta de store (f205a01) y sube el roadmap a 9/17 (scoreboard
oficial del Director 13h05, corregido en la revisión misma). Lo único que
la v0.3 sigue declarando como futuro, sin presentarlo como capacidad: YARA, gRPC/protobuf,
filaments Python y eBPF en Linux (fases 2-4 del roadmap). Las decisiones de diseño vigentes viven
en la v0.3 del PDF, en el README y en los informes de `agentes/`; el directorio de ADRs
sigue sin existir como tal.

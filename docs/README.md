# docs/ — documentación del proyecto

| Ruta | Contenido |
|------|-----------|
| `arquitectura-tecnica-v0.2.pdf` | Documento de arquitectura v0.2 (19 páginas; refleja el estado implementado y verificado del repositorio) |
| `arquitectura-tecnica-v0.1.pdf` | Documento de arquitectura v0.1 (diseño original de septiembre 2026, 15 páginas; conservado como referencia histórica del diseño previo a la implementación) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes de trabajo en `assets/src/` |
| `false-positive-control.md` | Guía de operación del canal de salida: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso del pipeline |
| `agentes/` | Informes de ronda del sistema de agentes (registro histórico de auditoría y coordinación) |
| `agentes/GUIA-VERIFICACION.md` | Estándar obligatorio de verificación por conteos/bytes en las rondas (artefactos del canal de display y del editor, recetas y árbol de decisión) |

## Estado del documento de arquitectura

`arquitectura-tecnica-v0.2.pdf` es la revisión prometida en esta misma página: describe el
sistema **tal como está implementado y verificado** — pipeline con ingest autenticada
(AUTH + rotación de token), reglas con 17 operadores (11 + familia i*) y recarga en caliente, correlador de
kill-chains, riesgo por host (A1), umbrales volumétricos (A2), beaconing (A3), importación
Sigma (A4), store SQLite opt-in, webhook, export JSONL/CSV, guard OpenAPI (12 rutas / 29
campos) y la consola Next.js 16 con su hub Bun/socket.io. La correspondencia
diseño-implementación se declara capítulo a capítulo y el roadmap lleva columna de estado
real (7/17 líneas cerradas).

`arquitectura-tecnica-v0.1.pdf` se conserva como **documento de visión** del diseño
original: útil para trazabilidad de decisiones, pero desactualizado en stack de consola
(planificaba React + Vite + Zustand), API del motor (planificaba Gin y OpenAPI generado)
y operadores (anunciaba `between`, no implementado). Lo único que la v0.2 sigue
declarando como futuro, sin presentarlo como capacidad: YARA, gRPC/protobuf, filaments
Python y eBPF en Linux (fases 2-4 del roadmap). Las decisiones de diseño vigentes viven
en la v0.2 del PDF, en el README y en los informes de `agentes/`; el directorio de ADRs
sigue sin existir como tal.

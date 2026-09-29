# docs/ — documentación del proyecto

| Ruta | Contenido |
|------|-----------|
| `arquitectura-tecnica-v0.1.pdf` | Documento de arquitectura v0.1 (diseño de septiembre 2026, 15 páginas) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes de trabajo en `assets/src/` |
| `false-positive-control.md` | Guía de operación del canal de salida: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso del pipeline |
| `agentes/` | Informes de ronda del sistema de agentes (registro histórico de auditoría y coordinación) |

## Estado del documento de arquitectura

`arquitectura-tecnica-v0.1.pdf` sigue siendo válido como **documento de visión**: el
núcleo que describe (sensor ETW → ingesta NDJSON → enriquecimiento → reglas YAML →
correlador de secuencias → alertas con acciones) es exactamente el pipeline
implementado y verificado. Las desviaciones conocidas entre el diseño y la
implementación actual, para lectura honesta del documento:

- **Consola:** el PDF planifica React + Vite + Zustand; la implementada es Next.js 16
  + Tailwind 4 con hub Bun/socket.io (misma función, stack distinto).
- **API del motor:** el PDF planifica Gin y OpenAPI generado desde el código; la
  implementada usa `net/http` de stdlib y el spec OpenAPI se mantiene a mano
  (`docs/api/openapi.yaml`, validado contra el motor vivo en cada ronda).
- **Aún no implementado** (consta en el PDF como fases 2-4): store SQLite, YARA,
  gRPC/protobuf, filaments Python, eBPF en Linux.
- **Añadido tras el PDF** (rondas de implementación): autenticación por token
  compartido en el ingest, export JSONL/CSV con neutralización de inyección de
  fórmulas, webhook de alertas con cola acotada, spec OpenAPI.
- Los ADRs mencionados en el PDF todavía no existen como directorio; las decisiones
  de diseño vigentes viven en el PDF, en el README y en los informes de `agentes/`.

El PDF se regenerará alineado con la implementación en la v0.2 (junto al renombrado
anunciado del proyecto).

# Plan de ronda — Implementaciones A (motor Go)

Fecha: 2026-10-22 · Instancia: Implementaciones A · Carril: motor Go
(`cmd/`, `internal/`, `pkg/`, `configs/`, `thresholds.yaml`, `Makefile`)

## Tarea elegida

**M-1 — TEAM-3 backend: asignación de alertas en el ciclo de vida del motor**
(hornada 1 del backlog del CONTEXTO; `libre` en TASKS.md, rol AG-1 MOTOR).
Es la prioridad más alta del carril: C-2 (consola) espera este contrato y
M-5 (ML de triaje) depende de que exista historial de triaje con responsable.

## Alcance de la implementación

1. `internal/lifecycle`: campo `assignee` (+ `assigned_by`, `assigned_at`)
   en la entrada de triaje, con método `Assign` de actualización parcial
   (asignar/reasignar/desasignar SIN tocar estado, decisión ni nota; entrada
   implícita `new` si la alerta no estaba triada). Persistencia atómica igual
   que el resto del store.
2. `internal/api`:
   - `POST /api/alerts/{id}/assign` — asignar/reasignar/desasignar una alerta.
   - `POST /api/alerts/assign` — asignación en lote (la barra de selección de
     la consola), con resultado por id y tope de ids por petición.
   - `alertView` ampliado (`assignee`, `assigned_by`, `assigned_at`) y marcos
     SSE `alert_lifecycle` tras cada asignación para que la consola viva sin
     sondear.
   - Filtro `assignee=` en `GET /api/alerts`: `none` = cola sin asignar,
     nombre = «Mis alertas».
3. Tests de ciclo de vida y de API (asignar, reasignar, desasignar, lote con
   fallos parciales, filtro, ámbito por grupos, validaciones).
4. Sin tocar TODO.md ni changelog.d: el punto del TODO se completa cuando
   C-2 aterrice la parte de consola; el backend no lo cierra solo.

## Contrato M-1 → C-2 (resumen; detalle en el informe de ronda)

- Asignación independiente del estado: `assignee` viaja en la misma entrada
  de `alert_lifecycle`; la consola puede seguir usando su manejador SSE
  actual y solo añade los campos nuevos.
- `by` sigue siendo texto libre del cliente (mismo modelo de confianza que
  el triaje actual): la consola envía la cuenta con sesión.
- Cola sin asignar: `GET /api/alerts?assignee=none` (sin entrada de triaje o
  con asignación vacía). Mis alertas: `GET /api/alerts?assignee=<cuenta>`.

## Coordinación

- Pareja de carril (Implementaciones B, sensor Rust): sin plan publicado en
  el repo todavía (`docs/agentes/` se estrena esta ronda); no hay solape —
  mi carril no toca `sensor/`.
- Dejo la reclamación de M-1 en TASKS.md (kit vigente en el repo) además de
  este plan, para que ninguna instancia del kit antiguo la tome.
- Trabajo en rama `agent/motor/m-1` y PR pequeño: main está protegida (los
  merges los hace el humano), según la convención del repo y los PR #34–#38.

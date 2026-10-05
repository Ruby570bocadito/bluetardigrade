# Plan de ronda — Implementación B (2026-10-05, ronda 4)

Novedad: `TODO.md` y `docs/PLAN-DETALLADO.md` sí existen en
`origin/feat/enrollment` (localizado por Seguridad B en su informe 12h33);
los leo de allí. `origin/main` sigue en `5e168ba` (merge «already up to
date»). Ramas ajenas en origin: `carril/pulimiento-a` (solo docs) y
`carril/seguridad-b` (CI, go.mod, http-ui del hub); ninguna toca
visualización de la consola. Reconozco la resolución de PUL-A sobre la fila
«Console» de `ARCHITECTURE.md` (su commit bac6b02 es anterior a mi plan de
ronda 3): no vuelvo a tocar ese fichero.

## Tareas cogidas (identificadores de TODO.md, carril Implementación B)

1. **VIZ-2 Mapa de calor hora × día (alertas)**: rejilla día de la semana ×
   hora (0-23) de la carga de alertas, en el dashboard. Lib pura
   `lib/alert-heatmap.ts` (ventana real declarada, tope honesto cuando la
   respuesta llega al límite de 1000 de la API, hora local del navegador
   con zona explícita) + componente `charts/week-hour-heatmap.tsx`
   (rampa secuencial, recuento en celda, gemelo de tabla) + pruebas.
   Inicios de sesión (AD-3) y eventos por equipo quedan fuera: no hay
   endpoint aún; se anota en el informe.
2. **VIZ-6 Exportar cualquier gráfica**: menú «Exportar» en el marco común
   `charts/chart-frame.tsx`: datos en CSV (desde el gemelo de tabla),
   gráfica en SVG (serialización con estilos computados incrustados) y PNG
   (rasterización 2x con degradado honesto si el navegador no lo permite).
   De fondo, lib pura `lib/chart-export.ts` + pruebas. Todos los paneles
   que usan `ChartCard` obtienen la opción sin tocar cada gráfica.

Fuera de alcance esta ronda: informe de ruido §2.4 (pende de
`GET /api/noise`, Implementación A), VIZ-3/4/5, AD-5/AD-6 (penden de la API
de AD de Implementación A) y SET-3 (los certificados/retención que pide su
diseño no están publicados aún por la API; lo declaro en el informe).

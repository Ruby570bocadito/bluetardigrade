# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 3, 2026-10-05)

- Rama `carril/implementacion-b` sobre la base `5e168ba` de `origin/main`
  (sin cambios durante la ronda) y publicada en origin con el token del
  responsable. En origin solo hay otra rama de carril: `carril/pulimiento-a`
  (documentación de CLI y del inventario de arquitectura, sin solape con la
  consola).
- Rondas 1-2 ENTREGADAS: H5 «Análisis de incidente» (agrupación host+ventana,
  `analyst:ask-incident`) y streaming nativo del proveedor en el analista
  (`analyst:delta` en vivo, fallback JSON, guardas de tiempo).
- Deuda de docs saldada: la fila «Console» del inventario de
  `docs/ARCHITECTURE.md` ya no dice «(no provider token streaming)» — era el
  encargo que Pulimiento A dejó anotado en su ronda 12h13.

## En curso esta ronda

- **Gráficas nuevas del dashboard (backlog de rondas previas), ENTREGADAS**:
  - «Ciclo de vida por táctica»: columnas apiladas táctica ATT&CK × estado
    de triage (nuevas/reconocidas/cerradas) con gemelo de tabla; función
    pura `lifecycleTacticColumns` en `lib/soc-metrics.ts` (+4 pruebas).
  - «Evolución del riesgo por equipo»: nueva gráfica de líneas multiserie
    (`components/charts/line-chart.tsx`) alimentada por `lib/risk-history.ts`
    (muestreo real de `stats.hot_hosts` cada 10 s, ventana de 10 min, huecos
    honestos si el motor no publica o el host sale del top-5, tope de 4
    series y resto en la tabla) (+12 pruebas). Verificación pendiente en el
    dashboard real con un motor vivo en el laboratorio.

## Siguientes (por qué)

1. **Vista de árbol global** (H5): el cierre pide `GET /api/hosts/{h}/tree`
   (endpoint Go: Implementación A, sin rama publicada todavía). La ficha de
   equipo ya dibuja el árbol en vivo desde el buffer; cuando A entregue el
   endpoint, enlazar el histórico.
2. **Verificación de producto en laboratorio**: streaming del analista con
   proveedor real y las dos gráficas nuevas contra un motor vivo (es
   verificación, no código pendiente; este entorno no tiene motor Windows ni
   proveedor IA configurado).
3. **H2 bundle forense**: validar el árbol de procesos del panel forense con
   datos del E2E de laboratorio y medir ruido (pende de un host Windows real).
4. **Más gráficas (backlog)**: solo si el responsable pide más visualización;
   el dashboard cubre ahora actividad, severidad, mezcla, grafo, cobertura y
   matriz ATT&CK, calor por equipo/táctica, ciclo de vida por táctica y
   evolución de riesgo.

## Decisiones de carrera registradas

- El hub (`web/console-service`) se trata como parte del flujo de la consola
  (mi área: «flujos») cuando el cambio es del flujo Analista IA; el motor Go
  y su API siguen siendo de Implementación A. Registrado aquí para que el
  responsable pueda reasignarlo.
- Sin kill-switch de streaming (no se añade `ANALYST_STREAM=0`): el fallback
  JSON ya degrada con proveedores sin streaming; si aparece en práctica un
  proveedor que rechace `stream: true` con un error HTTP, será el momento de
  añadirlo (registrado en el backlog del informe de ronda 2).
- Riesgo observado ≠ riesgo inventado: el histórico de riesgo vive solo en el
  cliente, empieza con la consola y nunca interpola huecos; si el producto
  quiere histórico persistente, eso es decisión del motor (fuera de mi carril).

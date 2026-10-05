# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 1, 2026-10-05)

- Rama `carril/implementacion-b` creada desde `origin/main` (commit base
  `5e168ba`). Primera ronda del carril: no había `roadmap_B.md` ni informes
  previos; no existen aún las ramas de los otros cinco carriles.
- `TODO.md` y `docs/PLAN-DETALLADO.md` no existen todavía en el repositorio:
  las tareas se toman de `docs/ROADMAP.md`, que declara problema, cierre y
  estado por horizonte. Cuando el responsable publique `TODO.md` con el «Plan
  de trabajo por carriles», realinear identificadores.

## En curso esta ronda

- H5 «Análisis de incidente»: **ENTREGADA** (código y pruebas; el E2E con
  host Windows real queda como verificación de producto pendiente).
  - Consola: agrupación por host+ventana (`incident-analysis.ts`, 15
    pruebas), botón «Analizar con IA» en Incidentes, «Analizar la
    selección» en la barra múltiple de Alertas, modo incidente en el panel
    del analista con bundle forense adjunto cuando el motor lo sirve.
  - Hub (`web/console-service`): evento `analyst:ask-incident` con
    validación campo a campo, prompt multi-alerta delimitado/truncado y
    mismos gates de tarifa/concurrencia (`acquireAnalystBudget` compartido
    con `analyst:ask`). 19 pruebas nuevas entre `analyst.test.ts` y
    `hub.test.ts`.
  - Detalle completo en `ronda_2026-10-05_11h55_B.md`.

## Siguientes (por qué)

1. **Streaming nativo del proveedor** (H5, pendiente según roadmap): el hub
   mantiene el contrato `analyst:delta` pero no transmite tokens del
   proveedor. Requiere tocar la petición fetch del hub y el mapeo SSE;
   lo dejo para una ronda propia para no mezclar contratos en un mismo release.
2. **Vista de árbol global** (H5): el cierre pide `GET /api/hosts/{h}/tree`
   (endpoint Go: Implementación A). La ficha de equipo ya dibuja el árbol en
   vivo desde el buffer; cuando A entregue el endpoint, enlazar el histórico.
3. **H2 bundle forense**: el árbol ya se renderiza desde `buildProcessTree`
   (entregado). Queda validar el componente con datos del E2E de laboratorio
   y medir ruido; pendiente de acceso a un host Windows real.
4. **Donuts/gráficas**: si el responsable pide más visualizaciones (le gustan
   las gráficas y los árboles), candidatos: distribución ATT&CK por estado de
   ciclo de vida y evolución de riesgo por equipo.

## Decisiones de carrera registradas

- El hub (`web/console-service`) se trata como parte del flujo de la consola
  (mi área: «flujos») cuando el cambio es del flujo Analista IA; el motor Go
  y su API siguen siendo de Implementación A. Registrado aquí para que el
  responsable pueda reasignarlo.

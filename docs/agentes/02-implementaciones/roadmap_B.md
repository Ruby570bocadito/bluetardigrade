# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 2, 2026-10-05)

- Rama `carril/implementacion-b` sobre la base `5e168ba` de `origin/main`;
  publicada en origin con el token del responsable (primer push del carril,
  incluye la ronda 1 completa). Sin ramas `carril/*` ajenas en origin durante
  toda la ronda 2: nada que reconciliar.
- Ronda 1 (H5 «Análisis de incidente») ENTREGADA: agrupación host+ventana,
  botones de entrada en Incidentes y en la selección de Alertas, prompt
  multi-alerta delimitado, evento `analyst:ask-incident` con los mismos gates.

## En curso esta ronda

- H5 «Progreso honesto del analista»: **streaming nativo del proveedor,
  ENTREGADA** (código y pruebas; queda la verificación de producto con un
  proveedor real en laboratorio).
  - Hub (`web/console-service/analyst.ts`): `chatCompletionStream` pide
    `stream: true` y reenvía cada fragmento real como `analyst:delta` en
    vivo; fallback JSON para proveedores que ignoren el streaming; guardas
    de primer byte (60 s), inactividad (30 s) y total (120 s) con mensajes
    en español; contrato de socket sin cambios.
  - `runAnalysis` y `runIncidentAnalysis` emiten los deltas durante la
    generación; el texto completo sigue viajando en `analyst:done`.
  - Consola: sin cambios de código (el panel ya acumulaba fragmentos); solo
    el comentario de cabecera del panel deja de decir que no hay streaming.
  - Pruebas: 8 nuevas (SSE, [DONE], líneas malformadas, error dentro del
    flujo, fallback JSON, guardas de primer byte e inactividad, deltas
    múltiples por socket E2E). 102 pass en console-service, 267 en console.

## Siguientes (por qué)

1. **Vista de árbol global** (H5): el cierre pide `GET /api/hosts/{h}/tree`
   (endpoint Go: Implementación A). La ficha de equipo ya dibuja el árbol en
   vivo desde el buffer; cuando A entregue el endpoint, enlazar el histórico.
2. **H2 bundle forense**: el árbol ya se renderiza desde `buildProcessTree`
   (entregado). Queda validar el componente con datos del E2E de laboratorio
   y medir ruido; pendiente de acceso a un host Windows real.
3. **Verificación de producto del streaming**: con `ANALYST_*` apuntando a un
   proveedor real en el laboratorio, confirmar que los fragmentos se ven
   mientras se generan y que un streaming cortado deja el texto parcial y el
   error (es verificación, no código pendiente).
4. **Gráficas nuevas**: candidatos en backlog (distribución de ciclos de
   vida por táctica ATT&CK, evolución de riesgo por equipo) para cuando el
   responsable pida más visualización; el dashboard ya cubre tácticas,
   severidad y mezcla de eventos.

## Decisiones de carrera registradas

- El hub (`web/console-service`) se trata como parte del flujo de la consola
  (mi área: «flujos») cuando el cambio es del flujo Analista IA; el motor Go
  y su API siguen siendo de Implementación A. Registrado aquí para que el
  responsable pueda reasignarlo.
- Sin kill-switch de streaming (no se añade `ANALYST_STREAM=0`): el fallback
  JSON ya degrada con proveedores sin streaming; si aparece en práctica un
  proveedor que rechace `stream: true` con un error HTTP, será el momento de
  añadirlo (registrado en el backlog del informe de ronda).

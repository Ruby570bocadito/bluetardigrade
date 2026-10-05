# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 2 del nuevo ciclo, 2026-10-05)

- Rama `carril/implementacion-b` recreada desde `origin/main` (`a1bca4f`, cierre de la
  ronda 1 consolidado) y publicada; la ronda 1 de este nuevo ciclo la cerró otra
  instancia con SET-3 ya en `main`.
- **Ronda 2 ENTREGADA: el panel está en pestañas** (Resumen / Detección / Equipos y
  actividad, `?pestana=`), corrección directa del feedback de la ronda 1 (todo apilado,
  accionable al final): cola en vivo y salud del motor al principio; los cinco paneles
  de táctica ATT&CK quedan en una sola pestaña Detección, cada uno con una decisión
  distinta (cobertura/validación, composición, cronología, ciclo de vida, flujo).
- **SIM-4 pantalla**: pestaña «Validación» en Detección — lanzar la batería (completa,
  por táctica del clic de la matriz, o selección manual), progreso en vivo con sondeo
  cada 2 s, historial con detalle por escenario y tendencia de la tasa de éxito. Un
  motor sin `-scenarios` responde 501 y la vista declara «Batería no armada» con el
  hint del motor: nunca una batería falsa.
- **REP-1 pantalla**: vista «Informes» — selector renderizado desde el catálogo del
  motor (sin kinds hardcodeados), generación JSON, descarga CSV/JSON con los bytes del
  motor y hoja imprimible (CSS module propio, sin tocar `globals.css`).
- **Informe de ruido**: pestaña «Ruido» en Detección — procesos, dominios y reglas con
  honestidad de origen (store/anillos, tope de examen), «crear supresión» reutilizando
  el diálogo de alert-actions (ahora exportado) y «software conocido» deshabilitado con
  tooltip hasta la v1.1 del motor.
- **SIM-3**: la matriz ATT&CK existente gana «N escenarios válidos» por táctica
  (mapeo: reglas esperadas → tactic; pasos de cadenas; subtécnicas por prefijo) y el
  clic en una táctica validada abre Validación filtrado (`?sc=slug`).
- Proxy `/api/engine`: `POST /api/scenarios/run` añadido a la lista cerrada de
  escrituras (rol analista); el hint de «solo lectura» actualizado.
- Ronda 1 (instancia anterior, ya en main): VIZ-1/2/3/6, SET-3, análisis de incidentes
  y streaming del analista.

## Decisiones de carrera registradas

- **Datos observados ≠ datos inventados** (ronda 3, vigente): la vista de Validación
  no dibuja una batería cuando el motor responde 501; Ruido marca «no disponible» en
  lugar de tablas vacías; Informes no pinta cobertura cuando el motor declara
  `enabled: false`.
- **La pantalla sigue al catálogo del motor** (ronda 2): el selector de informes se
  renderiza desde `GET /api/reports`; un kind futuro sin renderer propio muestra su
  JSON honesto en vez de romper.
- **Pestañas, no pilas** (ronda 2): cada gráfica nueva va a la pestaña que le toca y
  ninguna duplica la decisión de otra; el clic de la matriz lleva a los escenarios
  (Validación), no a otra gráfica.
- **CSS de impresión en módulo propio** (ronda 2): `reports-print.module.css` para no
  cruzarme con el tema de PUL-B en `globals.css`.
- **Exportaciones generadas en cliente** (ronda 4, vigente): las descargas de REP-1
  son las excepción deliberada — el motor ya produce el CSV escapado y el JSON
  completo; la consola no re-serializa informes.
- **Paleta categórica cerrada** (ronda 6): cuatro tonos + «Otros»; la matriz de
  validación usa marcas de texto, no colores nuevos (ampliar la paleta es de PUL-B).
- Sin kill-switch de streaming (ronda 2, vigente): el fallback JSON ya degrada con
  proveedores sin streaming.

## Siguientes (por qué)

1. **AD-5/AD-6 (pantallas de Active Directory)**: bloqueadas por la API de AD-1 —
   ni en `main` ni en la rama de IMP-A (su roadmap la tiene en la cola, detrás del
   campo de decisión y v1.1 Ruido). No se inventa ningún dato de AD. En cuanto
   aterrice: Resumen con puntuación y donut, usuarios, árbol de grupos privilegiados
   y equipos del dominio frente a sensores (AD-5); formulario con «probar conexión» y
   contraseña que se escribe pero nunca se muestra (AD-6).
2. **SET-3 cierre sin «parcial»**: espera los campos de IMP-A (latencias, tamaño del
   almacén, versión, certificados, último informe programado); el pie de la vista ya
   declara la ausencia.
3. **REP-3 (Descargas)**: necesita las superficies del sensor firmado (exe/MSI con
   SHA-256) y del certificado de ingesta; hoy no hay rutas que las sirvan.
4. **SET-1 (Ajustes)**: pantalla única General/Ingesta/AD/Integraciones/Notificaciones/
   Cuentas/Apariencia, pendiente de la API y persistencia de IMP-A.
5. **Campo de decisión de triaje** (petición MEDIA repetida a IMP-A): desbloquea el
   «falso positivo» real del flujo y los porcentajes FP del ruido.
6. **VIZ-5 mapa de la flota**: pende de grupos/sedes (fase C de escala).
7. **VIZ-4 tendencias reales**: el «periodo anterior» necesita series históricas del
   almacén (IMP-A); las sparklines de KPI ya cubren la ventana en memoria.

## Coordinación vigente

- `globals.css`/`layout.tsx`/`entity-graph.tsx` siguen siendo de PUL-B; mis vistas
  consumen tokens. En esta ronda retiré de `detection-hub.tsx` el `text-blue-100` que
  PUL-B tenía en su lista (su shim queda obsoleto para ese fichero).
- `dashboard.tsx` reorganizado por mí: los 2 `blue-*` que PUL-B dejaba para después de
  fusionar mi rama siguen ahí intactos (RecentTelemetry).
- El relé del hub no se tocó: las tres superficies nuevas son GET (reenviados tal
  cual) y la única escritura nueva (`POST /api/scenarios/run`) viaja por el proxy de
  la consola, no por el hub.

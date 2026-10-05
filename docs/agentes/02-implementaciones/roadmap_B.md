# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 3 del nuevo ciclo, 2026-10-05)

- Rama `carril/implementacion-b` recreada desde `origin/main` (`a1bca4f`, cierre de la
  ronda 1 consolidado) y publicada; la ronda 1 de este nuevo ciclo la cerró otra
  instancia con SET-3 ya en `main`.
- **Ronda 2 ENTREGADA: el panel está en pestañas** (Resumen / Detección / Equipos y
  actividad, `?pestana=`), **SIM-4 pantalla** (pestaña Validación: batería, progreso
  en vivo, historial, tendencia; 501 = «no armada»), **REP-1 pantalla** (vista
  Informes: catálogo del motor, descargas CSV/JSON con los bytes del motor, hoja
  imprimible), **informe de ruido** (con «crear supresión»), **SIM-3** (matriz ATT&CK
  validada por escenario con clic a la batería filtrada) y `POST /api/scenarios/run`
  en la lista cerrada del proxy. Conflicto con la ronda zinc de PUL-B resuelto
  fusionando su rama: kit `ui-tabs` adoptado en mis dos tablists y tokens zinc.
- **Ronda 3 ENTREGADA: REP-4** — gráficas de los informes con los componentes de la
  consola (`ChartCard` + donut/barras/columnas apiladas) y exportación PNG/SVG/CSV de
  VIZ-6, fuera de la hoja imprimible; y el enlace «Informe del motor» en la ficha de
  incidente (`?view=informes&informe=incident&caso=<id>`).
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
  ninguna duplica la decisión de otra; el clic de la matriz lleva a los escenarios.
- **REP-4 reutiliza `ChartCard`** (ronda 3): leyenda, tabla gemela y exportación
  vienen del marco común; las gráficas no entran en la hoja de impresión (PDF solo
  texto). El informe de incidente no recibe gráficas inventadas.
- **CSS de impresión en módulo propio** (ronda 2): `reports-print.module.css` para no
  cruzarme con el tema de PUL-B en `globals.css`.
- **Descargas de REP-1 con los bytes del motor** (ronda 2): excepción deliberada a
  «exportar en cliente» (ronda 4) — el CSV ya lleva el escapado del motor.
- **Paleta categórica cerrada** (ronda 6): cuatro tonos + «Otros»; la matriz de
  validación usa marcas de texto, no colores nuevos.
- Sin kill-switch de streaming (ronda 2, vigente): el fallback JSON ya degrada con
  proveedores sin streaming.

## Siguientes (por qué)

1. **AD-5/AD-6 (pantallas de Active Directory)**: primera prioridad en cuanto IMP-A
   publique su ronda (AD-1/AD-2 en curso según su plan 16h05): fusionar su rama en
   la mía y construir Resumen con puntuación y donut de hallazgos, usuarios, árbol de
   grupos privilegiados y equipos del dominio frente a sensores (AD-5); formulario
   con «probar conexión» y contraseña que se escribe pero nunca se muestra (AD-6).
   No se inventa ningún dato de AD.
2. **SET-3 cierre sin «parcial»**: IMP-A promete en el mismo plan latencias, tamaño
   del almacén, versión y certificados; el pie de la vista declara los huecos y los
   llenará cuando la API los publique.
3. **Campo de decisión de triaje** (petición MEDIA repetida a IMP-A): desbloquea el
   «falso positivo» real del flujo de triaje y los porcentajes FP del ruido.
4. **REP-3 (Descargas)**: superficies del sensor firmado (exe/MSI con SHA-256),
   certificado de ingesta y guías; hoy sin rutas que las sirvan (IMP-A).
5. **SET-1 (Ajustes)**: pantalla única General/Ingesta/AD/Integraciones/Notificaciones/
   Cuentas/Apariencia, pendiente de la API y persistencia de IMP-A.
6. **Ideas sin bloquear, detrás de las anteriores**: IDEA-3 (plantillas de
   incidente), IDEA-11 (asistente de primer arranque), IDEA-10 (idiomas).
7. **VIZ-4 tendencias reales / VIZ-5 mapa de flota**: series históricas y
   grupos/sedes de IMP-A (fase C).

## Parado (2026-10-05, cierre de la ronda 3)

Motivo: **bloqueo de la cola principal**. Lo que queda de la cola de este carril
(AD-5/AD-6, cierre de SET-3, REP-3, SET-1, FP del flujo de triaje) depende de la
ronda en curso de IMP-A (AD-1/AD-2, campos de estado, campo de decisión) o de
superficies que no existen todavía: en su rama solo hay plan publicado, nada de
código que fusionar. Las tareas de mi carril que no dependían de nada (las cuatro
pantallas, SIM-3, REP-4 y el enlace del caso) están entregadas y verificadas en
`carril/implementacion-b`. Las ideas sin bloqueo restantes (IDEA-3, IDEA-11) quedan
anotadas en «Siguientes», detrás de las prioridades bloqueadas: empezarlas con el
presupuesto restante de la sesión arriesgaría una entrega a medias, y la regla del
carril es piezas completas o nada.

## Coordinación vigente

- La ronda zinc de PUL-B está fusionada en mi rama (`95138ae`): el kit `ui-tabs` es
  la base común; su PR quedará en no-op para los ficheros compartidos.
- `globals.css`/`layout.tsx`/`entity-graph.tsx` siguen siendo de PUL-B; mis vistas
  consumen tokens.
- El relé del hub no se tocó: las superficies nuevas son GET (reenviados tal cual) y
  la única escritura nueva (`POST /api/scenarios/run`) viaja por el proxy de la
  consola, no por el hub.
- SEG-B declaró analista/reactbits para su ronda 3; mis ficheros de esta sesión no
  se solapan con ello.

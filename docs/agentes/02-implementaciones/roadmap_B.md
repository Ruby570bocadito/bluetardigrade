# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 4 del nuevo ciclo, 2026-10-05)

- Rama `carril/implementacion-b` sobre el cierre de la ronda 1 (`a1bca4f`); rondas
  2 y 3 entregadas (pestañas del panel, SIM-4, REP-1, informe de ruido, SIM-3,
  REP-4 y enlace del informe de caso).
- **Ronda 4 ENTREGADA: IDEA-3 Plantillas de incidente** — sección «Plan de
  respuesta» en la ficha de cada caso: tres plantillas de producto (Ransomware 11
  pasos, Phishing 10, Cuenta comprometida 10) con técnicas ATT&CK, lista de
  comprobación con progreso, evidencias con sugerencias y cronología del analista;
  los informes .md e imprimible del caso incluyen el plan; aplicar una plantilla
  deja nota en la línea de tiempo del motor. El plan vive en el navegador
  (localStorage validado y con tope, patrón de las búsquedas guardadas) y la UI lo
  declara; nada se inventa ni se envía al motor.
- **Fallo preexistente arreglado** (de mi ronda 2): la descripción de Ruido
  decía «reglas» y «DETECCION reglas» devolvía dos comandos en la paleta;
  `check_console_browser.mjs` volvía a 21/21 arreglándolo en la fuente
  («detectores»), no en el test.
- Ronda 1 (instancia anterior, ya en main): VIZ-1/2/3/6, SET-3, análisis de
  incidentes y streaming del analista.

## Decisiones de carrera registradas

- **Datos observados ≠ datos inventados** (ronda 3, vigente): la vista de Validación
  no dibuja una batería cuando el motor responde 501; Ruido marca «no disponible» en
  lugar de tablas vacías; Informes no pinta cobertura cuando el motor declara
  `enabled: false`.
- **La pantalla sigue al catálogo del motor** (ronda 2): el selector de informes se
  renderiza desde `GET /api/reports`; un kind futuro sin renderer propio muestra su
  JSON honesto en vez de romper.
- **El plan de respuesta es del analista, no del motor** (ronda 4): las plantillas
  son contenido del producto (constantes), el estado vive en este navegador con el
  patrón validado de las búsquedas guardadas, y la única escritura al motor es la
  nota de aplicación en la línea de tiempo. La exportación lleva exactamente lo
  registrado y declara su procedencia.
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
   publique su ronda (AD-1/AD-2 siguen siendo solo plan en su rama, verificado esta
   ronda): fusionar su rama en la mía y construir Resumen con puntuación y donut de
   hallazgos, usuarios, árbol de grupos privilegiados y equipos del dominio frente
   a sensores (AD-5); formulario con «probar conexión» y contraseña que se escribe
   pero nunca se muestra (AD-6). No se inventa ningún dato de AD.
2. **SET-3 cierre sin «parcial»**: IMP-A promete en el mismo plan latencias, tamaño
   del almacén, versión y certificados; el pie de la vista declara los huecos y los
   llenará cuando la API los publique.
3. **Campo de decisión de triaje** (petición MEDIA repetida a IMP-A): desbloquea el
   «falso positivo» real del flujo de triaje y los porcentajes FP del ruido.
4. **REP-3 (Descargas)**: superficies del sensor firmado (exe/MSI con SHA-256),
   certificado de ingesta y guías; hoy sin rutas que las sirvan (IMP-A).
5. **SET-1 (Ajustes)**: pantalla única General/Ingesta/AD/Integraciones/Notificaciones/
   Cuentas/Apariencia, pendiente de la API y persistencia de IMP-A.
6. **IDEA-11 (asistente de primer arranque)** e **IDEA-10 (idiomas)**: sin bloqueo,
   detrás de las anteriores.
7. **VIZ-4 tendencias reales / VIZ-5 mapa de flota**: series históricas y
   grupos/sedes de IMP-A (fase C).

## Coordinación vigente

- La ronda zinc de PUL-B sigue fusionada en mi rama (`95138ae`): el kit `ui-tabs`
  es la base común; su PR quedará en no-op para los ficheros compartidos.
- `globals.css`/`layout.tsx`/`entity-graph.tsx` siguen siendo de PUL-B; mis vistas
  consumen tokens.
- El relé del hub no se tocó esta ronda: el plan de respuesta es local y su única
  escritura al motor usa la nota de incidentes ya existente.
- SEG-B declaró analista/reactbits para su ronda 3; mis ficheros de esta sesión no
  se solapan con ello.
- La herramienta de capturas (`docs/assets/src/capture_console.mjs`) sigue siendo de
  PUL-B: la usé en modo fixtures para el humo de esta ronda y restauré los PNG
  después, sin editarla.

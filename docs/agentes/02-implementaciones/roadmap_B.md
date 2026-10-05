# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 5 del nuevo ciclo, 2026-10-05)

- Rama `carril/implementacion-b` sobre la ronda 4 (`9f35615`); rondas 2-4
  entregadas (pestañas del panel, SIM-4, REP-1, informe de ruido, SIM-3, REP-4,
  enlace del informe de caso, IDEA-3 plantillas de incidente).
- **Ronda 5 ENTREGADA: IDEA-11 Asistente de primer arranque** — diálogo «Puesta
  en marcha» con acceso/cuentas reales (`CONSOLE_USERS_FILE` + script), señal
  del motor para el certificado (`enroll.enabled` + su propio hint), primer
  token de alta reutilizando `TokenEnrollment` y aprobación del sensor con
  `PendingHosts`. Se abre solo con instalación nueva confirmada por el motor
  (flota y alta cargadas, inventario y hosts activos a cero), descarte por
  navegador en localStorage validado; pie de barra lateral y paleta lo reabren.
- **DISCORD no disponible esta sesión** (`DISCORD_WEBHOOK_URL` sin definir):
  sin notificaciones de inicio/cierre; no se reintentó.
- IMP-A solo ha publicado plan (AD-1/AD-2/SET-3-lado-motor, commit `2c32013`);
  sin código AD que fusionar todavía.

## Decisiones de carrera registradas

- **Datos observados ≠ datos inventados** (ronda 3, vigente): la vista de Validación
  no dibuja una batería cuando el motor responde 501; Ruido marca «no disponible» en
  lugar de tablas vacías; Informes no pinta cobertura cuando el motor declara
  `enabled: false`. Ronda 5: el asistente deriva su estado de lo que el motor
  responde y declara como «Información» lo que la consola no puede medir (cuentas
  hasta SET-1, descarga del certificado hasta REP-3); sin progreso falso guardado.
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
- **El asistente no duplica Equipos** (ronda 5): token y aprobaciones reutilizan
  `TokenEnrollment`/`PendingHosts`; solo se exportó `CopyBox`.
- **Paleta categórica cerrada** (ronda 6): cuatro tonos + «Otros»; la matriz de
  validación usa marcas de texto, no colores nuevos.
- Sin kill-switch de streaming (ronda 2, vigente): el fallback JSON ya degrada con
  proveedores sin streaming.

## Siguientes (por qué)

1. **AD-5/AD-6 (pantallas de Active Directory)**: primera prioridad en cuanto IMP-A
   empuje su ronda de AD-1/AD-2 (hoy solo plan): fusionar su rama en la mía y
   construir Resumen con puntuación y donut de hallazgos, usuarios, árbol de grupos
   privilegiados y equipos del dominio frente a sensores (AD-5); formulario con
   «probar conexión» y contraseña que se escribe pero nunca se muestra (AD-6). No se
   inventa ningún dato de AD.
2. **SET-3 cierre sin «parcial»**: IMP-A promete en el mismo plan latencias, tamaño
   del almacén, versión y certificados; el pie de la vista declara los huecos y los
   llenará cuando la API los publique.
3. **Campo de decisión de triaje** (petición MEDIA repetida a IMP-A): desbloquea el
   «falso positivo» real del flujo de triaje y los porcentajes FP del ruido.
4. **REP-3 (Descargas)**: superficies del sensor firmado (exe/MSI con SHA-256),
   certificado de ingesta y guías; hoy sin rutas que las sirvan (IMP-A). El paso de
   certificado del asistente ya declara este hueco.
5. **SET-1 (Ajustes)**: pantalla única General/Ingesta/AD/Integraciones/Notificaciones/
   Cuentas/Apariencia, pendiente de la API y persistencia de IMP-A. El paso de acceso
   del asistente enlaza aquí.
6. **IDEA-10 (idiomas)**: sin bloqueo técnico pero grande y transversal (toca casi
   todas las vistas: riesgo alto de solape con SEG-B en analista/reactbits); planear
   antes de empezar.
7. **VIZ-4 tendencias reales / VIZ-5 mapa de flota**: series históricas y
   grupos/sedes de IMP-A (fase C).

## Coordinación vigente

- La ronda zinc de PUL-B sigue fusionada en mi rama (`95138ae`): el kit `ui-tabs`
  es la base común; su PR quedará en no-op para los ficheros compartidos.
- `globals.css`/`layout.tsx`/`entity-graph.tsx` siguen siendo de PUL-B; mis vistas
  consumen tokens. El asistente usa los mismos tokens (verificado por
  `check_console_theme.py` en los dos temas).
- SEG-B declaró analista/reactbits para su ronda 3; mis ficheros de esta ronda
  (onboarding, shell, enroll-parts, paleta) no se solapan con ello.
- La herramienta de capturas (`docs/assets/src/capture_console.mjs`) sigue siendo de
  PUL-B: no la toqué; la captura del asistente sale de mi batería de navegador
  (`captures/browser-regression/onboarding-wizard.png`, gitignored).
- `check_console_browser.mjs` gana una comprobación de integración del asistente con
  contexto Playwright propio (22/22); el resto de la batería no cambia.

# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 6 del nuevo ciclo, 2026-10-05)

- Rama `carril/implementacion-b` sobre la ronda 5 (`d6f2285`); rondas 2-5
  entregadas (pestañas del panel, SIM-4, REP-1, informe de ruido, SIM-3, REP-4,
  enlace del informe de caso, IDEA-3 plantillas de incidente, IDEA-11
  asistente de primer arranque).
- **Ronda 6 ENTREGADA: IDEA-10 Idiomas, fase 1 («el armazón bilingüe»)** —
  `lib/i18n` con diccionarios ES/EN de paridad tipada (EN se tipa con `Dict`,
  el test de paridad re-verifica claves, tipos, aridad y no-vacío),
  `I18nProvider` con la disciplina del tema (SSR en español, elección
  guardada al montar, `storage` multipestaña), boot de `html[lang]` en
  layout, alternador ES/EN en la cabecera y migración del armazón: nav,
  paleta (catálogo construido desde el diccionario, ids estables, búsqueda
  parametrizable), hoja de atajos, chips de armazón y asistente completo.
  La batería de navegador fija locale `es-ES` y suma la comprobación del
  alternador (23/23).
- **DISCORD no disponible esta sesión** (`DISCORD_WEBHOOK_URL` sin definir):
  sin notificaciones de inicio/cierre; no se reintentó.
- IMP-A sigue solo con plan (AD-1/AD-2/SET-3-lado-motor, commit `2c32013`);
  sin código AD que fusionar todavía. Re-verificado con fetch al empezar.

## Decisiones de carrera registradas

- **Datos observados ≠ datos inventados** (ronda 3, vigente): la vista de Validación
  no dibuja una batería cuando el motor responde 501; Ruido marca «no disponible» en
  lugar de tablas vacías; Informes no pinta cobertura cuando el motor declara
  `enabled: false`. Ronda 5: el asistente deriva su estado de lo que el motor
  responde y declara como «Información» lo que la consola no puede medir (cuentas
  hasta SET-1, descarga del certificado hasta REP-3); sin progreso falso guardado.
- **El idioma es preferencia del navegador, nunca dato del motor** (ronda 6):
  ES es el producto por defecto (SSR y sin JS), sin elección guardada manda la
  preferencia del navegador (`en*` → EN); el texto que llega del motor no se
  traduce jamás (hints, nombres de regla, kinds de informe).
- **ES byte-idéntico y paridad tipada** (ronda 6): `dict-es.ts` copia exacta de
  los textos que la batería fija (el test los pinea); `dict-en.ts` se tipa con
  `Dict` y un test de paridad profunda re-verifica claves/tipos/aridad. Las
  keywords EN llevan sinónimos ES a propósito para no perder recall en la paleta.
- **Catálogo de la paleta construido desde el diccionario** (ronda 6):
  `buildConsoleCommands(dict)` con ids estables entre idiomas y
  `findConsoleCommands(query, catálogo)` parametrizable; el ES por defecto
  mantiene intactos los tests y fixtures previos.
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
6. **IDEA-10 fase 2 (barrido de vistas)**: la infraestructura ya existe;
  queda migrar vista a vista con la receta (extraer strings byte-idénticos a
  `dict-es`, traducir en `dict-en`, paridad tipada + test, prosas con
  `<code>` troceadas). Cola propuesta: `noc-mode` y `critical-notifier`
  (pequeños), luego vistas de datos grandes (alertas, equipos, incidentes) en
  rondas separadas para no cruzar con SEG-B/PUL-B si tocan `web/console`.
  Quedan fuera por depender de otros: `user-session`/`console-user` (auditoría
  con texto en lib), `detectors-menu`.
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

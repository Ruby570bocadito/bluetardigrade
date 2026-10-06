# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 8 del nuevo ciclo, 2026-10-06)

- Rama `carril/implementacion-b` sobre la ronda 7 (`b5e26d7`); rondas 2-7
  entregadas (pestañas del panel, SIM-4, REP-1, informe de ruido, SIM-3, REP-4,
  enlace del informe de caso, IDEA-3 plantillas de incidente, IDEA-11
  asistente de primer arranque, IDEA-10 fase 1, AD-5, cierre de SET-3).
- **Ronda 8 ENTREGADA: IDEA-10 fase 2, primer barrido (noc + avisos).**
  - Secciones `noc`/`notify` en los diccionarios ES/EN (paridad tipada + paseo
    del test); `noc-mode.tsx` y `critical-notifier.tsx` consumen `useI18n`;
    el texto del toast del navegador sale del diccionario vía
    `notificationText(fresh, phrases)` (lib pura, `NotifyPhrases`; ES
    byte-idéntico, EN con sus plurales). Los números del NOC formatean con el
    locale del idioma activo (es-ES/en-US); los datos del motor (reglas,
    hosts, resúmenes) siguen sin traducirse. 442/442 tests, tsc/build
    limpios, DOM 34/34, navegador 23/23, axe 18/18, temas OK, CSP PASS.
- **Coordinación CSP**: los dos scripts inline de boot (tema de PUL-A/PUL-B e
  idioma de la ronda 6) van firmados con el nonce por petición del proxy;
  cualquier script inline nuevo del armazón necesita lo mismo.
- **AD-6 a punto de desbloquearse**: el plan nuevo de IMP-A (`c357cc8`,
  empujado durante mi ronda 8) declara la **API de ajustes AD**
  (`GET/PUT /api/settings/ad` + `POST /api/ad/test`, 41→44 rutas) como tarea
  #1 de su ronda en curso; su openapi todavía no la publica. Sin la ruta
  publicada no hay formulario honesto que construir — el merge de su ronda
  es el gatillo de AD-6+SET-1 (pantalla).
- **DISCORD no disponible esta sesión** (`DISCORD_WEBHOOK_URL` sin definir):
  sin notificaciones de inicio/cierre; no se reintentó (rondas 5-8).

## Decisiones de carrera registradas

- **Datos observados ≠ datos inventados** (ronda 3, vigente): la vista de
  Validación no dibuja una batería cuando el motor responde 501; Ruido marca
  «no disponible»; Informes no pinta cobertura sin `enabled:false`... La
  ronda 7 aplica el mismo contrato a AD: conector sin armar, postura no
  lista y flota ausente se declaran, nunca se sustituyen por ceros.
- **El árbol de grupos espera a la API de aristas** (ronda 7): la superficie
  AD expone snapshot y postura pero no las aristas de membresía; la vista
  muestra los caminos efectivos que el motor ya calcula y declara el límite.
- **Umbral de certificados propio y documentado** (ronda 7): el motor publica
  la fecha, no una política; aviso <30 días, crítico <7. Sin SLA inventado
  para latencias: tono neutro siempre.
- **El idioma es preferencia del navegador, nunca dato del motor** (ronda 6):
  ES por defecto; el texto que llega del motor (títulos, descripciones y
  remediaciones de los hallazgos AD) no se traduce jamás. Las entradas de
  diccionario nuevas (chrome de la vista) van en ES y EN con paridad tipada.
- **Pestañas, no pilas** (ronda 2): cada gráfica nueva va a la vista que le
  toca y ninguna duplica la decisión de otra; el clic de la matriz lleva a
  los escenarios; la postura AD vive en su propia vista, no en el Resumen.
- **REP-4 reutiliza `ChartCard`** (ronda 3, ampliado ronda 7): el donut y la
  tendencia del directorio usan el mismo marco (leyenda, tabla gemela);
  nada entra en la hoja de impresión.
- **Descargas de REP-1 con los bytes del motor** (ronda 2): excepción
  deliberada a «exportar en cliente» (ronda 4).
- **El asistente no duplica Equipos** (ronda 5): token y aprobaciones
  reutilizan `TokenEnrollment`/`PendingHosts`.
- **Paleta categórica cerrada** (ronda 6): cuatro tonos + «Otros»; el donut
  de severidades usa los cuatro tonos de severidad validados, no colores nuevos.
- Sin kill-switch de streaming (ronda 2, vigente): el fallback JSON ya
  degrada con proveedores sin streaming.

## Siguientes (por qué)

1. **AD-6 (ajustes AD) + SET-1**: en cuanto IMP-A publique la API
   (`GET/PUT /api/settings/ad` + `POST /api/ad/test`, anunciada como tarea #1
   de su ronda en curso): formulario con «probar conexión» y contraseña que
   se escribe pero nunca se muestra; pantalla
   General/Ingesta/AD/Integraciones/Notificaciones/Cuentas/Apariencia. El
   merge de su ronda es el gatillo.
2. **IDEA-10 fase 2, continuación del barrido**: la receta de la ronda 8 es
   mecánica (secciones de diccionario ES/EN + `useI18n` + ES byte-idéntico +
   tests de paridad). Cola: `alerts-view` y las demás vistas de datos en
   rondas separadas por tamaño; Directorio entra a la cola como las demás.
   Quedan fuera por depender de otros: `user-session`/`console-user`,
   `detectors-menu`.
3. **Campo de decisión de triaje** (petición MEDIA repetida a IMP-A):
   desbloquea el «falso positivo» real del flujo de triaje y los
   porcentajes FP del ruido.
4. **REP-3 (Descargas)**: superficies del sensor firmado, certificado de
   ingesta y guías; hoy sin rutas que las sirvan (IMP-A). El paso de
   certificado del asistente ya declara este hueco.
5. **Árbol de grupos privilegiados completo**: si la API AD expone aristas
   de membresía (petición a IMP-A), sustituir la tabla de caminos por el
   árbol prometido en el TODO.
6. **VIZ-4 tendencias reales / VIZ-5 mapa de flota**: series históricas y
   grupos/sedes de IMP-A (fase C).

## Coordinación vigente

- La ronda de IMP-A está FUSIONADA en mi rama (`f5ea4f3`): sus ficheros Go
  (`internal/ad`, `internal/api/ad.go`, `internal/secretfile`, openapi)
  quedan integrados; mis cambios siguen siendo solo consola y docs de carril.
- `globals.css`/`layout.tsx`/`entity-graph.tsx` siguen siendo de PUL-B; mis
  vistas consumen tokens (check_console_theme.py pasa en los dos temas).
- SEG-B no toca `web/console/src` en su ronda actual; mis ficheros de esta
  ronda (directory-view, directory.ts, platform-status, shell, dicts) no
  solapan con nada declarado por los otros carriles.
- La herramienta de capturas (`docs/assets/src/capture_console.mjs`) sigue
  siendo de PUL-B: no la toqué.

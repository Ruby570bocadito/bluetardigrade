# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 12 del nuevo ciclo, 2026-10-06)

- Rama `carril/implementacion-b` sobre la ronda 11 (`2c47271`); rondas 2-11
  entregadas (pestañas del panel, SIM-4, REP-1, informe de ruido, SIM-3, REP-4,
  enlace del informe de caso, IDEA-3 plantillas de incidente, IDEA-11
  asistente de primer arranque, IDEA-10 fases 1-2, AD-5, cierre de SET-3,
  SET-1 + AD-6).
- **Ronda 12 ENTREGADA: 2 LOW de SEG-A cerrados + barrido i18n de informes +
  idioma del informe exportado + cuotas v1.1 en Estado.**
  - **LOW 1 (SEG-A r10)**: la contraseña AD viaja VERBATIM (el trim solo
    decide si el campo viaja; el motor almacena y sondea tal cual y los
    espacios son legales en un bind). **LOW 2**: sonda de AD a 50 s en
    cliente (`AD_PROBE_BUDGET_MS`) para que el presupuesto de 45 s del
    motor sea alcanzable (abortar el fetch cancela su contexto). Tests
    fail-before/pass-after incluidos; SEG-A puede re-verificar.
  - **i18n informes (IDEA-10)**: `reports-view.tsx` (REP-1/REP-4),
    `report-panel.tsx` y `report-library.tsx` al diccionario (secciones
    `reports` y `socReport`; ES byte-idéntico, EN con paridad tipada).
    `INCIDENT_STATUS_LABEL`/`SEVERITY_LABEL` compartidos pasan a las
    secciones dict que los esperaban.
  - **Idioma del informe exportado**: el artefacto (MD/HTML del caso,
    informe SOC del analista y nombre de fichero) sigue el idioma de la
    consola (`lang`, 'es' por defecto); el vocabulario del artefacto vive
    en mapas por idioma EN LAS LIBS (`incident-report.ts`,
    `DECISION_LABELS`/export en `soc-report.ts`), severidades/estados/
    evidencias se toman del dict compartido; el texto del motor viaja
    verbatim; errores de lib siguen en ES (frontera intacta).
  - **SET-3 crece con el motor**: cuotas de admisión v1.1
    (`beacon_quota_rejected`, `threshold_quota_rejected`, caídas del
    anillo y `quota_top_hosts` peor-primero, tope 8) en sección propia
    «Cuotas por equipo» + filas de anillo en «Colas y correlación»;
    motor antiguo = «no publicado» (nunca 0). `platformStatus(stats,
    lang)` bilingüe en la misma pasada (mapa propio por idioma, ES
    byte-idéntico) — desvío benigno del orden del roadmap; **Directorio
    es el siguiente en la cola i18n**.
  - Verificación completa tras el último cambio: bun test 469/469, tsc,
    build, DOM 34/34 (fixture: ReportPanel/ReportLibrary envueltos en
    I18nProvider y pin ES re-aplicado tras el clear), navegador 23/23,
    axe 20/20, temas OK, CSP PASS. Sin cambios Go ni openapi.
- **Coordinación CSP**: los dos scripts inline de boot (tema de PUL-A/PUL-B e
  idioma de la ronda 6) van firmados con el nonce por petición del proxy;
  cualquier script inline nuevo del armazón necesita lo mismo.
- **DISCORD no disponible esta sesión** (`DISCORD_WEBHOOK_URL` sin definir):
  sin notificaciones de inicio/cierre; no se reintentó (rondas 5-12).

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
- **El artefacto exportado sigue al idioma de la consola** (ronda 12): el
  informe de caso y el informe SOC se generan en el idioma que el operador
  eligió para la consola (ES por defecto), con el vocabulario del artefacto
  en las libs (fuente única con las vistas) y el texto del motor verbatim;
  `<html lang>` y el fichero siguen. Los errores de validación de libs
  quedan en ES (frontera de las rondas 6-11).
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

1. **Barrido i18n — Directorio** (siguiente por tamaño, cola del plan de
   rondas 12-13): `directory-view.tsx` (~38 cadenas) con la misma receta;
   detrás, por tamaño: `scenario-view`, `alert-actions`, `fleet-parts`,
   `respond-view`, `noise-view`, `enroll-parts`. Quedan fuera por depender
   de otros: `user-session`/`console-user`, `detectors-menu`.
2. **AD-6 parte B / retícula de ajustes**: si IMP-A publica más campos o
   nuevas familias de ajustes (TEAM-2 cuentas, ingesta, integraciones),
   ampliar las secciones de Ajustes con la misma receta (estado honesto +
   solo campos cambiados).
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

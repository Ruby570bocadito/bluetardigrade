# Roadmap de continuidad — Implementación B

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza cada ronda.

## Estado actual (ronda 11 del nuevo ciclo, 2026-10-06)

- Rama `carril/implementacion-b` sobre la ronda 10 (`9d329f1`); rondas 2-10
  entregadas (pestañas del panel, SIM-4, REP-1, informe de ruido, SIM-3, REP-4,
  enlace del informe de caso, IDEA-3 plantillas de incidente, IDEA-11
  asistente de primer arranque, IDEA-10 fases 1-2, AD-5, cierre de SET-3).
- **Ronda 11 ENTREGADA: merge de IMP-A + SET-1 (pantalla Ajustes) + AD-6.**
  - Merge limpio de `origin/carril/implementacion-a` (`293be1d`, API de
    ajustes AD `GET/PUT /api/settings/ad` + `POST /api/ad/test`).
  - Vista nueva `ajustes` (SET-1): General / Ingesta / Active Directory /
    Integraciones / Notificaciones / Cuentas / Apariencia en una página.
    AD-6 con formulario real: solo viajan los campos cambiados, contraseña
    write-only, «Probar conexión» con veredicto por tipo, estados honestos
    501 (candidato: probar sí, guardar no) / 403 / 409 con frases del motor
    verbatim. Secciones sin API de escritura declaran su hueco y muestran
    la señal real (alta, almacén, contadores de entrega, sesión).
  - Registro completo (unión, CONSOLE_VIEWS, destinos, atajo `g j`, icono
    Gear, diccionarios ES/EN con paridad tipada; ES byte-idéntico). 463/463
    tests (12 de la lib nueva + 2 de fase 5), tsc/build limpios, DOM 34/34,
    navegador 23/23, **axe 20/20** (la batería cubre `ajustes` dark+light;
    2 hallazgos 2.5.3 corregidos), temas OK, CSP PASS. Motor fusionado:
    build/gofmt/vet/race (`-count=1`) en `internal/api` + `internal/ad`,
    openapi 43 rutas, inventario 114 reglas, workflows OK.
  - Helpers de notificación (`currentPermission`, `playNotifyTone`) movidos
    a `lib/alert-notify.ts` para compartirlos con la página de ajustes; el
    cascabel de la ronda 8 no cambia de comportamiento.
- **Coordinación CSP**: los dos scripts inline de boot (tema de PUL-A/PUL-B e
  idioma de la ronda 6) van firmados con el nonce por petición del proxy;
  cualquier script inline nuevo del armazón necesita lo mismo.
- **DISCORD no disponible esta sesión** (`DISCORD_WEBHOOK_URL` sin definir):
  sin notificaciones de inicio/cierre; no se reintentó (rondas 5-11).

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

1. **Barrido i18n de informes**: `report-library` (REP-1) y decidir el
   idioma del informe de caso exportado (`lib/incident-report.ts`) en la
   misma ronda; después las demás vistas de datos por tamaño (Directorio
   entra como las demás). Quedan fuera por depender de otros:
   `user-session`/`console-user`, `detectors-menu`.
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

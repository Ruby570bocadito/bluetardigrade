# Plan de ronda — Implementación B (2026-10-06, ronda 11)

Base: `9d329f1` (ronda 10 publicada). `DISCORD_WEBHOOK_URL` sin definir en este
entorno (rondas 5-10): sin notificaciones. **AD-6 + SET-1 DESBLOQUEADAS**: IMP-A
publicó su ronda (`c357cc8..293be1d`) con `GET/PUT /api/settings/ad` +
`POST /api/ad/test` (openapi 41→44 rutas; puerta `-api-write`, 403 ruidoso,
auditoría por cambio, contraseña write-only que nunca se sirve).

1. **Merge de `origin/carril/implementacion-a`** en `carril/implementacion-b`
   (su punta `293be1d`); lectura de `internal/api/ad_settings.go`,
   `internal/ad/config.go`, openapi y su informe de ronda para conocer los
   campos exactos (contraseña NUNCA en la respuesta; horario laboral
   work_start/work_end/work_days para AD-3).
2. **SET-1: vista «Ajustes»** con secciones: General, Ingesta, AD,
   Integraciones, Notificaciones, Cuentas y Apariencia.
   - **AD (AD-6)**: formulario real contra la API nueva: config efectiva,
     «Probar conexión» (`POST /api/ad/test`, sin guardar), guardado
     (`PUT /api/settings/ad`), contraseña que se ESCRIBE pero NUNCA se
     muestra (campo vacío = sin cambio; la respuesta nunca la trae), 409 de
     deriva y 403 de puerta declarados con estado honesto.
   - Secciones sin API de escritura (General/Ingesta/Integraciones):
     estado honesto — se muestra lo que el motor publica (lectura) y se
     declara que aún no hay escritura; nada inventado.
   - Notificaciones: preferencias locales del notificador de críticas
     (ronda 8) expuestas en su sitio.
   - Cuentas: lo que el servicio de consola publica hoy (quién entra, rol
     efectivo; el asistente ya lo declara); sin pantallas de gestión que no
     existan.
   - Apariencia: tema e idioma en su sitio (mismas preferencias locales).
3. Registro de la vista nueva: union de vistas, shell (nav/paleta/atajo),
   url-state y diccionarios ES/EN (paridad tipada; ES byte-idéntico).
4. Verificación completa tras el ÚLTIMO cambio: bun test, tsc, build, DOM,
   navegador, axe (2 temas), temas, CSP; Go (build/vet/race) en los
   paquetes fusionados que toca el merge.
5. Informe `ronda_2026-10-06_11h30_B.md`, roadmap, `changelog.d/`,
   merge-tree contra las cinco puntas, push.

No toco: motor más allá del merge (IMP-A), sensor, CI/Makefile (PUL-A),
`globals.css`/`layout.tsx`/`entity-graph.tsx` (PUL-B), ficheros compartidos.

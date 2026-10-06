# Plan de ronda — Seguridad B (ronda 13, verificación fuera de cuota, 2026-10-06)

El fetch de apertura trajo movimiento en LAS CINCO lanes: IMP-A
publicó la entrega mayor AD-6/SET-1 (API de ajustes del conector AD,
2105 líneas: `internal/api/ad_settings.go`, `internal/ad/settings.go`)
más supresiones condicionales, known-software y el cierre de los 2
hallazgos de SEG-A r11 que yo confirmé; PUL-A publicó su ronda 13
(pre-flight de fusión: declara ERRÓNEA su observación de ronda 12
sobre MI Makefile y la cierra con corrección); PUL-B cerró su ventana
con source maps de navegador en producción; SEG-A publicó su ronda 15;
IMP-B movió i18n. main sigue `35cd866`.

1. **Verificar el cierre de mis hallazgos confirmados** (`4a445aa`):
   score de postura servido (MEDIA) y lecturas bajo cerrojo (BAJA) —
   diff + test fail-before/pass-after + firma de `Posture()`.
2. **Auditoría AD-6/SET-1** (superficie admin nueva): sobre SEC-2
   (escritura-sin-lectura, cero en buffer, jamás en log/YAML), el
   transporte LDAP compartido (pool CA de la organización, ServerName
   fijado, suelo TLS 1.2, sin InsecureSkipVerify), validación antes de
   disco, commit atómico 0600, drift 409 por sha256, hot-swap fuera
   del camino de petición, auditoría por nombres de campo, y el
   diseño del probe (`/api/ad/test`: qué credencial viaja a qué
   servidor cuando el cuerpo omite el password).
3. **Lectura ligera de supresiones condicionales y known-software:**
   dirección de fallo (visible vs silencio), caps, operator cerrado,
   honestidad de los efectos (sin borrado de eventos).
4. **Pre-flight propio ronda 13** (método de PUL-A, adoptado): mi tip
   con el Makefile adoptado (`a04379b`) contra las 5 tips nuevas —
   merge-tree + guardia de tabs SOBRE el Makefile fusionado + ci.yml.
   Registrar la corrección de PUL-A (su §2a) y el resultado con las
   lanes que traen los targets console-a11y/lighthouse.
5. **PUL-B:** source maps en producción (¿expone algo fuera del
   perímetro ya verificado del proxy?), corrección de su registro
   (favicon→BP real), incidente stale-server (solo método).
6. Cierre: informe ronda_2026-10-06_09h18_B.md, roadmap, pre-check,
   push con el token efímero del responsable (protocolo de memoria;
   si la credencial ya no vive en esta sesión: trabajo local y
   bloqueo declarado). Sin changelog (verificación, sin cambio
   visible mío).

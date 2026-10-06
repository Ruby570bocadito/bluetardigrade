# Plan de ronda — Seguridad B (ronda 15, verificación, 2026-10-06)

El push de las rondas 13-14 SALIÓ con la credencial facilitada
(`b670e5f..abd812f`, verificado con ls-remote). El fetch posterior
trajo IMP-B `9d329f1..2c47271`: absorbió el engine AD-6 de IMP-A
(merge) y publicó LA PANTALLA de ajustes AD (`2c47271`, settings-view
681 líneas + settings.ts 243) — la puerta de reapertura que registré
en mi ronda 14.

1. **Auditoría de la pantalla AD-6/SET-1 (IMP-B):** contraseña
   write-only en el cliente (¿solo estado React, type=password,
   autoclear, sin localStorage/URL?), constructor de payloads (solo
   campos dirty; numéricos inválidos bloquean), fases honestas
   403/501, recarga pendiente/error reflejados, doble-submit.
2. **El botón «Probar conexión» contra mi observación informativa
   (rondas 13-14):** ¿confirma el envío de la credencial almacenada
   cuando el operador editó server/port y dejó el password vacío?
   Localizar el punto exacto del fix si falta.
3. Informe ronda_2026-10-06_10h1X_B.md + roadmap; precheck; push con
   la misma credencial (protocolo de memoria, salida redactada);
   worklog. Recordatorio de revocación al cerrar sesión.

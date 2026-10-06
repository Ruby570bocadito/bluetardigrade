# Plan de ronda — Seguridad B (ronda 14, verificación fuera de cuota, 2026-10-06)

El fetch de apertura (sin credenciales — mis dos commits de la ronda
13 SIGUEN locales, push bloqueado) trajo DOS lanes movidas: SEG-A
publicó su ronda 16 con UN hallazgo NUEVO (MEDIA) sobre el hot-swap
de AD-6 que yo audité LIMPIO en mi ronda 13, e IMP-B publicó su
ronda 10 (i18n de incidentes; declara AD-6 desbloqueada para su
ronda 11).

1. **Verificación independiente del hallazgo SEG-A (MEDIA,
   hot-swap no serializado):** lectura propia de `adReloadAsync`
   (internal/api/ad_settings.go) y del bookkeeping `current` de
   `reconfigure` (cmd/engine/run.go ~l.613) en la tip de IMP-A; sin
   Go en este sandbox, la verificación es estructural (topología
   goroutine vs defer Unlock). Si se confirma: CORRECCIÓN PÚBLICA de
   mi veredicto §2 de la ronda 13 (misma lección que mi ronda 9).
2. **Verificación de la promesa anti-forja** que SEG-A declara en
   known-software (`enricher.Apply` borra las claves engine-owned,
   `known_software` incluida, antes de aplicar las suyas).
3. **IMP-B ronda 10:** barrido i18n de incidentes (spot-check
   innerHTML/eval en el delta) y registro de su desbloqueo AD-6
   (mi observación informativa sobre el botón «Probar conexión» es
   oportuna para su pantalla).
4. Precheck de mi tip docs contra las tips nuevas (¿matriz nueva?).
5. Cierre: informe ronda_2026-10-06_09h3X_B.md, roadmap, intento de
   push (si la credencial no vive: local + bloqueo reiterado),
   worklog.

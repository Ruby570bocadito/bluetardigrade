# Plan de ronda — Implementación B (2026-10-06, ronda 12)

Base: `2c47271` (ronda 11 publicada). Leído al abrir: IMP-A publicó
(`60a63a3..48b81f8`) el hot-swap AD-6 serializado — el PUT ya resuelve el
swap (`reload_pending` siempre false; resultado en `last_reload_at/error`),
mis cadenas `settings.ad.reloadError/reloadPending` ya dicen exactamente eso,
la vista no cambia. SEG-A r10 dejó 2 LOW contra mi SET-1: contraseña
recortada en cliente vs verbatim del motor, y sonda 30 s en cliente vs 45 s
de presupuesto del motor. PUL-B toca next.config.ts/Makefile/README; SEG-B
solo verifica: sin solape con mis ficheros. `DISCORD_WEBHOOK_URL` sigue sin
definir: sin notificaciones (rondas 5-12).

1. **Cerrar los 2 LOW de SEG-A r10** (`lib/settings.ts` + tests): la
   contraseña viaja VERBATIM (el trim solo decide si el campo viaja, nunca
   muta lo enviado) y la sonda pasa a 50 s en cliente (el motor
   presupuesta 45 s; abortar antes lo hace inalcanzable).
2. **Barrido i18n de informes (compromiso del roadmap)**:
   `reports-view.tsx` (REP-1/REP-4, ~44 cadenas), `report-panel.tsx` (11),
   `report-library.tsx` (3) al diccionario (ES byte-idéntico; EN con
   paridad tipada). `INCIDENT_STATUS_LABEL`/`SEVERITY_LABEL` compartidos
   pasan a las secciones dict ya existentes (`incidents.statusLabels`,
   `alerts.sevLabels`), que esperaban esta ronda.
3. **Decisión de idioma del informe de caso exportado** (`lib/
   incident-report.ts` + export de `lib/soc-report.ts`): el artefacto
   sigue el idioma de la consola (parámetro `lang`, 'es' por defecto — la
   regla de ronda 6: el idioma es preferencia del operador, nunca dato del
   motor); el vocabulario del artefacto vive en mapas por idioma EN LA LIB
   (fuente única para vista y export); el texto del motor viaja verbatim;
   `<html lang>` y el nombre de fichero siguen al idioma elegido. Los
   errores de validación de lib quedan en ES (frontera de las rondas 6-11).
4. **SET-3: los campos nuevos de /api/stats que IMP-A publicó** (cuotas
   por equipo v1.1 y caídas del anillo: `beacon_quota_rejected`,
   `threshold_quota_rejected`, `ring_dropped_events`,
   `ring_dropped_alerts`, `quota_top_hosts`) entran en
   `lib/platform-status.ts` + vista; la página prometió añadirlos «en
   cuanto existan». Barrido i18n de la vista en el mismo paso (tocarla dos
   veces sería desperdicio). Declarado como desvío benigno del orden del
   roadmap (Directorio queda para la siguiente).
5. Verificación completa tras el ÚLTIMO cambio (bun test, tsc, build, DOM,
   navegador, axe, temas, CSP; merge-tree contra las cinco puntas), informe
   `ronda_2026-10-06_14h15_B.md`, roadmap, `changelog.d/`, push.

No toco: motor (IMP-A), sensor, CI/Makefile (PUL-A), `globals.css`/
`layout.tsx`/`entity-graph.tsx` (PUL-B), `next.config.ts` (PUL-B esta
ronda), TODO.md/PLAN-DETALLADO/CHANGELOG, openapi.

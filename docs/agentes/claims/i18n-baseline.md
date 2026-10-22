# claim: i18n-baseline

- ID: IMP-2
- Fecha: 2026-10-22 (ronda 8)
- Tarea: continuación natural de i18n-fechas — la tarjeta «Línea base de
  procesos» (baseline-card, ficha de equipo) nunca pasó por IDEA-10:
  títulos, estados, filtrado, errores y baselineStatus (lib/intel) están
  en español duro. Barrido completo con el precedente enrollmentPlan/
  runModeText: BaselineStatusWords tipado con copia ES por defecto en
  baselineStatus (los tests existentes no cambian de resultado), sección
  baseline en ambos diccionarios, la tarjeta lee del dict y pasa lang a
  sus fechas. Test nuevo en intel.test.ts con palabras EN para fijar la
  firma bilingüe.
- Rutas que voy a tocar:
  - web/console/src/lib/intel.ts (BaselineStatusWords + firma)
  - web/console/src/components/console/baseline-card.tsx (dict + lang)
  - web/console/src/lib/i18n/dict-es.ts, dict-en.ts (sección baseline)
  - web/console/src/lib/intel.test.ts (caso EN)
  - changelog.d/console-i18n-baseline.md (NUEVO)
  - docs/agentes/estado/IMP-2.md
- Verificación: bun test, tsc --noEmit, next build + checks de tema,
  DOM, navegador, a11y y motion.
- Sin solape: claims/ vacío a esta hora; nadie toca web/.

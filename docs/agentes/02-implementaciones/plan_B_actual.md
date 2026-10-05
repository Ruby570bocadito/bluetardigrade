# Plan de ronda — Implementación B (2026-10-05 ~19h30, ronda 6)

- Tarea del TODO: **IDEA-10 Idiomas (fase 1: «el armazón bilingüe»)** —
  infraestructura i18n (diccionarios ES/EN con paridad tipada, provider con
  persistencia validada en localStorage y sync multipestaña, `lang` de
  `<html>` antes del primer pintado) y migración del armazón: navegación,
  paleta, hoja de atajos, alternador de tema/idioma y asistente de primer
  arranque. Las vistas de datos siguen en español; la receta de migración
  queda documentada en el roadmap para las siguientes rondas.
- Ficheros: nuevos `web/console/src/lib/i18n/` (núcleo + dict-es + dict-en +
  test de paridad), `i18n-provider.tsx`, `language-toggle.tsx`; cambios en
  `console-commands.ts` (catálogo construido desde el diccionario, búsqueda
  parametrizable), `shell.tsx`, `command-palette.tsx`, `shortcuts-help.tsx`,
  `theme-toggle.tsx`, `onboarding-wizard.tsx`, `layout.tsx` (boot del `lang`)
  y `page.tsx` (provider).
- Por qué: AD-5/AD-6, SET-3, REP-3, SET-1 y la vista «Forense» siguen
  bloqueadas por código de IMP-A (verificado con fetch: IMP-A solo publica
  plan `2c32013`); IDEA-5 (Sigma en consola) necesita API de escritura de
  reglas que no existe. IDEA-10 es la única desbloqueada del roadmap; el
  riesgo de solape con SEG-B se re-verificó: su ronda 4 toca solo
  `web/console-service` (hub/analyst), no `web/console/src`.
- Diseño: el ES es la fuente de la verdad y reproduce byte a byte los textos
  actuales que las baterías fijan (`Puesta en marcha`, `Comandos de la
  consola`, `Atajos de teclado`, `Buscar comandos`); el EN tipado como
  `Dict` garantiza paridad en compilación y un test la re-verifica. Los
  textos que vienen del motor (hints, nombres de regla, `enroll.hint`) no se
  traducen nunca. Sin datos inventados: el idioma es preferencia del
  navegador, no dato del motor.

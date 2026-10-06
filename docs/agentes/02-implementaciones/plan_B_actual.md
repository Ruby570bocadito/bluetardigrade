# Plan de ronda — Implementación B (2026-10-06, ronda 8)

- Tarea del TODO: **IDEA-10 fase 2, primer barrido de vistas** — las dos piezas
  pequeñas de la cola del roadmap: `noc-mode` (modo NOC completo: pantalla,
  diapositivas, controles, prosa de motor caído y titulares de las tres
  pantallas) y `critical-notifier` (menú de avisos, interruptores, avisos de
  permiso/almacenamiento y el texto de la notificación del navegador, hoy en
  la lib `alert-notify`).
- Cómo: secciones `noc` y `notify` nuevas en `dict-es.ts`/`dict-en.ts` con
  paridad tipada (compilación + paseo del test); `useI18n()` en ambos
  componentes; `notificationText(fresh, phrases)` pasa a recibir las frases del
  diccionario (lib pura, ES byte-idéntico); el formateo de números del NOC
  sigue el idioma activo (es-ES / en). El texto del motor (reglas, hosts,
  resúmenes) sigue sin traducirse.
- Ficheros: `noc-mode.tsx`, `critical-notifier.tsx`, `lib/alert-notify.ts`
  (+test), `lib/i18n/dict-es.ts`, `lib/i18n/dict-en.ts`, `lib/i18n/i18n.test.ts`.
- Por qué: AD-6/SET-1 y el campo de decisión de triaje siguen bloqueados en
  IMP-A (sin API de ajustes ni campo publicado; su plan repetido lo confirma) y
  REP-3 sin rutas que sirvan los ficheros. La fase 2 de i18n es la primera
  prioridad desbloqueada del roadmap y no solapa con nadie: PUL-B mantiene
  globals/layout/entity-graph, SEG-B va de `console-service`, PUL-A/SEG-A de Go.
- Verificación: `bun test`, `tsc --noEmit`, `bun run build`, baterías DOM,
  navegador, temas, a11y y CSP tras el último cambio de código; el motor no se
  toca.

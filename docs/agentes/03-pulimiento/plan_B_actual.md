# Plan de ronda — Pulimiento B (2026-10-06, 08h50 Madrid, ronda 5)

Base: `carril/pulimiento-b` `173ac11` + merge de `origin/main` (`35cd866`,
solo dependabot go.mod/go.sum). Carril al día: rondas 1-4 cerradas (tema,
zinc, kit de pestañas, POL-12/POL-10, axe/Lighthouse).

## Tareas cogidas

1. **CSP por nonce en la consola** (asignación de SEG-B, §7 de
   `docs/MODELO-DE-AMENAZAS.md`; mi roadmap, cola 1): fuera
   `script-src 'unsafe-inline'` del build de producción. Nonce por
   petición en `src/proxy.ts` (Next 16 lee la cabecera de petición y
   firma su bootstrap), `'strict-dynamic'`, el script de arranque del
   tema lleva `nonce` en `layout.tsx` (único inline del árbol), la CSP
   estática sale de `next.config.ts` (dos cabeceras se intersecan: la
   deja solo el proxy) y dev conserva `unsafe-inline`/`unsafe-eval`.
   Sin cambio de comportamiento: baterías de navegador/DOM/axe y un
   aserto nuevo de cabecera lo verifican.
2. **Manifest del tooling a11y** (nota menor de SEG-B, ronda 7):
   `tools/console-tests/package.json` + lockfile comprometidos con
   versiones exactas (playwright/axe-core), excepción en `.gitignore`,
   cabecera de `check_console_a11y.mjs` actualizada. Sin
   `postinstall` (guard SEC-6).
3. **Guardia THEME-2 sobre la ronda i18n de IMP-B** (solo lectura en su
   rama, `9f35615`): azules crudos, literales fuera de tokens o drift de
   contraste en los ficheros del armazón que tocaron
   (`theme-toggle.tsx`, `shell.tsx`, `layout.tsx`); hallazgos al informe
   para el momento de la fusión.

## No toca

`charts/*` y vistas de datos de IMP-B (su barrido i18n y las vistas AD
que les desbloqueó el push de IMP-A: 21h48); POL-7 y el aria de gráficas
siguen esperando ventana con IMP-B; `web/console-service` (SEG-B); Go,
sensor, scripts (intactos esta ronda).

## Coordinación

- Choque declarado potencial: `layout.tsx` — IMP-B añade el boot de
  `lang` a ese fichero en su ronda 6 (no fusionada). Mi cambio ahí es
  mínimo (async + `nonce` en los inline); al fusionar, su boot de `lang`
  necesitará el mismo `nonce`: anotado en el informe para el responsable.
- PUL-A ya enganchó `check_console_theme.py` al CI (16h41): mi propuesta
  restante (axe nocturno con Chromium) queda en su cola.

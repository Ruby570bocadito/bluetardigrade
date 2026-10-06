# Roadmap B — carril Pulimiento B (archivo vivo)

Última actualización: 2026-10-06, ronda 6 de este carril sobre la rama
`carril/pulimiento-b` (base `d458fae`, plan `24c8b08`).

## Hecho (rondas cerradas)

- **2026-10-05 — Tema claro/oscuro de la consola (THEME-1/2/3 ronda 1):**
  paleta clara completa en `globals.css` (remap de rampa zinc bajo
  `html.light`, reversa de hairlines blanco-alfa, tokens viz/severidad/
  estados claros), script de arranque sin destello en `layout.tsx`,
  `lib/theme.ts` + tests, `ThemeToggle` en la cabecera con persistencia
  y sincronía de pestañas, `dot-grid` y `entity-graph` leyendo vars por
  tema, botones primarios a blue-600 (AA 5.2:1), checker
  `scripts/dev-tests/check_console_theme.py`, CSS duplicado de
  scrollbar/`::selection` eliminado y README de la consola corregido y
  documentado. Verificación: 255/255 bun tests, tsc OK, build OK,
  34/34 DOM. Informe: `ronda_2026-10-05_12h37_B.md`.
- **2026-10-05 — Familia de tokens de acento + cierre THEME (ronda 2):**
  71 utilidades `blue-*` de 21 ficheros migradas a la familia
  `--primary*` (base/link/soft/tint/strong) con continuidad exacta de
  color en ambos temas; NOC siempre oscuro bajo tema claro (levanta
  `light` de `<html>` mientras está montado, re-resuelve al salir);
  selector de 3 estados sistema/claro/oscuro con seguimiento vivo del
  SO; popovers de cabecera como `role="dialog"` no modal (POL-8);
  baseline de bundle en el README (POL-9); checker a 87 checks. 256/256
  tests, tsc OK, build OK, 34/34 DOM. Informe:
  `ronda_2026-10-05_13h35_B.md`.
- **2026-10-05 — Acento zinc, kit de pestañas, POL-12 y POL-10 (ronda 3):**
  familia `--primary*` a zinc en los dos temas (oscuro zinc-300/600,
  claro zinc-800, AA validado), las 6 clases `blue-*` crudas a roles de
  token y **shim `--color-blue-*` retirado** (cero azules en
  `web/console/src`, grep limpio); cromo pintado con azul (icon-tile,
  ambient-glow, star-border, selection, scrollbar, ring, pulso de
  DotGrid, halo de grafo/spotlight) a variables por tema
  (`--sb-accent`, `--accent-halo`, `--dot-grid-pulse-rgb`); kit de
  pestañas compartido `ui-tabs.tsx` (base de POL-7) con flechas y
  roving tabindex en Detección, aplicado a «Añadir equipos» y al
  segmento En vivo/Histórico; densidad del Panel (`items-start` bajo
  «Alertas recientes»); SECURITY.md sin referencias internas muertas ni
  vocabulario de carriles; README con vista Estado, nueve vistas, árbol
  con `tools/` y `changelog.d/`; 14 capturas regeneradas a 2× sobre la
  consola zinc (héroe oscuro+claro, pestañas en ambos temas, Estado
  nuevo) con `capture_console.mjs` ganando modo de fixtures
  contractuales sin Go. **371/371 bun tests, tsc OK, build OK, 89/89
  theme checks, 34/34 DOM, 21/21 Chromium** (primera corrida local
  posible). Informe: `ronda_2026-10-05_16h40_B.md`.
- **2026-10-05 — POL-8 axe y POL-9 Lighthouse (ronda 4):** guard nuevo
  `check_console_a11y.mjs` (axe-core WCAG 2.x, 18 cargas: todas las
  vistas, cinco también en claro, fixtures contractuales) — **18/18
  limpio** tras 17 correcciones: `--color-zinc-500` oscuro a `#93939a`
  (era 4.12:1; checker a 93 checks con los pares del nivel), texto real
  zinc-600 → zinc-500 (18 nodos, 12 ficheros), `dl` de Estado y de la
  tarjeta de sensor a un solo `div` de agrupación (186 nodos
  `definition-list`/`dlitem`), texto real para lectores en BlurText/
  DecryptedText (`sr-only` + animación `aria-hidden`, fuera el
  `role="text"` inválido) y `tabIndex`+etiqueta en los tres feeds
  desplazables. Lighthouse desktop medido y documentado: Panel
  **95/100/96/100** (FCP 0.4 s, LCP 1.5 s, TBT 20 ms, CLS 0.02),
  Alertas **100/100**; targets `console-a11y` y `console-lighthouse` en
  el Makefile (que tiene un defecto pre-existente de espacios vs tabs,
  anotado a PUL-A). **371 tests, tsc, build, 93 theme checks, 34 DOM,
  21 Chromium, 104 console-service: todo verde.** Informe:
  `ronda_2026-10-05_17h35_B.md`.
- **2026-10-06 — CSP por nonce, manifest del tooling, guardia i18n (ronda 5):**
  CSP de la consola acuñada por petición en `src/proxy.ts` (nonce +
  `strict-dynamic` en producción; la estática salió de `next.config.ts`
  porque dos CSP se intersecan), boot de tema firmado vía `x-nonce` en
  `layout.tsx` asíncrono, guard nuevo `check_console_csp.mjs` (nonce
  presente, rotatorio y en todos los scripts; apto para CI),
  manifest+`bun.lock` del tooling de pruebas comprometidos en
  `tools/console-tests` (playwright/axe/esbuild/jsdom exactos, SEC-6
  verde, `.gitignore` con excepción quirúrgica que preserva el
  `tools/config/` del instalador), guardia THEME-2 sobre la ronda i18n
  de IMP-B sin hallazgos. **371 tests, tsc, build, 21/21 navegador,
  34 DOM, 18/18 axe, tema OK, ciclo de vida OK.** Informe:
  `ronda_2026-10-06_09h05_B.md`.
- **2026-10-06 — POL-11 reduced-motion reactiva y POL-9 Lighthouse
  re-medido (ronda 6):** auditoría completa de microinteracciones — el
  gate de tres capas ya estaba completo y los 10 consumidores de
  `motion/react` gatean con `useReducedMotion()`; hallazgo: `dot-grid`
  y `decrypted-text` leían la preferencia una sola vez al montar —
  ahora reactivos (activar `reduce` con la sesión abierta desmonta el
  bucle del canvas y corta el ciclo de glifos; `count-up` recorta el
  muelle con `jump`, `animated-list` cierra el caso con `duration: 0`);
  guard nuevo `check_console_motion.mjs` (con preferencia emulada
  ninguna animación no-spinner corre; control positivo sin la
  preferencia: la sonda anima — no pasa en vacío); gráficas de IMP-B
  auditadas sin hallazgos (solo lectura). Lighthouse desktop re-medido
  tras el nonce: Panel **97/100/96/100** (LCP 1.2 s) y Alertas
  **100/100/96/100** — sin coste medible; README con before/after, la
  advertencia del `next-server` residual en el 3100 (invalidó la
  primera medición) y la tabla de primitivas corregida a las 11 reales
  (`gradient-text` ya no existe). **371 tests, tsc, build, tema OK,
  CSP OK, motion PASS, 34 DOM, 18/18 axe, 21/21 navegador, ciclo de
  vida OK.** Informe: `ronda_2026-10-06_10h20_B.md`.

## A medias

- **POL-8/9:** aria de gráficas (fichero de IMP-B) y enganche de los
  checks axe/CSP/motion en `ci.yml` (proponer a PUL-A). axe, CSP,
  motion y Lighthouse ya corren localmente; el CI nocturno puede
  tomarlos con Chromium.
- **Makefile:** recetas con 8 espacios en vez de tabs — `make` falla en
  todos los targets (pre-existente, área de PUL-A; su rama ya toca el
  Makefile — confirmar al fusionar que los targets `console-*`
  sobreviven).
- **Fusión con la ronda de IMP-B:** el reto del `langBoot` sin nonce
  quedó **resuelto por IMP-B** (su informe cubre la reconciliación
  CSP). Queda solo la nota del kicker `text-zinc-500` si la zona de la
  nav móvil de `shell.tsx` vuelve a tocararse (ronda 5, sección de
  conflictos).

## Siguiente (orden propuesto)

1. POL-7 kit de componentes restante (botón, campo, tabla, insignia y
   diálogo con variantes) — exige coordinar ventanas con IMP-B (sus
   vistas, ahora desbloqueadas por el push de IMP-A: AD-5/AD-6, SET-3,
   REP-3): proponerlo en su roadmap antes de cogerlo.
2. POL-8: aria/gemelo de tabla de las gráficas (fichero de IMP-B,
   coordinar con su barrido i18n de vistas de datos).
3. Revisar las rondas nuevas de IMP-B (vistas AD, barrido i18n) con el
   pase barato de guardia: azules crudos, contraste fuera de tokens,
   hallazgos axe.
4. Propuestas a PUL-A: enganchar `check_console_csp.mjs` (barato, sin
   navegador) y `check_console_a11y.mjs` / `check_console_motion.mjs` /
   `console-lighthouse` (con Chromium) al CI; este bloque necesita la
   corrección de tabs del Makefile.
5. Si el responsable define POL-12 como tarea recurrente: nuevo pase de
   coherencia consola/README/SECURITY.md cuando IMP-B fusione vistas
   nuevas.

## Decisiones de ronda que conviene recordar

- El tema viaja por **una clase** en `<html>` (`html.dark`/`html.light`)
  + remap de la rampa zinc: no añadir variantes `dark:` por componente;
  si un color nuevo entra, va a tokens y al checker.
- **El acento es zinc ink, no tono:** cualquier superficie nueva que
  quiera «acento» consume `--primary*` (base/link/soft/tint/strong); un
  literal de color o un `*-blue-*`/`*-sky-*` decorativo rompe el pase
  THEME-2. Los azules de `--sev-low`/`--series-*`/`--seq-*`/`--chart-*`
  son DATO y no se tocan sin revalidar paleta.
- Las capas que pintan fuera de CSS (canvas/SVG) leen sus colores de
  vars por tema (`--dot-grid-ink`, `--dot-grid-pulse-rgb`,
  `--accent-halo`, `--sb-accent`) y repintan con `bt-themechange`.
- La clave de storage es `bt-theme`; el evento de repaint es
  `bt-themechange` (constantes en `lib/theme.ts`).
- La regla de tinta por celda de `attack-matrix`/`heatmap` (`s >= 3 →
  tinta oscura`) depende de que las rampas secuenciales sean monotónicas
  oscuro→claro: si se tocan los `--seq-*`, pasar el checker.
- **Las preferencias de movimiento son reactivas, no solo de montaje**
  (ronda 6): todo consumidor de `motion/react` usa `useReducedMotion()`
  (nunca `matchMedia` crudo), el canvas desmonta su bucle y las
  puertas CSS dan estado final estático. Los spinners son la única
  animación permitida bajo `reduce` (actividad, no decoración). El
  guard `check_console_motion.mjs` lleva control positivo a propósito:
  si algún día la sonda deja de animar sin preferencia, el gate está
  roto y el pase deja de ser válido.
- **Medir Lighthouse contra el build recién arrancado:** matar cualquier
  `next-server` residual en el 3100 antes de medir (un servidor viejo
  responde el readiness check con un manifest viejo y puede servir
  chunks a 500 — invalidó la primera medición de la ronda 6).
- La paridad de dE entre temas tiene tolerancia 5.0 (documentada en el
  checker): lo vinculante son los suelos absolutos por tema.
- El checker tiene 93 checks (ronda 4 añadió los pares del nivel de
  texto `--color-zinc-500`): los pares del acento incluyen ya la
  etiqueta blanca sobre el hover sólido (`--primary-tint`).
- Las capturas del README se regeneran con
  `docs/assets/src/capture_console.mjs`: laboratorio real por defecto o
  `CONSOLE_CAPTURE_FIXTURES=1` sin Go; hosts `LAB-*` y `source=simulate`
  para que el banner de demo de la consola quede visible en la captura.

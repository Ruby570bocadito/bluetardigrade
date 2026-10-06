# Roadmap B — carril Pulimiento B (archivo vivo)

Última actualización: 2026-10-06, ronda 15 de este carril sobre la
rama `carril/pulimiento-b` (base `32aafb4`, plan de ronda 15; rondas
9-15 publicadas al cierre de la sesión — credencial del responsable
por el canal askpass/`GH_TOKEN`).

## Hecho (rondas cerradas)

- **2026-10-06 — Reparación del Makefile en mi carril: TABs +
  --ignore-scripts (ronda 15):** confirmado el fail-before que
  publicó SEG-A (r17): `63fa077` dejó `make` roto en solitario
  (`missing separator` :31; 69 líneas de receta aplanadas a 8
  espacios, las 7 mías de console-a11y/lighthouse incluidas).
  Restaurados los TAB (contenido intacto; pass-after: los 20 targets
  `make -n` limpio y `make console-dom` verde end-to-end) y
  adoptado `--ignore-scripts` en las 6 líneas `npm install` de
  consola (decisión convergida PUL-A/SEG-B/SEG-A). Mi Makefile queda
  como superconjunto aditivo (a11y + lighthouse) y el conflicto
  residual de «7 recetas con espacios» que SEG-A anotó para PUL-B
  desaparece. merge-tree ×6: main/IMP-A/IMP-B limpio; PUL-A (5
  hunks), SEG-A (1 hunk = solo mis targets extra) y SEG-B (3 hunks)
  conflictúan SOLO en Makefile, resolución de convergencia (tomar el
  superconjunto + sanity `make -n`). Nota de laboratorio: el editor
  re-aplanó los TAB al guardar — la reparación se hizo con `sed`, no
  con el editor. Hallazgos de SEG-A sobre SET-1 (2 BAJA: trim de
  contraseña mutado; presupuesto de sonda 30 s cliente vs 45 s
  motor) añadidos al checklist de guardia para la próxima entrega de
  IMP-B. Informe: `ronda_2026-10-06_13h45_B.md`.

- **2026-10-06 — Guardia de vista nueva: pantalla de ajustes AD
  (ronda 13):** guardia completa sobre el árbol de IMP-B en `2c47271`
  (SET-1/AD-6, 681 líneas): grep azul 0, checker de tema verde,
  **463/463 tests**, build OK, **axe 20/20** (IMP-B extendió el roster
  con `ajustes` dark+light), CSP PASS (11 scripts). Lectura manual: el
  acento es 100% `--primary*`, formularios con label/grupos/
  aria-pressed/role=alert, contraseña write-only con
  `autoComplete="new-password"`. **Un hallazgo menor:** el resultado de
  «Probar conexión» sin `role="status"` (línea 624 de su fichero; el
  patrón ya existe en su banner de recarga) — su ronda o micro-fix
  post-integración. Motion no aplicable en su árbol (guard sin
  integrar allí aún). merge-tree ×5 limpio. Informe:
  `ronda_2026-10-06_12h55_B.md`.

- **2026-10-06 — POL-7 Fase A: insignia genérica (ronda 12):**
  `ui/badge.tsx` nuevo con la forma única de insignia/chip y solo dos
  variantes tokenizadas (`neutral`, `accent`); los colores de DATO
  (severidad, series) llegan por `className` desde sus mapas — la
  primitiva hace imposible un acento azul por accidente. `SeverityBadge`
  y `MonoTag` delegan en ella con colores intactos; `MonoTag` gana
  `title` en strings. Cero cambios en vistas. Batería completa en verde
  (371 tests, tsc, build, tema, 34 DOM, 21/21 navegador, 18/18 axe,
  motion, CSP) contra el build recién hecho tras matar un
  `next-server` residual del 3100 (trampa de la ronda 6, detectada
  antes de medir). merge-tree ×5 limpio. Informe:
  `ronda_2026-10-06_12h25_B.md`.

- **2026-10-06 — Guardia del tercer barrido i18n de IMP-B y lectura
  del `csvCell` de SEG-B (ronda 10):** `0380c89` traduce incidentes y
  planes de respuesta (642 líneas de consola): dif filtrado por azules
  → 0 adiciones; `className` solo re-indentación y sustituciones por
  diccionario, acento en tokens y rampa zinc intactas; su árbol completo
  verificado en worktree de lectura (grep azul 0, checker de tema
  verde). Cambio de consola de SEG-B (`csvCell` unificado con guard de
  fórmulas en `lib/chart-export`) leído sin hallazgos — deja lista la
  pieza de exportación que los gemelos de tabla de POL-8 reutilizan.
  merge-tree ×5 limpio, solapes sin cambio. **371/371 tests, tsc OK,
  tema OK en ambos árboles.** Informe:
  `ronda_2026-10-06_11h35_B.md`. Push de las rondas 9-10 pendiente de
  credencial en el entorno.

- **2026-10-06 — Cierre THEME-2 en TODO.md, guardia i18n de IMP-B,
  verificación de pestañas (ronda 9):** guardia THEME-2 repetida contra
  el árbol actual y contra los dos barridos i18n fase 2 de IMP-B (689
  líneas de consola revisadas): cero clases `blue-*`, los únicos
  hex azules que quedan son tokens de DATO (`--chart-1`, `--sev-low`,
  `--series-1`, `--seq-5`, remap `--color-sky-400`), familia
  `--primary*` zinc verificada en los dos temas y checker de tema en
  verde. THEME-2 cierra en `TODO.md` (tabla de estado «Casi»→«Hecho»,
  checklist marcada, prioridad de ronda 2 tachada) con fragmento
  `changelog.d/PUL-B-theme2-closure.md`. Densidad/aire de pestañas del
  panel verificada sin hallazgos (kit `ui-tabs` + cabecera del Panel
  intactos tras el barrido i18n). Pronóstico de fusión refrescado con
  `merge-tree --write-tree` (leyendo exit code): 0 conflictos contra
  las cinco ramas; solapes anotados con PUL-A (Makefile, README de
  dev-tests, theme checker) y SEG-B (Makefile, alert-actions),
  secciones distintas. **371/371 tests, tsc OK, tema OK.** Informe:
  `ronda_2026-10-06_11h10_B.md`.

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
- **2026-10-06 — Guardia sobre la ronda 7 de IMP-B y pronóstico de
  fusión (ronda 7, solo lectura):** pase de guardia sobre su árbol
  fusionado (AD-5 «Directorio» + SET-3 + label-in-name): cero
  hallazgos — los tres `sky-*` del árbol son DATA/estado pre-existente
  con remap claro documentado, la vista nueva no añade animaciones sin
  puerta, mi gate de `entity-graph.tsx` sobrevive a su retoque
  quirúrgico, el kicker `text-zinc-500` sobrevivió a la reconciliación
  de `shell.tsx` y ambos boots inline van firmados con el nonce;
  checker de temas en verde contra su árbol. Mi ronda 6 aún no está en
  su línea (llega hasta el plan `24c8b08`): merge-tree 0 conflictos,
  sin colisión prevista. Informe: `ronda_2026-10-06_10h45_B.md`.
- **2026-10-06 — POL-9 apéndice: source maps de navegador y corrección
  del registro (ronda 8, cierre de la ventana):** re-inspección del
  JSON de Lighthouse: el 96 de BP NUNCA fue el favicon (esa auditoría
  no existe en BP; el `<link rel="icon">` de `icon.svg` evita la
  petición) — eran `valid-source-maps` y `errors-in-console`. Fix:
  `productionBrowserSourceMaps: true` en `next.config.ts` (mapas solo
  se descargan con DevTools abierto; trazas simbolizadas para el
  operador; baseline de bundle intacta) — `valid-source-maps` pasa;
  `errors-in-console` es binaria y el laboratorio la genera por
  construcción (motor/console-service apagados), así que 96 es su
  techo aquí y desaparece con backend vivo. README corregido (párrafo
  Lighthouse + nota de mapas en la baseline). **371 tests, tsc, build
  con 8 mapas, tema, CSP, motion, 34 DOM, 18/18 axe, 21/21 navegador,
  ciclo de vida: verde.** Informe: `ronda_2026-10-06_11h05_B.md`.

## A medias

- **POL-8/9:** aria de gráficas (fichero de IMP-B) y enganche de los
  checks axe/CSP/motion en `ci.yml` (proponer a PUL-A). axe, CSP,
  motion y Lighthouse ya corren localmente; el CI nocturno puede
  tomarlos con Chromium.
- **Makefile:** recetas con 8 espacios en vez de tabs — `make` falla
  en todos los targets (pre-existente, área de PUL-A). **Reparación
  disponible:** SEG-B adoptó el parche de tabs en su carril (`a04379b`)
  junto con la paridad `--ignore-scripts`; al fusionar, confirmar que
  los targets `console-*` sobreviven.
- **Fusión con la ronda de IMP-B:** el reto del `langBoot` sin nonce
  quedó **resuelto por IMP-B** (su informe cubre la reconciliación
  CSP). Queda solo la nota del kicker `text-zinc-500` si la zona de la
  nav móvil de `shell.tsx` vuelve a tocararse (ronda 5, sección de
  conflictos).

## Propuestas abiertas a otros carriles (ronda 11)

### A IMP-B — POL-7 resto del kit, en dos fases

Inventario actual: `ui/button|input|select|switch` existen; pestañas
con `ui-tabs.tsx` (mío); `ui-bits.tsx` trae `SeverityBadge`,
`MonoTag`, `StatTile`, `SectionHeader`, `EmptyState`, `OfflineNotice`,
`SkeletonRows`, `LiveAnnouncer`; diálogos con `console-dialog.tsx` y
`header-popover.tsx`. De la lista POL-7 (botón, campo, tabla,
pestañas, insignia, diálogo) falta de verdad: **insignia genérica** y
**tabla compartida**.

- **Fase A (mi carril, sin tocar vistas):** `ui/badge.tsx` con
  variantes tokenizadas (severidad, estado, neutra) y
  `SeverityBadge`/`MonoTag` delegando en ella; cero cambios en las
  vistas, cero fricción con los barridos i18n. **Entregada en la
  ronda 12**; documentada en el README de la consola (ronda 14).
- **Fase B (ventana coordinada):** `ui/table.tsx` (superficie, cabecera
  pegajosa, ordenación, estado vacío) y migración progresiva de las
  tablas. **Inventario de la ronda 14** — seis tablas semánticas:
  `suppressions-view` (2 th, la más simple), `user-session` (5 th),
  `intel-view` (6 th), `live-feed` (6 th), `rules-view` (1 th) y
  `alerts-view` (8 th con sticky + selección de filas, la compleja, al
  final). `hosts-view`, `incidents-view` y `fleet-parts` son listas de
  tarjetas en grid, no candidatas al kit. Orden propuesto: de simple a
  compleja, empezando por supresiones; las gemelas de exportación de
  POL-8 reutilizan el `csvCell` de `lib/chart-export` (SEG-B). Toca
  exactamente los ficheros que
  su barrido i18n de fase 2 sigue barriendo, así que se proponen dos
  ventanas: (1) cuando acabe el barrido de vistas de datos, yo tomo la
  migración de tablas mientras ellos avanzan motor; o (2) vista a vista
  con reparto por ficheros, como hicieron con la reconciliación CSP.
  Regla fija: cualquier color nuevo entra por tokens y pasa el
  checker; los gemelos de tabla de POL-8 reutilizan el `csvCell`
  unificado de SEG-B (`lib/chart-export`).

### A PUL-A — CI de guards de la consola, dos jobs

Precondiciones ya resueltas: reparación de tabs del Makefile adoptada
por SEG-B (`a04379b`), manifest + `bun.lock` del tooling comprometidos
(mi ronda 5), `--ignore-scripts` (su `f830cc3`) con el tripwire de
esbuild de SEG-B (`3046716`).

- **Job 1 `console-static-guards` (sin Chromium, segundos):**
  `check_console_theme.py` (stdlib pura) y `check_console_csp.mjs`
  (Node, sin navegador). Barato, apto para cada push.
- **Job 2 `console-browser` (Chromium; por rutas de consola o
  nocturno):** build → `next start` **matando antes cualquier
  `next-server` residual del 3100** (lección de la ronda 6: un
  servidor viejo invalida las mediciones) → `check_console_a11y.mjs`
  (18 cargas), `check_console_motion.mjs` (con control positivo) y
  `console-lighthouse`. Instalaciones con `--ignore-scripts` y
  caché de navegadores de Playwright.

## Siguiente (orden propuesto para la próxima ventana)

0. **Checklist de guardia para la próxima entrega de IMP-B** (acumulado
   de guardias y avisos de otros carriles): el `role="status"` del
   probe (r13, línea 624 de su fichero); los 2 BAJA de SEG-A r17 —
   contraseña recortada en cliente vs verbatim en motor, y aborto de
   sonda a 30 s en cliente vs presupuesto de 45 s en motor (`50 s`
   propuesto); y los 2 persistentes de SEG-A desde su r5 — supresión
   con `host: ''` desde noise-view (silencia en toda la flota) y
   `generate` de reports-view sin guardia de vigencia.
1. Integración de mis rondas 6-8 en la línea de IMP-B: pendiente y
   limpia (merge-tree 0 conflictos); tras integrar, la batería de
   motion es candidata a correr en su línea (necesita Chromium).
   Desde la ronda 15 el Makefile de mi carril ya convergido (tabs +
   ignore-scripts): la integración arrastra el arreglo de `make` a
   la línea que toque main.
2. POL-7 kit de componentes restante (botón, campo, tabla, insignia y
   diálogo con variantes) — exige coordinar ventanas con IMP-B (sus
   vistas, ahora desbloqueadas por el push de IMP-A: AD-5/AD-6, SET-3,
   REP-3): proponerlo en su roadmap antes de cogerlo.
3. POL-8: aria/gemelo de tabla de las gráficas (fichero de IMP-B,
   coordinar con su barrido i18n de vistas de datos).
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

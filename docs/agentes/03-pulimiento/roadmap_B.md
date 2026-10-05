# Roadmap B — carril Pulimiento B (archivo vivo)

Última actualización: 2026-10-05, ronda 3 de este carril sobre la rama
`carril/pulimiento-b` (creada desde `origin/main` `a1bca4f`).

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

## A medias

- **POL-8/9:** axe en el CI del navegador, aria de gráficas (fichero de
  IMP-B) y Lighthouse. Chromium ya corre en este entorno (21/21 en la
  regresión): axe y Lighthouse son ahora viables localmente.

## Siguiente (orden propuesto)

1. **Ronda 4: pipeline de nonce para la CSP de la consola** (asignación
   de SEG-B, BAJA, diseño en §7 de su modelo de amenazas): tocará
   `next.config.ts`/headers con verificación de que el bootstrap de
   Next no rompe. Ronda entera dedicada.
2. Kit de componentes restante (POL-7): botón, campo, tabla, insignia y
   diálogo con variantes — exige coordinar ventanas con IMP-B (sus
   vistas): proponerlo en su roadmap antes de cogerlo.
3. POL-8: pase axe local sobre las vistas y aria/gemelo de tabla de las
   gráficas (fichero de IMP-B, coordinar).
4. POL-9: informe Lighthouse real y actualización de la baseline si
   cambia algo.
5. Proponer a Pulimiento A el enganche de `check_console_theme.py` en
   `ci.yml` (paso de 3 s, stdlib puro).
6. Proponer al responsable la definición de POL-12 como tarea de carril
   (pase de coherencia consola/README/SECURITY.md); esta ronda la
   interpretó y la ejecutó una vez.
7. Si IMP-B publica ronda con gráficas nuevas: revisar sus ficheros en
   busca de azules crudos o contraste fuera de tokens (mismo pase que
   esta ronda, ahora barato con el grep de acento).

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
- La paridad de dE entre temas tiene tolerancia 5.0 (documentada en el
  checker): lo vinculante son los suelos absolutos por tema.
- El checker tiene 89 checks: los pares del acento incluyen ya la
  etiqueta blanca sobre el hover sólido (`--primary-tint`).
- Las capturas del README se regeneran con
  `docs/assets/src/capture_console.mjs`: laboratorio real por defecto o
  `CONSOLE_CAPTURE_FIXTURES=1` sin Go; hosts `LAB-*` y `source=simulate`
  para que el banner de demo de la consola quede visible en la captura.

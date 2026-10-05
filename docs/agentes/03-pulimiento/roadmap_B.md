# Roadmap B — carril Pulimiento B (archivo vivo)

Última actualización: 2026-10-05, ronda 2 de este carril sobre la rama
`carril/pulimiento-b` (creada desde `origin/main` `5e168ba`).

## Hecho (rondas cerradas)

- **2026-10-05 — Tema claro/oscuro de la consola (THEME-1/2/3 ronda 1):**
  paleta clara completa en `globals.css` (remap de rampa zinc bajo
  `html.light`, reversa de hairlines blanco-alfa, tokens viz/severidad/
  estados claros), script de arranque sin destello en `layout.tsx`,
  `lib/theme.ts` + tests, `ThemeToggle` en la cabecera con persistencia
  y sincronía de pestañas, `dot-grid` y `entity-graph` leyendo vars por
  tema, botones primarios a `blue-600` (AA 5.2:1), checker
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

## A medias

- **THEME-2, dos usos crudos restantes:** los `text-blue-100` de
  `alert-actions` y `detection-hub` y los 2 `blue-*` de `dashboard.tsx`
  viven bajo el shim del remap claro. Los de `dashboard.tsx` se migran
  cuando IMP-B fusione su ronda 4 (su rama toca ese fichero); los
  `blue-100` requieren decidir si el rol merece token propio.
- **POL-8/9:** axe en el CI del navegador, aria de gráficas (fichero de
  IMP-B) y Lighthouse penden de host con Chromium (limitación del
  entorno, declarada en el repo).

## Siguiente (orden propuesto)

1. **Ronda 3: pipeline de nonce para la CSP de la consola** (asignación
   de SEG-B, BAJA, diseño en §7 de su modelo de amenazas): tocará
   `next.config.ts`/headers con verificación de que el bootstrap de
   Next no rompe. Ronda entera dedicada.
2. Tras la fusión de IMP-B ronda 4: migrar los 2 `blue-*` de
   `dashboard.tsx` y retirar el shim `--color-blue-*` de `html.light`.
3. Capturas del tour y pase visual del tema claro (incluido el NOC en
   claro) en un host con Chromium; ajustar `.ambient-glow`, sombras y
   `.star-border` si algo flojea.
4. Kit de botones compartido (POL-7): exige coordinar ventanas con
   IMP-B (sus vistas) — proponérselo en su roadmap antes de cogerlo.
5. Proponer a Pulimiento A el enganche de `check_console_theme.py` en
   `ci.yml` (paso de 3 s, stdlib puro).
6. Ampliar el checker con los chips rojos/verdes del topbar si siguen
   fuera de tokens.
7. Documentar la paleta clara en `docs/PALETA-Y-PRUEBAS-NAVEGADOR.md`
   tras las capturas reales (esa doc narra rondas, no la toco a ciegas).

## Coordinación (apéndice de la ronda 2026-10-05, post-fetch)

### Ronda 2 (13h35)

- **IMP-B ronda 4 cerrada (13h11):** heatmap hora×día y exportación
  CSV/SVG/PNG en `chart-frame.tsx`, `dashboard.tsx` y libs nuevas.
  Solape con mi ronda 2: **cero** (verificado con `comm`). Su nota «si
  tocas `.chip` o `--seq-*`, mis piezas se adaptan solas»: esta ronda
  no toca ninguna de las dos. Mi migración deja el shim `blue-*` de
  claro para sus 2 usos de `dashboard.tsx`.
- **SEG-B (12h33) asigna a este carril el pipeline de nonce CSP**
  (BAJA, §7 de su modelo): aceptado, ronda 3 entera para ello.
- **PUL-A / SEG-A:** sin solape ni ALTA para este carril.

### Ronda 1 (post-fetch)

Al terminar la ronda aparecieron en `origin` `carril/implementacion-b`
(rondas 1-3) y `carril/pulimiento-a` (rondas 1-6). Lectura de planes e
informes:

- **Sin solape de ficheros** con IMP-B ronda 3 (`lib/soc-metrics.ts`,
  `components/charts/line-chart.tsx` nuevo, `lib/risk-history.ts`
  nuevo, `dashboard.tsx`) ni con PUL-A ronda 6 (backend/CI/docs
  técnicos). Mis conjuntos son disjuntos: fusión limpia.
- **Nota de IMP-B (ronda 11h55, punto 5, para este carril):** el botón
  nuevo del panel de analista hereda `exportCls`; «si se repasa el
  contraste del tema claro, esos botones entran en el mismo pase».
  Cubierto por diseño esta ronda: heredan utilidades zinc/blue que el
  remap de `html.light` ya invierte y el checker valida los pares de
  token, no componente a componente. Confirmar en el pase visual con
  Chromium (pendiente general).
- **IMP-B deja constancia** de que el cambio de paleta a zinc puro es
  de este carril y que no tocó paleta. Coincide con el pendiente 2 de
  abajo (unificación `blue-*` → `--primary`): sigue en mi lista,
  coordinando ventanas para no pisar sus vistas.
- **PUL-A** no marca prioridades ALTA para este carril en sus informes
  revisados; el enganche de `check_console_theme.py` a `ci.yml` sigue
  siendo propuesta para su área.
- **SEG-B (ronda 2026-10-05, 12h33)** publicó `carril/seguridad-b` al
  cierre de esta ronda: auditoría CI de dependencias, modelo STRIDE
  (`docs/MODELO-DE-AMENAZAS.md`), subida de `golang.org/x/text` y un
  arreglo en `web/console-service` (status pill sin `innerHTML`).
  **Solape de ficheros con mi ronda: cero** (verificado con `comm` sobre
  los dos diffs contra `origin/main`). Sus docs viven en
  `docs/agentes/04-seguridad/`. Su arreglo del status-pill de
  `console-service` añade tests propios; sin implicaciones para la
  consola ni para el tema.

## Decisiones de ronda que conviene recordar

- El tema viaja por **una clase** en `<html>` (`html.dark`/`html.light`)
  + remap de la rampa zinc: no añadir variantes `dark:` por componente;
  si un color nuevo entra, va a tokens y al checker.
- La clave de storage es `bt-theme`; el evento de repaint es
  `bt-themechange` (constantes en `lib/theme.ts`).
- La regla de tinta por celda de `attack-matrix`/`heatmap` (`s >= 3 →
  tinta oscura`) depende de que las rampas secuenciales sean monotónicas
  oscuro→claro: si se tocan los `--seq-*`, pasar el checker.
- La paridad de dE entre temas tiene tolerancia 5.0 (documentada en el
  checker): lo vinculante son los suelos absolutos por tema.

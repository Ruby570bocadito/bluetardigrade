# Roadmap B — carril Pulimiento B (archivo vivo)

Última actualización: 2026-10-05, ronda 1 de este carril sobre la rama
`carril/pulimiento-b` (creada desde `origin/main` `5e168ba`).

## Hecho (rondas cerradas)

- **2026-10-05 — Tema claro/oscuro de la consola (THEME-1/2/3):**
  paleta clara completa en `globals.css` (remap de rampa zinc bajo
  `html.light`, reversa de hairlines blanco-alfa, tokens viz/severidad/
  estados claros), script de arranque sin destello en `layout.tsx`,
  `lib/theme.ts` + tests, `ThemeToggle` en la cabecera con persistencia
  y sincronía de pestañas, `dot-grid` y `entity-graph` leyendo vars por
  tema, botones primarios a `blue-600` (AA 5.2:1), checker
  `scripts/dev-tests/check_console_theme.py` (71 checks OK en ambos
  temas), CSS duplicado de scrollbar/`::selection` eliminado y README de
  la consola corregido (deriva «emerald»/«dark-mode locked») y
  documentado. Verificación: 255/255 bun tests, tsc OK, build OK,
  34/34 DOM. Informe: `ronda_2026-10-05_12h37_B.md`.

## A medias

- Nada a medias: la ronda se cerró completa. La paleta clara está
  validada por máquina pero **no vista en Chromium real** (este entorno
  no arranca Chromium; limitación ya documentada en el repo).

## Siguiente (orden propuesto)

1. Capturas del tour y pase visual del tema claro en un host con
   Chromium (`make console-browser` + arnés de capturas de la casa);
   ajustar `.ambient-glow`, sombras y `.star-border` si algo flojea.
2. Coordinar con Implementación B antes de tocar: unificación de las
   ~109 clases `blue-*` al token `--primary` (kit de botones) y una
   pasada de foco visible/foco atrapado en los popovers de cabecera.
3. Proponer a Pulimiento A el enganche de `check_console_theme.py` en
   `ci.yml` (paso de 3 s, stdlib puro).
4. Ampliar `check_console_theme.py` con los pares de los chips rojos/
   verdes del topbar (estados condicionales) si las clases siguen fuera
   de tokens.
5. Documentar la paleta clara en `docs/PALETA-Y-PRUEBAS-NAVEGADOR.md`
   tras las capturas reales (esa doc narra rondas, no la toco a ciegas).
6. Cuando los demás carriles publiquen ramas: leer sus 2-3 últimos
   informes al inicio de cada ronda; prioridad ALTA antes que nada.

## Coordinación (apéndice de la ronda 2026-10-05, post-fetch)

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

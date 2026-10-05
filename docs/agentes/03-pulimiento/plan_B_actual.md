# Plan de ronda — Pulimiento B (2026-10-05, ronda 2, 13h18 Madrid)

Base: `5e168ba` (main sin mover). Mi ronda 1 publicada en `4eba2f8`.

## Tareas cogidas (identificadores de TODO.md en `origin/feat/enrollment`)

1. **THEME-1 (cierre)**: el modo NOC debe seguir oscuro con tema claro
   activo (hoy el remap de `html.light` invierte sus superficies zinc y las
   paletas viz de sus 5 gráficas embebidas). Fuerza oscura mientras el NOC
   está montado + repaint de capas canvas al cerrar. Además el selector de
   la cabecera pasa a 3 estados (sistema/claro/oscuro, THEME-1 lo pide)
   con seguimiento vivo de `prefers-color-scheme` en «sistema».
   Ficheros: `noc-mode.tsx`, `theme-toggle.tsx`, `lib/theme.ts`,
   `lib/theme.test.ts`, `layout.tsx` (script espejo).
2. **THEME-2 (cierre)**: migrar las clases fijas `blue-*` (71 en 22
   ficheros) a los tokens del kit (`--primary` / `--primary-strong` nuevo
   para botones sólidos). Los blues de datos (viz) se quedan. **Excluyo
   `dashboard.tsx`: IMP-B trabaja ahí esta ronda (VIZ-2/VIZ-6).**
   Ficheros: los 21 restantes con `blue-*` + `globals.css` (@theme) +
   `check_console_theme.py` (par nuevo).
3. **POL-8 (parcial)**: foco visible y teclado en los popovers de
   cabecera (NotifyMenu, paleta de comandos, export, sesión, detectores,
   atajos): anillo `focus-visible` donde falte, cierre con Escape y
   retorno de foco.
4. **POL-9 (parcial)**: baseline de tamaño de bundle de `bun run build`
   documentada en `web/console/README.md` (área de este carril). El
   informe de Lighthouse y axe en CI quedan para host con navegador.

Limpieza de ronda: imports sin uso, restos temporales, `.gitignore`.

## Coordinación

IMP-B (ronda 4, plan `652953d`): VIZ-2 heatmap y VIZ-6 exportación
tocan `dashboard.tsx`, `chart-frame.tsx` y libs nuevas — no piso ninguno.
SEG-A/SEG-B/PUL-A: sin solape (verificado contra sus planes publicados).

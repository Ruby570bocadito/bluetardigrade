# claim: tema-claro

- ID: IMP-2
- Fecha/hora: 2026-10-22 (UTC+2), sesión 3
- Tarea: ROADMAP IMP-2 «tema-claro» — rework de contraste, superficies y
  gráficas del tema claro (resto del carril F5, TODO.md).
- Rutas que voy a tocar:
  - `web/console/src/app/globals.css` (bloque html.light y superficies)
  - `web/console/src/components/` (chips de código, shell, gráficas,
    residuos oscuro-céntricos)
  - `web/console/src/lib/` solo si un token compartido lo exige
- Coordinación: IMP-1 declaró m7-wef-pack (`rules/`) — sin solape. El
  guard `scripts/dev-tests/check_console_theme.py` (zona IMP-1) se usa
  tal cual; si necesita reglas nuevas, petición en mi estado.

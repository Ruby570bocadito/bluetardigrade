## Makefile: TABs restauradas y --ignore-scripts adoptado (PUL-B)

`63fa077` aplanó los TAB de receta del Makefile a 8 espacios (69
líneas de receta en mi carril, incluidas las 7 de mis targets
console-a11y/console-lighthouse añadidos después): `make` roto en
solitario — `missing separator` en la línea 31, como documentó SEG-A
en su ronda 17 (6 de 7 carriles rotos, main incluido).

- Restaurados los TAB (69 líneas, contenido intacto; fail-before
  capturado con `make -n console-dom`, pass-after: los 20 targets
  pasan `make -n` y `make console-dom` verde end-to-end).
- Adoptado `--ignore-scripts` en las 6 líneas `npm install` de
  targets de consola (decisión ya convergida: PUL-A en ci.yml r12,
  SEG-B y SEG-A en su Makefile). esbuild resuelve vía `@esbuild/*`
  opcionales; el Chromium lo baja el paso explícito de Playwright.
- Convergencia: mis hunks compartidos son ya idénticos a los de
  SEG-A/PUL-A/SEG-B; el conflicto residual de 7 recetas que SEG-A
  dejó anotado para la integración PUL-B desaparece (mi Makefile es
  ahora un superconjunto aditivo: console-a11y + console-lighthouse).

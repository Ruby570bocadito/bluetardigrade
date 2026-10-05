# Plan de ronda — Pulimiento B (2026-10-05, ronda 4, ~16h45 Madrid)

Base: mi propia ronda 3 (`d28950e`, sin fusionar todavía); `origin/main`
sigue en `a1bca4f`. Sin `git merge origin/main` necesario (no ha cambiado).

## Tareas cogidas (POL-8 y POL-9, ahora desbloqueadas)

1. **POL-8 (avance real): auditoría axe** de las vistas de la consola en
   los dos temas con `axe-core` sobre el build de producción (mismo
   arnés de fixtures que la regresión de navegador). Hallazgos: los de
   componentes del área de este carril se corrigen aquí; los que caigan
   en ficheros de IMP-B (gráficas) se documentan para su carril en el
   informe. `axe-core` entra como dependencia de prueba en
   `tools/console-tests` (fuera del grafo de la aplicación, sin
   postinstall; SEC-6 respetado) para que el pase sea reproducible por
   CI más adelante.
2. **POL-9 (avance): informe Lighthouse** sobre el build de producción
   si la instalación de la herramienta en tooling de pruebas es viable;
   resultado documentado en `web/console/README.md` junto a la baseline
   de bundle. Si la instalación no es razonable en este entorno, se
   declara igual que antes y se entrega solo axe.

No toca: ficheros de IMP-B (`charts/*`), pipeline de nonce CSP (queda en
cola como ronda propia), SECURITY.md (ya al día).

## Coordinación

- SEG-B (ronda 3 publicada): re-auditoría SEC-6 de reactbits y revisión
  del analista — su rama solo publica plan; vigilancia anotada en mi
  informe de la ronda 3. Esta ronda NO toca reactbits (solo lee axe) ni
  el panel del analista: cero choque con su declaración de ficheros.
- SEG-A (ronda 2 cerrada, `c126679`): Go (`internal/api`, `internal/report`,
  fuzz). Solape: cero.
- IMP-A/IMP-B/PUL-A: sin plan publicado.

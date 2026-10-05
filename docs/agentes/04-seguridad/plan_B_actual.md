# Plan de ronda — Seguridad B (2026-10-05)

Tareas del TODO que cojo esta ronda:

- **SEC-5 Dependencias**: añadir al CI un job de escaneo (`govulncheck` + `osv-scanner`
  + `cargo audit`) con política documentada; elevar `golang.org/x/text` a >= 0.39.0
  (GO-2026-5970, bucle infinito con UTF-8 inválido, en el grafo vía bubbletea) y
  dejar la decisión del PR #8 de Dependabot con evidencia.
- **SEC-6 Cadena de suministro**: auditar los `package.json` (scripts postinstall)
  y los componentes React Bits copiados en `web/console/src/components/reactbits/`.
- **SEC-2/SEC-3/SEC-9**: revisión de superficies existentes en main (secretos en
  logs/reposo, exportaciones, XSS, privacidad); las correcciones que apliquen.

Ficheros que voy a tocar: `.github/workflows/ci.yml`, `go.mod`/`go.sum`,
`docs/agentes/04-seguridad/*`, `changelog.d/*`. Nada de la consola salvo
hallazgo propio; los hallazgos en ramas ajenas van al informe, no a su código.

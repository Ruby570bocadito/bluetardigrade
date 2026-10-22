# PUL — estado

## Hecho (últimas 24 h)
- **H-001 + H-002** (hornada doc de TEST) — claim 8222595, trabajo
  965265e/014ac8e, release 4cc87d1: prerrequisitos Go 1.26.10+make con
  enlace en el quickstart Linux/macOS/Docker del README (Docker queda
  como vía sin prerrequisitos), y cifra de reglas 114→119 barrida en
  README, PHISHING, INSTALACION-Y-ESTADO-SOC, ARCHITECTURE, OPERATIONS
  y docs/ROADMAP (allí también cadenas 11→13); en SOC-INTEGRACIONES la
  narración histórica queda intacta y se añade la cifra vigente con
  remisión a `engine doctor`. Cifras replicadas por mi lado:
  `rg -c '^- name:' rules/` = 119, cadenas 13. Un fragmento propio en
  changelog.d/ por hallazgo. Ambos en resuelto-pendiente-verificación;
  cierra TEST.
- Sesión anterior, verificada en su día: deps-audit-checks-write (CI
  publicando el check «Security audit»), comentario de concurrency
  (servido por DIR, de266dd) y pol1b (ya servida por 088eaaa). Sin
  nada que rehacer.
- **Higiene de sesión** — sin cambios: `.agent-tmp/` ignorado, raíz
  limpia, manifiestos bun sin deriva, sin claims solapados.

## En curso
- (nada)

## Peticiones a otras zonas
- IMP-2 (H-005): en el Quickstart de `web/console/README.md` añadir
  una línea tipo «si el motor arranca con -api-token, define
  SF_API_TOKEN en web/console/.env». Zona `web/` no es mía; TEST
  verificó que el proxy funciona con la variable puesta.

## Propuestas para el roadmap
- Las cifras hardcodeadas de reglas/cadenas derivan (segunda vez):
  valorar citar solo `engine doctor` o un guard de CI que compare el
  README con el pack.
- Consolidar changelog.d al cerrar CADA ronda (los de m3/c4 no deben
  volver a acumularse días).

## Estado: VERDE

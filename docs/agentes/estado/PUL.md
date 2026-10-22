# PUL — estado

## Hecho (últimas 24 h)
- **changelog-consolidar-ronda-2** — los 5 fragmentos de la ronda
  (m3-yara, c4-consulta-bd, cap de lectura del sensor, H-001, H-002)
  consolidados en una sección fechada de [Unreleased] en inglés
  (idioma de la convención); cobertura 14/14 por tokens distintivos
  antes de borrar. claim 302a016, trabajo 3cc318a, release f322b42.
- **H-001 + H-002** (hornada doc de TEST) — claim 8222595, trabajo
  965265e/014ac8e, release 4cc87d1: prerrequisitos Go 1.26.10+make con
  enlace en el quickstart Linux/macOS/Docker del README (Docker queda
  como vía sin prerrequisitos), y cifra de reglas 114→119 barrida en
  README, PHISHING, INSTALACION-Y-ESTADO-SOC, ARCHITECTURE, OPERATIONS
  y docs/ROADMAP (allí también cadenas 11→13); en SOC-INTEGRACIONES la
  narración histórica queda intacta y se añade la cifra vigente.
  Cifras replicadas por mi lado: `rg -c '^- name:' rules/` = 119 y 13
  cadenas. Hallazgos en resuelto-pendiente-verificación.
- Verificadas en su día y cerradas: deps-audit-checks-write,
  concurrency (DIR, de266dd), pol1b (088eaaa).
- **Higiene de sesión** — `.agent-tmp/` ignorado, raíz limpia,
  manifiestos bun sin deriva, rebases limpios sobre IMP-1/IMP-2/DIR.

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
- Consolidar changelog.d al cerrar CADA ronda (hoy ha tocado otra vez:
  cinco fragmentos esperando); los de las rondas en vuelo no deben
  acumularse días.

## Estado: VERDE

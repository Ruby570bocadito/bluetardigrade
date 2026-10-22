# Claim: H-001-H-002-readme-docs

- **ID**: PUL
- **Fecha/hora**: 2026-10-22 07:41 UTC
- **Rutas que voy a tocar**:
  - `README.md` (H-001 prerrequisitos en el quickstart Linux/macOS/Docker; H-002 cifra de reglas)
  - `docs/PHISHING.md`, `docs/INSTALACION-Y-ESTADO-SOC.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, `docs/ROADMAP.md`, `docs/SOC-INTEGRACIONES-E-INFORMES.md` (H-002: misma cifra desfasada 114→119; docs/ROADMAP además cadenas 11→13)
  - `changelog.d/` (dos fragmentos, uno por hallazgo)
  - `docs/agentes/hallazgos/H-001-quickstart-linux-sin-prerrequisitos.md`, `docs/agentes/hallazgos/H-002-reglas-114-vs-119.md` (solo la línea `Estado:` y el commit, per PROTOCOLO §1.2)

Verificado antes de reclamar: `git log --since="3 days ago" -- README.md` sin
trabajo sobre estas cifras; claims activos: ninguno; conteo propio
`rg -c '^- name:' rules/` = 119 reglas y 13 cadenas (coincide con el doctor
que TEST reportó en H-002).

# claim: ronda3-cifra-123

- ID: PUL
- Fecha: 2026-10-22 (hornada doble de documentación)
- Tarea 1 — consolidar changelog.d (ronda 3): los 9 fragmentos actuales
  (wef-ad-pack, pol1c-collector-split, console-tema-claro,
  console-yara-desfase, console-idea10-idiomas-resto,
  ingest-reject-line-count, db-query-diagnostico-tamano, alerts-sev-alias,
  engine-yara-read-cap) se consolidan como subsección fechada de
  [Unreleased] en CHANGELOG.md (inglés, idioma de la convención) y se
  borran de changelog.d/. Cobertura por tokens distintivos antes de
  borrar. El fragmento que SEG añada en vuelo (sensor-yara-sources-cap)
  queda para la ronda 4 — su claim no toca CHANGELOG.md.
- Tarea 2 — tercera deriva de la cifra de reglas (anotada a PUL en el
  propio fragmento wef-ad-pack): M-7 sube el inventario a 123 reglas
  (verificado: `rg -c '^- name:' rules/` = 123; secuencias siguen en 13)
  y la prosa sigue citando 119 en README.md, ARCHITECTURE, OPERATIONS,
  INSTALACION-Y-ESTADO-SOC, ROADMAP, PHISHING y
  SOC-INTEGRACIONES-E-INFORMES. Actualizo las 7 cifras conservando la
  narración histórica de SOC-INTEGRACIONES (55→75→114) y sin tocar los
  «119» que son UUIDs o ATT&CK en OPERATIONS.
- Rutas que voy a tocar:
  - CHANGELOG.md y los 9 fragmentos de changelog.d/
  - README.md y los 6 docs citados (solo línea de cifra)
  - docs/agentes/estado/PUL.md
- Verificación previa (§1.3): `git log --since=6h -- CHANGELOG.md
  changelog.d/` solo muestra altas de fragmentos, ninguna consolidación
  en vuelo; claims/ tiene solo yara-fuentes-capadas (SEG), sin solape de
  rutas (yara.rs + fragmento NUEVO + estado/SEG.md).

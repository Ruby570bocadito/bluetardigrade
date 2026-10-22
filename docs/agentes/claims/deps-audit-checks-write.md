# claim: deps-audit-checks-write

- ID: PUL
- Reclamado: 2026-10-22 10:05 UTC
- Rutas: `.github/workflows/deps-audit.yml`, `.cargo/audit.toml`,
  `changelog.d/deps-audit-checks-write.md`, `docs/agentes/estado/PUL.md`
- Tarea: ROADMAP PUL — permiso `checks: write` en deps-audit.yml para que
  rustsec/audit-check publique informes no vacíos (petición de IMP-1 en
  PR #48); con publicación posible, se retira bincode
  (RUSTSEC-2025-0141) de `.cargo/audit.toml`, cuya condición de revisión
  («OPS da al job un token que pueda publicar») queda cumplida.
- Nota de zona: `.cargo/audit.toml` no tiene fila en OWNERSHIP; la
  edición está sancionada por la propia tarea del ROADMAP y por la
  petición de IMP-1 (autor de la excepción). Sin claims activos de
  otros agentes en el momento del claim.

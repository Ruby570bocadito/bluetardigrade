## CI: deps-audit publica informes reales de cargo audit

El job de `deps-audit` dispone ahora de `checks: write` (a nivel de
job, privilegio mínimo): rustsec/audit-check puede publicar el informe
como check run en lugar de morir en el intento de publicación con el
token de solo lectura. Con la publicación posible se retira la
excepción de bincode (RUSTSEC-2025-0141, unmaintained, transitivo de
yara-x) de `.cargo/audit.toml`: su condición de revisión («el job puede
publicar») está cumplida, y el aviso informativo se publica sin fallar
el check — la transparencia que pedía IMP-1 desde el PR #48. La
excepción de `rsa` (RUSTSEC-2023-0071) sigue en pie con su razón
documentada: sin versión con parche y uso parse-only local.

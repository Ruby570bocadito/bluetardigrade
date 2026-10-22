# PUL — estado

## Hecho (últimas 24 h)
- **deps-audit-checks-write** (ROADMAP; petición de IMP-1 en PR #48) —
  ciclo completo: 0dea0aa (claim), ff15ee4 (trabajo), 5687747 (release):
  deps-audit.yml con permissions a nivel de job (contents: read +
  checks: write; issues: write fuera a propósito, privilegio mínimo),
  bincode fuera de `.cargo/audit.toml` (RUSTSEC-2025-0141, unmaintained
  transitivo de yara-x: su condición de revisión escrita quedó
  cumplida; rsa sigue con su razón) y fragmento en changelog.d/.
  Verificado en CI: deps-audit sobre la cabeza (ce9a70b, contiene
  ff15ee4) en verde y publica el check «Security audit» con informe
  NO vacío en success (el informativo no falla; doc de audit-check
  v2.0.0). Resto de lanes de ese head: verdes.
- **pol1b-dividir-run-go: verificada, ya servida — no rehacer.**
  088eaaa (POL-1) dividió run.go de 1346 a ~330 líneas; lo restante es
  un orquestador lineal de una función. Fragmentarlo más es churn sin
  valor de lectura. Sin cambios en el código.
- Higiene de sesión: `.agent-tmp/` en .gitignore (l78); `docs/agentes/`
  con los seis artefactos sancionados (5 v2 + hallazgos/ de TEST);
  raíz sin basura; manifiestos bun sin deriva desde e6e8a4f.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- Retirar pol1b-dividir-run-go del tablero (servida por 088eaaa). Si
  POL-1 sigue viva en TODO.md, el objetivo restante es
  `sensor/src/collector.rs` (479 líneas) — ticket para IMP-1.
- El comentario de concurrency en deps-audit.yml dice «queue the run»,
  pero GitHub cancela las runs PENDIENTES intermedias (solo sobrevive
  la más nueva; la intención se conserva); el comentario puede reflejarlo.

## Estado: VERDE

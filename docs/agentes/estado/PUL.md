# PUL — estado

## Hecho (últimas 24 h)
- **changelog-consolidar-fragmentos** — 16 días sin agregación (desde
  2026-10-06): 42 fragmentos de tres rondas (20/21/22-10) consolidados
  en `[Unreleased]` como nueve secciones temáticas fechadas, en inglés
  (idioma de la convención; había deriva ES), estilo Keep-a-Changelog.
  Cobertura verificada 42/42 por token distintivo antes de borrar;
  fragmentos retirados según `changelog.d/README.md`. Ciclo: 31c46a1
  (claim), fb77898 (trabajo), 9812244 (release).
- **deps-audit-checks-write** — cerrada antes en la jornada: `checks:
  write` job-level en deps-audit.yml, bincode fuera de la excepción;
  CI verde publicando el check «Security audit» no vacío en success.
- **pol1b-dividir-run-go** — verificada, ya servida por 088eaaa (run.go
  1346→~330, orquestador lineal); no rehacer.
- **Barrido estático de higiene (sin cambios necesarios):** menciones a
  IA = la funcionalidad propia del analista (endpoint del producto), no
  rastros de agentes; TODOs en código = trazabilidad a TODO.md;
  `.agent-tmp/` en .gitignore; raíz limpia; manifiestos bun sin deriva.

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
- Consolidar changelog.d al cerrar CADA ronda (la convención lo dice):
  los de las rondas en vuelo (m3, c4) no deben volver a acumularse 16 días.

## Estado: VERDE

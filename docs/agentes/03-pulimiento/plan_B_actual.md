# Plan de ronda — Pulimiento B (2026-10-21 18:4x CEST, ronda 1)

Carril: calidad backend (motor Go + sensor Rust + rules/). Pareja de
carril: Pulimiento A (sin `plan_A_actual.md` publicado aún en el momento
de escribir este plan; trabajo con mi plan y lo anoto en el informe).

- **Principal — P-3 (POL-3, Calidad en TODO.md): perfiles `pprof` del
  camino caliente en el benchmark nocturno.** El motor gana un flag
  opt-in `-pprof-dir` (CPU + heap de toda la ejecución; sin efecto
  cuando no se pasa) y `bench_nightly.sh` perfila las dos pasadas
  (rings y sqlite), comprueba que los perfiles existen y los sube como
  artefacto del workflow. Verificación local: gofmt, go build, go vet,
  staticcheck (dos pasadas), `go test -race ./...` y una ejecución real
  de `bench_nightly.sh` con los perfiles generados.
- **S-5 (POL-1 sensor: dividir `collector.rs`) queda BLOQUEADA esta
  ronda**: el PR #40 (S-1, carril sensor) ya toca
  `sensor/src/collector.rs`, `netreg.rs` y `regnames.rs` y su plan se
  publicó primero — el desempate del protocolo lo resuelve. Se retoma
  en cuanto #40 se fusione.
- **Secundario**: auditoría de higiene de `rules/` (duplicados,
  front-matter consistente, guardas del repo en verde) y de
  sincronización de dependencias backend (`go.mod`, `Cargo.lock`) —
  solo arreglos si hay deriva real; los PRs #24–#27 de Dependabot
  cubren las actualizaciones, así que no se tocan ficheros de
  dependencias esta ronda.
- No toco `internal/api/api.go` ni `cmd/engine/run.go` salvo las líneas
  mínimas del flag (POL-1 Go es M-9, carril A/AG-1) ni el contenido de
  las reglas (O-2/AG-4).

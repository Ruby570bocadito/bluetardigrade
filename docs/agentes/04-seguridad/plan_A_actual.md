# Plan de ronda — Seguridad A (2026-10-06, ronda 12, ~09h05 Madrid)

Base: `4e34c8a` (mi ronda 11, auditoría AD/SEC-2 publicada).
`origin/main` sigue en `35cd866`. Novedad al abrir: DOS carriles
movieron, ambos con el mismo delta Go:

- **PUL-A `df323ad`**: docs-only (drift de ARCHITECTURE/OPERATIONS
  cerrado, REP-1 documentado, informe ronda 10) + absorción de `main`
  en `go.mod`/`go.sum`.
- **PUL-B `21d73f0`**: plan de su ronda 5 + la misma absorción de
  `main` en `go.mod`/`go.sum` (hash `380a323` idéntico en ambas puntas
  y en mi árbol: dependabot PR #18 — `modernc.org/sqlite` 1.59.0→1.60.1,
  `modernc.org/libc` 1.75.7→1.77.1, `charmbracelet/x/ansi`
  0.10.1→0.11.8, indirectas TUI nuevas `clipperhouse/*`).
- Sin mover: IMP-A `bc91c7d` (mis 2 hallazgos de la ronda 11 siguen
  abiertos, séptima espera), IMP-B `5ecbcc4` (mis 2 hallazgos de la
  ronda 5 siguen abiertos, sexto aviso), SEG-B `55c8b35`.

Mi carril ya tiene a `main` como ancestro: la ronda 11 validó
`-race ./...` con esas dependencias en mi árbol. Toca ejecutarlo en
las puntas movidas y avanzar el fuzzing vivo.

Tareas:

1. **Fuzzing vivo, segunda tanda** (prioridad 1 del roadmap, los
   objetivos los dejé anunciados en la ronda 10): `FuzzLoadIntelFile`
   (internal/intel), `FuzzLoadSuppress` (internal/suppress),
   `FuzzConvertSigma` (internal/sigma), `FuzzDecodeMail`
   (internal/collector) — 45-60 s cada uno. Los cinco de la ronda 10
   quedaron limpios; corpus interesante se acumula en el build cache.
2. **Obligatorio de ronda**: `-race -count=5` en los paquetes que
   tocan los bumps de las puntas movidas (`internal/store` y
   `cmd/engine`: sqlite/libc/ansi) sobre PUL-A `df323ad` y PUL-B
   `21d73f0` en worktree desprendido. PUL-A no toca más Go; IMP-B
   consola-only (evidencia vigente).
3. **Lectura de seguridad del delta de dependencias** (suministro,
   compartido con SEG-B): qué cambia en sqlite 1.60/libc 1.77/ansi
   0.11 y si rota algo que el motor use (DSN, pragmas, render TUI).
4. **Sanity-check barato de la documentación REP-1 de PUL-A** contra
   el código real (`/api/reports`, `/api/noise` en OPERATIONS.md):
   docs-only, solo verifico que no documenta mentiras; si encuentro
   drift lo anoto en mi informe para PUL-A, no edito su fichero.
5. **Re-verificación de mis hallazgos abiertos** contra las puntas
   sin mover (esperado: sin cambio, aviso vigente).

Cierre: checklist CI completo en mi árbol, informe, roadmap,
changelog solo si hay fix mío; push tras `merge-tree` contra las
cinco puntas.

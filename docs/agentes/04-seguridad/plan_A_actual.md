# Plan de ronda — Seguridad A (2026-10-05, ronda 5, ~19h05 Madrid)

Base: `783b5a8` (mi ronda 4) + `origin/main` sin cambios (`a1bca4f`). Lo que
cambia desde el cierre: IMP-B ya tiene en su rama el código de su ronda 2
(`d84a9a5` + fusión zinc de PUL-B, ~2.6k líneas) y PUL-A cerró su ronda con
cambios de motor en su rama (`46a8fa6`…`c0702cc`). Eso desbloquea el
pendiente 2 de mi roadmap; IMP-A sigue solo con plan (AD-1/AD-2 aún no
existe, su plan dice que la auditoría del conector es para cuando se fusione).

Tareas (prioridad real del roadmap, ítem 2; protocolo de hallazgos en ramas
ajenas sin fusionar: anotar prioridad/fichero/línea/reproducción, no editar
su rama):

1. **Revisión funcional del código de consola nuevo de IMP-B** en
   `origin/carril/implementacion-b` (worktree de solo lectura, sin tocar su
   rama): `lib/reports.ts`, `lib/noise.ts`, `lib/simulation.ts` (matemática
   de agregación, ventanas, división por cero, NaN), `lib/url-state.ts`
   (parseo de `?view=`/pestañas/`informe`/`caso`), `lib/keyboard-nav.ts` y
   `console-commands.ts`, la batería de validación, el kit de pestañas de
   PUL-B (`ui-tabs.tsx`, roving tabindex) y las vistas que los usan.
   Verificación en el worktree: `bun test`, `bunx tsc --noEmit` (hallazgo =
   fallo o bug por lectura).
2. **Revisión funcional de los cambios de motor de PUL-A** en su rama:
   `respond.go`, `rules.go`, `sigma/convert.go`, `threshold.go` y la matriz
   nocturna de fuzzing (incl. resolver el estado del conflicto anotado en
   `internal/ingest/fuzz_test.go`: ¿mis targets siguen eliminados?).
3. **Obligatorio de ronda**: `go test -race -count=5` sobre los paquetes con
   goroutines tocados por las ramas ajenas (PUL-A: `internal/ingest`,
   `internal/respond`, `internal/risk`, `internal/rules`; IMP-B no toca Go).

Ficheros que espero tocar: solo `docs/agentes/04-seguridad/` y
`changelog.d/` si algún hallazgo es de código ya fusionado en main. Sin
solape: IMP-B trabaja REP-4 en `reports-view.tsx` (yo reviso su ronda 2 ya
publicada), PUL-A ya cerró su ronda.

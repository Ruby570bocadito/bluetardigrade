# Plan de ronda — Seguridad A (2026-10-05, ronda 10, ~21h30 Madrid)

Base: `7a0a059` (mi ronda 9, sin cambios en `origin/main` desde el
merge de la ronda 9). Novedad al abrir:

- **PUL-A `829f7f0`** (4 commits nuevos): adopta mi `FuzzEnrollLine`
  verbatim en `internal/ingest/fuzz_test.go` (SEC-7) y quita la
  procedencia de carril de 2 comentarios de `internal/enroll`
  (POL-12). El diff Go declarado es test-only + comentarios; verifico
  ambas afirmaciones línea en mano y ejecuto su suite.
- **IMP-B `d6f2285`** (2 commits): asistente de primer arranque
  (IDEA-11), consola-only, 0 ficheros Go. Revisión funcional completa
  (`onboarding.ts`, wizard, integración en `shell.tsx`, paleta) y
  re-verificación de MIS dos hallazgos de la ronda 5
  (`noise-view.tsx` supresión flota-completa MEDIA;
  `reports-view.tsx` `generate` sin guardia de vigencia BAJA).
- IMP-A `2c32013`, PUL-B `173ac11`, SEG-B `b0eaa60`: sin movimiento;
  `internal/ad` sigue bloqueado por IMP-A.

Tareas:

1. **Revisión de PUL-A**: diff de `internal/enroll` (¿solo
   comentarios?), verbatim byte a byte del bloque adoptado, suite de
   `internal/ingest` + `internal/enroll` en su punta (worktree
   desprendido), y su resolución del conflicto append-append de
   `fuzz_test.go` contra mi carril (`merge-tree` de nuevo).
2. **Revisión de IMP-B IDEA-11**: lógica de auto-apertura
   (`shouldAutoOpen` + efecto de `shell.tsx` con `offeredRef`),
   semántica de `loaded` en `fleet-provider` (¿carrera
   fleet-vs-enroll?), registro de descarte tolerante, cálculo del
   «token que caduca antes» (¿qué pasa con `expires_at` vacío?),
   acople en paleta. Estado de mis dos hallazgos de la ronda 5.
3. **Obligatorio de ronda**: única punta ajena movida con Go = PUL-A
   (delta test-only): `go test -race -count=5` en los paquetes que
   toca (`internal/ingest`, `internal/enroll`). IMP-B sigue sin tocar
   Go (evidencia de rondas 5-8 vigente).
4. **Fuzzing vivo corto** (si el tiempo acompaña): sesiones `-fuzz`
   breves sobre los objetivos de entrada más densos de mi carril
   (`FuzzEnrollLine`, carga YAML de escenarios, límites de report),
   buscando crashes reales más allá de los corpora de semilla.

Cierre: checklist CI completo, informe, roadmap, changelog solo si hay
fix que anunciar; push tras `merge-tree` contra las cinco puntas.

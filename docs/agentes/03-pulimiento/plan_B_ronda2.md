# Plan de ronda — Pulimiento B (ronda 2, 2026-10-22)

Carril: calidad backend (motor Go). Pareja de carril: Pulimiento A
(POL-2 log/slog es suyo vía M-9; yo no toco `log/slog`).

- **Principal — P-4 (Backlog, TASKS.md): expiración de bundles
  forenses O(1) por alerta.** Motivo y evidencia: el primer perfil
  real del nightly (artefacto `bench-pprof` de P-3, ronda 1) señalaba
  `forensic.(*Recorder).evictOldFiles` ≈29 % de la CPU del camino
  caliente en rings. Causa: cada escritura de bundle en la cota paga
  un `ReadDir` completo, un `stat` por fichero y una ordenación por
  mtime. Corrección: FIFO en memoria del orden de escritura de este
  proceso (coincide con el orden por mtime: temp+rename secuencial),
  con una sola pasada de siembra desde el disco por vida del recorder
  (bundles de ejecuciones anteriores y ficheros ajenos participan
  igual que antes). La cota (256, expirando el más viejo primero) y el
  contrato best-effort no cambian; `TestBundleDirEviction` pasa sin
  tocarlo.
- **Microbench de compromiso añadido** (`internal/forensic/
  bench_test.go`): `BenchmarkCaptureEnLaCota` (régimen estacionario en
  la cota, el caso del perfil) y `BenchmarkCaptureBajoLaCota`
  (contraste). Números del sandbox (2 vCPU, 200x, count=3): en la cota
  430 µs → 85 µs por operación, 160 KB → 3,8 KB, 1584 → 27 allocs;
  bajo la cota 233 µs → 82 µs (también mejora: ni el `ReadDir`
  temprano se paga ya). El perfil después: `writeAtomic` concentra el
  coste de `Capture` (≈78 %) y el mecanismo de expiración desaparece
  del top.
- **Verificación local con el estándar de CI**: gofmt, go build, go
  vet, staticcheck (forensic + cmd/ + internal/ + pkg/), `go test
  -race ./...` completo. Pendiente para el PR: replicar con el runner
  de CI y confirmar el delta del perfil en el próximo nightly
  (runner estable ≠ sandbox de 2 vCPU).
- **Límites de la ronda**: no toco `internal/api/api.go` ni
  `cmd/engine/run.go` (M-9, carril A), ni `log/slog` (POL-2), ni
  ficheros de dependencias (Dependabot), ni el contenido de las reglas
  (O-2/AG-4).
- **Siguiente del carril** (si la ronda da margen): seguimiento del
  artefacto `bench-pprof` del próximo nightly para (a) confirmar la
  caída de `evictOldFiles` en el perfil y (b) revisar si aparece un
  nuevo hotspot que justifique P-5.

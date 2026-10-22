# SEG — estado

## Hecho (últimas 24 h)
- Ronda 5, barrido de las superficies nuevas desde 6f52c32 (m3-yara,
  c4): encontrado y corregido (MEDIO) — lectura sin tope en
  internal/yara: readPack/manifestVersion/Zip leían cada .yar y el
  bundle.json con os.ReadFile (el cap de 32 MiB solo protegía el zip;
  TotalBytes se computaba DESPUÉS de leer). Un fichero de varios GiB
  en -yara-rules = slurp OOM del motor en cada GET /api/yara y en el
  arranque. Fix: read_capped (tope+1 + rechazo entero, la disciplina
  de la ronda 4) en las 4 lecturas; lo que pasa el cap se lista desde
  el stat con fila en Problems y peso en TotalBytes, sin truncar al
  huella. 2 tests de regresión; go build/vet, suite ./... -race y
  staticcheck en verde.
- Revisado sin hallazgos: rutas /api/yara (detrás de h.auth como todo
  el mux, solo /api/health exenta), Content-Disposition con sha16 hex,
  zip determinista (walk sin symlinks, rel sin ..), fleet.go
  (yara_rules_sha con clip, parseInt capado), run_yara.go (dir
  inválida = log y sigue, sin crash).

## En curso
- Publicación pendiente: la sesión arrancó SIN credencial (el PAT del
  chat está revocado/rotado, correcto). Claim, fix y release están
  committeados en orden local (cb7cabf → 8f5c5de) y se publican juntos
  en cuanto el humano provea credencial por canal seguro (env var,
  nunca el chat).

## Bloqueado
- Push: sin credencial en el sandbox (ver En curso).

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- El sensor lee las reglas sin tope también (collect_sources en
  sensor/src/yara.rs, fs::read entero): misma disciplina read_capped
  ya existe en su propio scan — propuesta para IMP-1 (directorio
  local, lectura gated por fingerprint: exposición menor, sin prisa).
- sec2-dpapi y la regresión del PR #28 siguen en el carril «Esperando
  al humano» (Windows real).

## Estado: VERDE

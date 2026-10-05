# Plan de ronda — Pulimiento A (2026-10-05 18h33 UTC, re-ejecución de la ronda 9)

- **Contexto:** la instancia anterior de esta ronda (autorizada por el
  responsable con «continua» más allá de RONDAS_MAXIMAS=8) completó 4
  commits locales (plan, adopción fuzz, POL-12, informe) que NUNCA
  llegaron a `origin`: el sandbox se reinició y se los llevó. Este plan
  re-ejecuta la MISMA ronda autorizada sobre el mismo punto de partida
  (`carril/pulimiento-a` en `10d7364`), re-verificada contra el estado
  REMOTO ACTUAL (los demás carriles avanzaron mientras tanto).

## Identificadores del TODO trabajados (mismo alcance que la ronda perdida)

- **SEC-7 (adopción):** los 2 objetivos de fuzz que SEG-A escribió para
  la ingesta (`fuzzEnrollRegistry` + `FuzzEnrollLine`, 107 líneas) se
  adoptan VERBATIM en `internal/ingest/fuzz_test.go`, junto a los 5
  imports que necesitan (`encoding/json`, `errors`, `io`, `net`,
  `time`). Sus dos objetivos y los míos conviven y se complementan: el
  suyo ejercita el handshake completo ENROLL sobre `net.Pipe` (ack
  único JSON, contadores coherentes, cierre del enroller); el mío
  (`FuzzAuthEnrollFirstLine`) cubre la clasificación AUTH/ENROLL y el
  parseo de campos. El addendum de SEG-A (`783b5a8`) anotaba esta
  colisión como append-append: al adoptar yo su código, la fusión de su
  rama queda reducida al bloque de imports.
- **POL-12 (cierre):** los 2 comentarios de `internal/enroll`
  (`enroll.go:481`, `enroll_test.go:302`) pierden la procedencia
  «(Seguridad A, ronda 2026-10-05 13h34)» y conservan el ID `SEC-A-1`
  con su porqué técnico. Solo comentarios, cero cambio de conducta.
  DESBLOQUEADO: el fix SEC-A-1 ya está en `main` (`6b4e108`) y el plan
  nuevo de IMP-A (16h05, `2c32013`) ya NO lista `internal/enroll`.

## Coordinación re-verificada a 18h33 contra las puntas remotas

- **main `35cd866`:** solo dependabot (cellbuf v0.0.15 + 2 bumps en
  `go.mod`/`go.sum`). Mis commits de ronda 8 NO están aún en main.
- **IMP-A `2c32013`:** plan 16h05 — AD-1/AD-2 (`internal/ad` nuevo,
  `internal/api/ad.go`, flag `-ad`) y SET-3 (`/api/stats`). Dice
  explícitamente «POL-1 api.go tras mi fusión»: **POL-1 sigue
  diferido** (tercera ronda consecutiva con el paquete caliente). Su
  plan no toca `internal/ingest` ni `internal/enroll`: las dos tareas
  de arriba están limpias.
- **SEG-A `9c217bf`:** rondas 4-8 (noise/incident/scenrun). Su
  `internal/ingest/fuzz_test.go` NO cambió desde `1977444` (verificado
  con diff): la adopción verbatim extrae de su punta actual y queda
  idéntica. Su addendum nuevo (`1d98208`) es un conflicto SEG-A↔SEG-B
  en `internal/scenrun/scenrun_test.go`: no es mío.
- **IMP-B `9f35615`, PUL-B `173ac11`, SEG-B `b0eaa60`:** consola y
  analyst; sin solape con lo de esta ronda. `merge-tree` contra las
  cinco ramas antes y después de tocar nada.

## Ficheros que voy a tocar y por qué

- `internal/ingest/fuzz_test.go` (adopción verbatim + imports).
- `internal/enroll/enroll.go`, `internal/enroll/enroll_test.go` (2
  comentarios POL-12).
- `changelog.d/PUL-A-nightly-fuzz-matrix.md` (entrada de adopción),
  `docs/agentes/03-pulimiento/` (este plan, informe, roadmap).
- `TODO.md`, `PLAN-DETALLADO.md`, `CHANGELOG.md`, `openapi.yaml`,
  workflows: no se tocan.

## Verificación prevista

`gofmt -l .` (con verificación de que el bloque adoptado queda
byte-a-byte idéntico al de SEG-A), `go build/vet ./...`,
`GOOS=windows go build ./...`, staticcheck 2026.2.1 doble pasada,
`go test -race -count=1 ./...` y `-count=3` en `ingest`+`enroll`,
fuzzing real de los 3 objetivos de `ingest` (pasada corta), matriz
nocturna verificada por descubrimiento (`go test -list` por paquete),
`merge-tree --write-tree` contra las 5 ramas abiertas antes y después.

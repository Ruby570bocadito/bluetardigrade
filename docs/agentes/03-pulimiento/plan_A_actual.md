# Plan de ronda — Pulimiento A

Fecha: 2026-10-21 (CEST). Carril: calidad backend — motor Go y reglas.
Pareja de carril: Pulimiento B (su plan aún no estaba publicado al escribir
este; si aparece solape, ajustaré y volveré a publicar).

## Qué voy a atacar esta ronda

1. **POL-1a — dividir `internal/api/api.go`** (1898 líneas) en ficheros
   coherentes del mismo paquete: núcleo del Hub, constructores, setters,
   autenticación, persistencia, publicación/difusión, estadísticas,
   handlers HTTP y utilidades. Sin cambiar comportamiento: mover código
   tal cual, solo repartir imports.
2. **POL-1b — dividir `cmd/engine/run.go`** (1346 líneas; `runEngine` es
   una única función de ~1284 líneas) extrayendo bloques lógicos
   autónomos a helpers con nombre en ficheros separados, sin cambiar
   comportamiento.
3. **Auditoría del carril**: duplicados y consistencia en `rules/`
   (inventario de reglas), rastros de marca de IA, ficheros del kit
   previo (AGENTS.md / TASKS.md / WORKLOG.md) y dependencias del motor
   sincronizadas con el código.

## Qué NO toco

- `sensor/` (POL-1 sobre `collector.rs` es de mi pareja B).
- `web/`, `website/`, `tools/` (consola, carril C/D).
- Features nuevas y bugs (Implementaciones / Seguridad); si veo algo, va
  al informe, no lo corrijo.
- POL-2 (`log/slog`): no mezclo conversión de formato de log con un
  refactor «sin cambiar comportamiento»; queda primera prioridad de mi
  siguiente ronda.

## Verificación antes de cada push

gofmt, `go build ./...`, `go vet ./...`, staticcheck,
`go test -race ./...`, cross-build `GOOS=windows`, y los chequeos python
de inventario de reglas y OpenAPI. Si `main` exige PR, PR pequeño por
pieza y anotado en el informe.

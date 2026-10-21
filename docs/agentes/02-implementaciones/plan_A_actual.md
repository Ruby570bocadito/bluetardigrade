# Plan de ronda — Implementaciones A

Fecha: 2026-10-21 (CEST). Carril: motor Go (`internal/`, `cmd/engine/`,
`pkg/`). Pareja de carril: Implementaciones B (sensor Rust) — su ritual
S-1 es independiente de este plan; no comparten ficheros.

## Qué voy a atacar esta ronda

**M-1 — backend de «Asignar alertas» (TEAM-3)**, la siguiente pieza grande
según el ROADMAP de los Directores. La parte de consola («Mis alertas»,
barra de selección) es C-2 y NO empieza aquí: esta ronda deja el motor
listo y el contrato publicado.

1. **Estado de asignación en el ciclo de vida** (`internal/lifecycle`):
   la entrada de triaje gana `assignee` + `assigned_by` + `assigned_at`.
   La asignación se conserva en las escrituras de triaje (reconocer o
   cerrar no desasigna) y se limpia con la desasignación explícita.
   Mismo fichero JSON, misma persistencia atómica y mismo tope que hoy.
2. **Superficie API** (fichero nuevo `internal/api/alert_assign.go`;
   en `hub.go` solo las dos líneas de registro):
   - `POST /api/alerts/{id}/assign` — asignar, reasignar (asignar
     encima) o desasignar (`assignee: ""`), con `by` para la auditoría;
   - `POST /api/alerts/assign-batch` — lote desde la barra de selección:
     `{ids, assignee, by}`, resultado por id (`assigned` / `failed`),
     no atómico a propósito: una alerta desconocida no tira el lote.
   Mismas garantías que el triaje: cuerpo de 8 KiB máximo, filtro de
   origen en escritura, alcance por grupos (X-SF-Scope) y difusión SSE
   por el tema `alert_lifecycle` que ya consume la consola.
3. **Cola sin asignar y «Mis alertas» en el backend**: parámetros
   `assignee=` y `unassigned=true` en `GET /api/alerts`, aplicados tras
   el overlay del ciclo de vida, combinables con los filtros que ya
   existen (host, severidad, regla, texto, desde/hasta). En modo tienda
   el filtro se aplica sobre la ventana consultada; el contrato lo dice
   explícitamente (la migración de ciclo de vida a SQLite es hornada 2).

## Contrato M-1 → C-2

Se DECLARA completo en el informe de esta ronda: rutas, cuerpos,
respuestas, campos nuevos de la vista de alerta, semántica de la cola
sin asignar, límites y errores. C-2 no empieza hasta leerlo, como dice
el ROADMAP. Adelanto: la consola solo necesita `GET /api/alerts`
(con los dos filtros nuevos), los dos POST de arriba y el tema SSE
`alert_lifecycle`, cuyo payload ahora incluye la asignación.

## Qué NO toco

- `sensor/`, `web/`, `website/`, `tools/`: carriles de B y C/D.
- `cmd/engine/run.go`: POL-1b (división sin cambiar comportamiento) es
  de Pulimiento A — esta ronda no necesita tocarlo.
- `internal/api/alert_search.go`: el lenguaje de búsqueda no gana el
  filtro de asignación en esta ronda; la cola y «Mis alertas» usan
  `GET /api/alerts` (va al informe como propuesta futura).
- Bugs funcionales (Seguridad) y refactor de calidad (Pulimiento):
  si veo algo, va al informe, no lo corrijo.

## Ritual

Punto completado = fuera de TODO.md + entrada en changelog.d/. El punto
TEAM-3 NO se completa aquí (falta la consola de C-2): entra en
changelog.d/ como entrega del motor y TODO.md queda anotado con lo que
falta, para que el humano vea el estado real de un vistazo.

## Verificación antes de cada push

gofmt, `go build ./...`, `go vet ./...`, `go test ./...` (con `-race` en
los paquetes tocados), guard de OpenAPI (`check_openapi.py`), y
`git pull --rebase` inmediatamente antes de cada push. CI de main en
verde antes de dar la ronda por cerrada.

# claim: seg-redirects-escenarios-apihealthy

- ID: SEG (seguridad y bugs)
- Fecha: 2026-10-21 20:15 UTC
- Tarea: cerrar el hallazgo pendiente del estado SEG — unificar la política
  de redirects en los dos clientes HTTP que aún la tienen por defecto
  (precedente F1, commits 0dddc28/934c80f):
  1. `getJSONInto` (cmd/engine/scenarios.go): cliente de escenarios que
     envía `Authorization: Bearer SF_API_TOKEN` y sigue 3xx hasta 10 saltos
     (Go solo limpia Authorization entre dominios distintos: misma máquina
     con otro puerto la reenvía).
  2. `apiHealthy` (cmd/engine/runtime.go): sin credencial, pero un 3xx del
     puerto de ingest convertiría el chequeo en un GET a URL arbitraria.
  Ambos pasan a `ErrUseLastResponse`; la 3xx es fallo definitivo.
- Rutas que voy a tocar:
  - `cmd/engine/scenarios.go` (CheckRedirect en getJSONInto)
  - `cmd/engine/runtime.go` (CheckRedirect en apiHealthy)
  - `cmd/engine/scenarios_test.go` (regresión: 302 no seguido, 0 peticiones
    al destino)
  - `cmd/engine/main_test.go` (regresión: apiHealthy = false con 302)
  - `changelog.d/` y `docs/agentes/estado/SEG.md` (al cerrar)
- Sin solape: m2-ad7 lista flags.go/run_api.go; o2-escenarios-ad lista
  scenarios/rules/windows/.runtime.go y scenarios.go quedaron libres con
  el release de m4-consulta-bd.

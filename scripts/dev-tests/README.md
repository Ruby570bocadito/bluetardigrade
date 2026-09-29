# dev-tests — scripts de verificación end-to-end

Herramientas de prueba que complementan los tests unitarios (`go test ./...`,
`bun test`) validando el producto **con binarios y procesos reales**, tal como
haría un operador. Nacidas de la sugerencia de Implementaciones (ronda 19h00)
de traer al repo los scripts de prueba que vivían en espacios de trabajo
individuales, para que cualquier agente pueda replicar las validaciones E2E.

Ninguno de estos scripts forma parte del producto instalado; requieren
herramientas de desarrollo (go, python3) y solo escuchan en loopback.

| Script | Qué valida | Requiere |
|--------|-----------|----------|
| `check_openapi.py` | Que `docs/api/openapi.yaml` esté en sincronía estructural con `internal/api/api.go`: rutas servidas declaradas (y ninguna de más) y esquema `Stats` campo a campo contra los wire tags de `statsPayload` (struct sin `omitempty`: todo campo es siempre emitido y por tanto requerido). Detectó de verdad la deriva de `ingest_rejected` antes de corregirla. | python3 + PyYAML |
| `webhook_receiver.py` | Receptor HTTP mínimo para probar la entrega de webhook del motor: cuenta POSTs, acepta `--expect N --timeout S` (exit 0 solo si llegan exactamente N) y `--secret` para exigir `Authorization: Bearer` (listo para cuando la salida webhook gane auth, riesgo del director #1 MEDIA). | python3 (stdlib) |
| `smoke_auth.sh` | Smoke de autenticación del ingest con binarios reales (compila `cmd/engine` y `cmd/devsensor` si no se pasan como argumentos). Ejecuta los 4 escenarios de README: tokens coincidentes → eventos fluyen con `ingest_rejected=0`; token erróneo → sensor rechazado y `events_total` inmóvil; sensor con token contra motor sin token → fallo visible con guía; bind `0.0.0.0` sin token → advertencia de arranque. | bash, go, curl |

## Uso

```bash
# desde la raíz del repo
python3 scripts/dev-tests/check_openapi.py

python3 scripts/dev-tests/webhook_receiver.py --port 9999 --expect 18 --timeout 60
# (en otra terminal) engine -webhook http://127.0.0.1:9999/ingest ...

bash scripts/dev-tests/smoke_auth.sh                      # compila y ejecuta
SMOKE_PORT=17877 SMOKE_API_PORT=17878 bash scripts/dev-tests/smoke_auth.sh
SMOKE_KEEP=1 bash scripts/dev-tests/smoke_auth.sh         # conserva artefactos en /tmp
```

`smoke_auth.sh` elige puertos libres vía `SMOKE_PORT`/`SMOKE_API_PORT`
(por defecto 17877/17878, más +10 y +20 para los escenarios 3 y 4) y hace
pre-flight: si un puerto está ocupado por un proceso residual, falla al inicio
con mensaje accionable en vez de producir fallos confusos a mitad de ronda.

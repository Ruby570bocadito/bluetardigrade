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
| `check_openapi.py` | Que `docs/api/openapi.yaml` esté en sincronía estructural con `internal/api/api.go`: (1) rutas servidas declaradas (y ninguna de más); (2) esquema `Stats` campo a campo contra los wire tags de `statsPayload` (struct sin `omitempty`: todo campo es siempre emitido y por tanto requerido); (3) **seguridad**: cuando `api.go` registra el middleware Bearer (`h.auth(mux)`) — detectado parseando el código, no hardcodeado — el spec debe declarar `securitySchemes.bearerAuth` (http/bearer), cada operación de ruta servida debe declarar su propio `security` con el modismo de auth opcional (`bearerAuth: []` + entrada anónima `{}`: el token solo se exige con `-api-token`), y las rutas que el middleware exenta (parseadas de `auth()`) deben forzar acceso anónimo con `security: []`; (4) el `example` del cuerpo 401 (`components.responses.Unauthorized`) debe coincidir byte a byte con el JSON que el middleware escribe realmente (el `Fprintln` dentro de `auth()`), de modo que el contrato de error documentado no pueda derivar del cable; (5) cada `$ref` del documento (a cualquier profundidad) debe resolver a un nodo dentro del propio spec — un ref colgante es rotura silenciosa para validadores, generadores y docs, y las referencias externas se rechazan porque el spec es deliberadamente un único fichero autocontenido. Detectó de verdad las derivas de `ingest_rejected` y del `security` ausente antes de corregirlas. `--self-test` mantiene en el árbol la prueba negativa del propio guard (1 fixture positiva + 10 mutaciones que deben producir un hallazgo concreto), de modo que CI ejercita el validador y no solo el spec vigente. | python3 + PyYAML |
| `webhook_receiver.py` | Receptor HTTP mínimo para probar la entrega de webhook del motor: cuenta POSTs, acepta `--expect N --timeout S` (exit 0 cuando llegan N o más; las entregas pueden llegar en ráfaga) y `--secret` para exigir `Authorization: Bearer` — el espejo receptor de `-webhook-token` del motor (verificado E2E: sin cabecera correcta responde 401 y el motor lo cuenta en `webhook_failed`). | python3 (stdlib) |
| `smoke_auth.sh` | Smoke de seguridad con binarios reales (compila `cmd/engine` y `cmd/devsensor` si no se pasan como argumentos; los binarios deben ser recientes — un motor viejo no conoce `-token-previous` y el escenario 5 lo dirá con la cola del log). 7 escenarios de README: (1-4) auth del ingest — tokens coincidentes, token erróneo, sensor con token contra motor sin token, bind `0.0.0.0` sin token; (5) rotación sin downtime `-token-previous` — token viejo Y nuevo aceptados en ventana, intruso rechazado; (6) webhook autenticado — entrega con Bearer confirmada por el receptor del repo, y motor sin token contra receptor exigente → 401s → `webhook_failed`; (7) auth de la API local `-api-token` — `/api/*` responde 401 sin token y 200 con Bearer, `/api/health` queda abierta para probes. | bash, go, curl, python3 |
| `e2e_store_sequences.sh` | E2E de la ruta 10 (`GET /api/sequences`) y del store SQLite opt-in sobre el mismo fichero, en tres fases: **A. live** — 4 secuencias con los 7 campos del schema, `store_enabled=true`, `store_events` tras el feed del devsensor, correlator `4/8192`, lista coherente con el contador; **B. reinicio real** — el motor se mata y rearranca sobre el mismo fichero: `store_events` re-sembrado N→N, `events_total` in-proceso a 0, historial completo servido desde el store, `q=lsass` operativo; **C. retención** — reinicio con `-store-retention 1s`: la primera poda es síncrona en el arranque, así que a health-up el store ya está vacío (`store_events=0`, lista vacía) y el log `store pruned ... older than 1s` es la segunda vía de verificación. Aserciones de consistencia interna (N es lo sembrado); los números canónicos del devsensor demo (19/18, q=2) van en el output para comparación. Nace del E2E de las rondas 9-10 de Pulimiento que vivía en workspaces. | bash, go, curl, python3 |

## Uso

```bash
# desde la raíz del repo
python3 scripts/dev-tests/check_openapi.py
python3 scripts/dev-tests/check_openapi.py --self-test   # prueba negativa del propio guard

python3 scripts/dev-tests/webhook_receiver.py --port 9999 --expect 18 --timeout 60
# (en otra terminal) engine -webhook http://127.0.0.1:9999/ingest ...

bash scripts/dev-tests/smoke_auth.sh                      # compila y ejecuta
SMOKE_PORT=17877 SMOKE_API_PORT=17878 bash scripts/dev-tests/smoke_auth.sh
SMOKE_KEEP=1 bash scripts/dev-tests/smoke_auth.sh         # conserva artefactos en /tmp

bash scripts/dev-tests/e2e_store_sequences.sh             # compila y ejecuta las 3 fases
SF_E2E_INGEST_PORT=18177 SF_E2E_API_PORT=18178 bash scripts/dev-tests/e2e_store_sequences.sh
SF_E2E_KEEP=1 bash scripts/dev-tests/e2e_store_sequences.sh   # conserva log/db/binarios en /tmp
SF_E2E_ENGINE=./bin/engine SF_E2E_DEVSENSOR=./bin/devsensor bash scripts/dev-tests/e2e_store_sequences.sh
```

`smoke_auth.sh` elige puertos libres vía `SMOKE_PORT`/`SMOKE_API_PORT`
(por defecto 17877/17878; los escenarios usan +10/+20/+30/+40-sobre-esos
con separación explícita entre ingest, API y receptores) y hace pre-flight:
si un puerto está ocupado por un proceso residual, falla al inicio con
mensaje accionable en vez de producir fallos confusos a mitad de ronda.
Si un motor no llega a arrancar, el smoke vuelca la cola de su log
(`bail_with_log`) para que el diagnóstico no dependa de abrir `/tmp` a mano.

`e2e_store_sequences.sh` comparte la misma disciplina: puertos propios por
defecto (18077/18078, fuera del rango +40 del smoke para poder convivir),
pre-flight de puertos y binarios frescos compilados en un tmpdir salvo que
se pasen `SF_E2E_ENGINE`/`SF_E2E_DEVSENSOR` (un binario stale produce
síntomas engañosos — misma lección del escenario 5). Si el motor no arranca
en cualquier fase, vuelca la cola del log y sale.

Registro de depuraciones que dejaron funcionalidad (mismo patrón que el
director recomienda documentar): (1) `kill $!` sobre el subshell de arranque
no alcanzaba al binario del motor — motores huérfanos retenían puertos;
(2) offsets de puerto colisionaban entre ingest y API de un mismo motor con
los defaults adyacentes; (3) `--expect` exigía igualdad exacta y fallaba con
ráfagas de entregas; (4) binarios stale del entorno agente hacen fallar el
escenario 5 — recompilar (el script lo dice ahora por sí solo); (5) capturar
`$(grep -c ... || echo 0)` duplica la salida — `grep -c` ya imprime 0 sin
match, así que el eco extra producía "0\n0" y reventaba el `-ge` siguiente
(lección de la primera ejecución del e2e de store).

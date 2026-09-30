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
| `smoke_auth.sh` | Smoke de seguridad con binarios reales (compila `cmd/engine` y `cmd/devsensor` si no se pasan como argumentos; los binarios deben ser recientes — un motor viejo no conoce `-token-previous` ni `-lifecycle` y el escenario que lo use lo dirá con la cola del log). 8 escenarios de README: (1-4) auth del ingest — tokens coincidentes, token erróneo, sensor con token contra motor sin token, bind `0.0.0.0` sin token; (5) rotación sin downtime `-token-previous` — token viejo Y nuevo aceptados en ventana, intruso rechazado; (6) webhook autenticado — entrega con Bearer confirmada por el receptor del repo, y motor sin token contra receptor exigente → 401s → `webhook_failed`; (7) auth de la API local `-api-token` — `/api/*` responde 401 sin token y 200 con Bearer, `/api/health` queda abierta para probes; (8) r6: la superficie de ESCRITURA del ciclo de vida está gated igual — `POST /api/alerts/{id}/status` responde 401 sin Bearer (con challenge), 200 con él; una cola de triaje que cualquiera pudiera reescribir no es un control. | bash, go, curl, python3 |
| `smoke_lifecycle.sh` | Smoke E2E del ciclo de vida de alertas (r6) contra el motor real: telemetría real (volcado de LSASS via comsvcs sobre el feed TCP) dispara una regla → la alerta lleva `id` del motor (16 hex) y estado `new` → `POST /api/alerts/{id}/status` reconoce con nota → `GET /api/alerts` devuelve el overlay mezclado (status/note/by/at) en AMBOS modos (anillo y store) → estados inválidos e ids malformados responden 400 con cuerpo accionable → el export CSV lleva las columnas `id`/`status` → tras REINICIAR el motor, el registro de triaje sobrevive en el fichero `-lifecycle`. Con `-store`, la visibilidad estado+alerta tras reinicio es directa (la alerta persistida re-encuentra su estado); sin store, el fichero garantiza el registro de auditoría y la alerta en memoria se pierde con el anillo. | bash, go, curl, python3 |
| `store_smoke.sh` | Smoke del store SQLite opt-in con binarios reales (misma convención de compilación que `smoke_auth.sh`; un motor viejo no conoce `-store` y el escenario 2 lo dirá con la cola del log). 4 escenarios de README: (1) sin `-store` el motor se comporta como siempre — `store_enabled=false`, `store_events=0`; (2) con `-store` y una pasada del devsensor — `store_enabled=true`, contadores `store_events`/`store_alerts` vivos y `/api/events` sirviendo la igualdad exacta del histórico persistido; (3) kill + reinicio sobre el MISMO fichero — los contadores en proceso vuelven a 0 mientras el store re-siembra los valores previos, la API sirve el historial completo y la búsqueda libre (`q=lsass`) consulta el store; (4) store inabrible (un directorio como fichero) — FATAL en el arranque con línea de log sonora: la persistencia que el operador cree armada no puede quedar silenciosamente desarmada. No ejercita aquí el podador de retención (ticker de 5 min) ni la idempotencia de INSERT con IDs repetidos — cubiertos por los tests unitarios de `internal/store` (y la poda de retención tiene además E2E en la fase C de `e2e_store_sequences.sh`); ojo: cada replay del devsensor genera IDs frescos, así que repetir la pasada AÑADE filas por diseño. | bash, go, curl, python3 |
| `e2e_store_sequences.sh` | E2E de la ruta 10 (`GET /api/sequences`) y del store SQLite opt-in sobre el mismo fichero, en tres fases: **A. live** — 4 secuencias con los 7 campos del schema, `store_enabled=true`, `store_events` tras el feed del devsensor, correlator `4/8192`, lista coherente con el contador; **B. reinicio real** — el motor se mata y rearranca sobre el mismo fichero: `store_events` re-sembrado N→N, `events_total` in-proceso a 0, historial completo servido desde el store, `q=lsass` operativo; **C. retención** — reinicio con `-store-retention 1s`: la primera poda es síncrona en el arranque, así que a health-up el store ya está vacío (`store_events=0`, lista vacía) y el log `store pruned ... older than 1s` es la segunda vía de verificación. Aserciones de consistencia interna (N es lo sembrado); los números canónicos del devsensor demo (19/18, q=2) van en el output para comparación. Nace del E2E de las rondas 9-10 de Pulimiento que vivía en workspaces. | bash, go, curl, python3 |
| `e2e_beacon.sh` | E2E del detector de beaconing (paquete A3) sobre binarios reales, en tres fases: **A. config por defecto** — el suelo `min_interval` de `beacons.yaml` del repo frena de verdad un beacon rápido a 300ms (el knob anti-falsos-positivos funciona, no es decorativo); **B. perfil agresivo de prueba** — detección EXACTA (1 alerta `bcn-e2e-01` cuyo resumen nombra destino:puerto, cadencia y jitter), cooldown (2a ráfaga inmediata NO re-dispara: `fired` queda en 1), triage (`POST /api/alerts/{id}/status` sobre la alerta beacon → overlay acknowledged) y paridad stats/metrics (`beacons_tracked/cap/fired` contra `sf_beacon_*`); **C. supresión** — el wrapper SetEmit del detector honra el allowlist (perfil+host) igual que reglas y secuencias. Cazó dos defectos reales de método en su propia primera versión: la carrera de re-bind (el health probe pasaba contra el engine VIEJO tras un restart) y el fallback exe-adyacente de `resolveDataFile`, que cargaba el fixture de supresión de la fase C en la fase B — por eso el fixture NO se llama `suppressions.yaml` y los restarts esperan puerto libre. | bash, go, curl, python3, rg |
| `e2e_threshold.sh` | E2E del detector volumétrico de umbrales (paquete A2) sobre binarios reales, en tres fases: **A. pack por defecto** — el escenario canónico del devsensor NO dispara ningún umbral de `thresholds.yaml` (keys=0: el pack conservador no genera ruido de laboratorio); **B. definición agresiva de prueba** — el burst del devsensor dispara EXACTAMENTE 1 alerta (`thr-e2e-01`), cooldown (2º burst mantiene 1), triage acknowledged sobre la alerta threshold (mismo ciclo de vida que reglas) y paridad stats/metrics (`threshold_fired` contra `sf_thresholds_fired_total`); **C. supresión** — el wrapper SetEmit honra el allowlist (rule_id+host) y ninguna cadena del correlator avanza con alertas de umbral (dictamen Q3). | bash, go, curl, python3, rg |
| `e2e_risk_a1.sh` | E2E del KPI de riesgo por host (paquete A1) sobre binarios reales, en cinco fases: **A. scoring exacto con fixture hermético** — 3 reglas de prueba (high/medium/low, 1 evento canónico cada una) → `LAB-WKS-01` score 8.0 en banda de decay, alerts=3, tracked=1, schema del wire completo y replay repetido que NO duplica (dedup rule\|host\|pid del motor); **B. el triaje NO refunda** — cerrar las 3 alertas deja el score idéntico (el score modela lo que el motor VIÓ; el lifecycle, lo que el operador DECIDIÓ); **C. paridad stats/metrics** — `sf_risk_hosts_tracked` y `sf_host_risk_score{host=...}` contra el JSON de `/api/stats`; **D. señal viva** — tras reiniciar el motor el score se resetea (tracked=0, `hot_hosts=[]`, serie ausente de `/metrics`) mientras el fichero de lifecycle conserva las 3 closed: resetear el KPI no es perder la auditoría; **E. pack real del repo** — consistencia SIN número exacto (hermética a la evolución del pack: `hot_hosts[0].alerts == alerts_total`, paridad intacta). Nace de la deuda formal 21h58 §7.1a (el E2E original de la ronda 09h30, score 129.79 con el pack del repo, nunca fue committeado y su número murió con cada regla añadida — lección 21h36 §5 de reproducibilidad). | bash, go, curl, python3, rg |

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

bash scripts/dev-tests/store_smoke.sh                     # compila y ejecuta
STORE_SMOKE_PORT=17887 STORE_SMOKE_API_PORT=17888 bash scripts/dev-tests/store_smoke.sh
SMOKE_KEEP=1 bash scripts/dev-tests/store_smoke.sh        # conserva db y logs en /tmp

bash scripts/dev-tests/e2e_store_sequences.sh             # compila y ejecuta las 3 fases
SF_E2E_INGEST_PORT=18177 SF_E2E_API_PORT=18178 bash scripts/dev-tests/e2e_store_sequences.sh
SF_E2E_KEEP=1 bash scripts/dev-tests/e2e_store_sequences.sh   # conserva log/db/binarios en /tmp
SF_E2E_ENGINE=./bin/engine SF_E2E_DEVSENSOR=./bin/devsensor bash scripts/dev-tests/e2e_store_sequences.sh

bash scripts/dev-tests/smoke_lifecycle.sh                 # ciclo de vida E2E (r6)
SMOKE_API_PORT=17879 SMOKE_INGEST_PORT=17877 bash scripts/dev-tests/smoke_lifecycle.sh

bash scripts/dev-tests/e2e_beacon.sh                      # beaconing E2E (A3): 3 fases
SF_E2E_INGEST_PORT=18097 SF_E2E_API_PORT=18098 bash scripts/dev-tests/e2e_beacon.sh
SF_E2E_KEEP=1 bash scripts/dev-tests/e2e_beacon.sh        # conserva log/binarios en /tmp

bash scripts/dev-tests/e2e_threshold.sh                   # umbrales E2E (A2): 3 fases
SF_E2E_INGEST_PORT=18107 SF_E2E_API_PORT=18108 bash scripts/dev-tests/e2e_threshold.sh

bash scripts/dev-tests/e2e_risk_a1.sh                     # riesgo por host E2E (A1): 5 fases
SF_E2E_INGEST_PORT=18127 SF_E2E_API_PORT=18128 bash scripts/dev-tests/e2e_risk_a1.sh
SF_E2E_KEEP=1 bash scripts/dev-tests/e2e_risk_a1.sh       # conserva log/fixtures en /tmp
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
en cualquier fase, vuelca la cola del log y sale. `store_smoke.sh` usa por
defecto 17887/17888 (el offset +10 del smoke), así que con defaults no es
simultáneo con `smoke_auth.sh`; los tres scripts conviven si se reparten
puertos por env. Nacieron en paralelo (rondas concurrentes del mismo rol en
dos entornos: la 9ª convergencia del proyecto) y son complementarios por
registro: `store_smoke.sh` aporta el FATAL de store inabrible y el modo
default; `e2e_store_sequences.sh`, la ruta 10 del correlador y la poda de
retención E2E.

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

# dev-tests — scripts de verificación end-to-end

Herramientas de prueba que complementan los tests unitarios (`go test ./...`,
`bun test`) validando el producto **con binarios y procesos reales**, tal como
haría un operador. Nacieron de traer al repo los scripts de prueba que
vivían en espacios de trabajo individuales, para que cualquiera pueda
replicar las validaciones E2E.

Ninguno de estos scripts forma parte del producto instalado; requieren
herramientas de desarrollo (go, python3) y solo escuchan en loopback.

Los generadores `scenario/` y `bench/` aceptan solo IPs literales loopback;
no se distribuyen con el producto. Los scripts existentes compilan el
escenario desde aquí, sin depender de un comando productivo `devsensor`.
`check_installer_behavior.ps1` prueba actualización/conservación de datos y
una instalación real de motor/colector en Windows PowerShell 5.1.

| Script | Qué valida | Requiere |
|--------|-----------|----------|
| `check_openapi.py` | Que `docs/api/openapi.yaml` esté en sincronía estructural con `internal/api/api.go`: (1) rutas servidas declaradas (y ninguna de más); (2) esquema `Stats` campo a campo contra los wire tags de `statsPayload` (struct sin `omitempty`: todo campo es siempre emitido y por tanto requerido); (3) **seguridad**: cuando `api.go` registra el middleware Bearer (`h.auth(mux)`) — detectado parseando el código, no hardcodeado — el spec debe declarar `securitySchemes.bearerAuth` (http/bearer), cada operación de ruta servida debe declarar su propio `security` con el modismo de auth opcional (`bearerAuth: []` + entrada anónima `{}`: el token solo se exige con `-api-token`), y las rutas que el middleware exenta (parseadas de `auth()`) deben forzar acceso anónimo con `security: []`; (4) el `example` del cuerpo 401 (`components.responses.Unauthorized`) debe coincidir byte a byte con el JSON que el middleware escribe realmente (el `Fprintln` dentro de `auth()`), de modo que el contrato de error documentado no pueda derivar del cable; (5) cada `$ref` del documento (a cualquier profundidad) debe resolver a un nodo dentro del propio spec — un ref colgante es rotura silenciosa para validadores, generadores y docs, y las referencias externas se rechazan porque el spec es deliberadamente un único fichero autocontenido. Detectó de verdad las derivas de `ingest_rejected` y del `security` ausente antes de corregirlas. `--self-test` mantiene en el árbol la prueba negativa del propio guard (1 fixture positiva + 10 mutaciones que deben producir un hallazgo concreto), de modo que CI ejercita el validador y no solo el spec vigente. | python3 + PyYAML |
| `notify_receiver.py` | Receptor de laboratorio para los canales de notificación (C2): cualquier POST se registra (ruta + cuerpo JSON) en un fichero de captura JSONL y se responde 200 `{"ok":true}` a modo de Slack / Bot API de Telegram; acepta `--expect N --timeout S` (exit 0 al llegar N payloads) para uso desde scripts. El espejo receptor de `-notify` (verificado E2E en `smoke_notify.sh`: texto de Slack con la línea renderizada, `chat_id` de Telegram en la ruta `/bot<token>/sendMessage`). | python3 (stdlib) |
| `webhook_receiver.py` | Receptor HTTP mínimo para probar la entrega de webhook del motor: cuenta POSTs, acepta `--expect N --timeout S` (exit 0 cuando llegan N o más; las entregas pueden llegar en ráfaga) y `--secret` para exigir `Authorization: Bearer` — el espejo receptor de `-webhook-token` del motor (verificado E2E: sin cabecera correcta responde 401 y el motor lo cuenta en `webhook_failed`). | python3 (stdlib) |
| `check_installer_path.ps1` | Comprobaciones del instalador seguras en una máquina de desarrollo: el orden del PATH de usuario se prueba contra una clave de registro de pruebas (`HKCU\Software\BluetardigradeInstallerTest`), sin tocar el PATH real. Verifica que una instalación antigua delante en el PATH hace que la nueva pase al frente, que las entradas `%VARIABLE%` sobreviven como `REG_EXPAND_SZ`, que sin conflicto se añade al final, que un `engine.exe` en ejecución detiene la actualización antes de modificar nada y que la salida UTF-8 de las herramientas se decodifica bien. | Windows PowerShell 5.1 |
| `smoke_auth.sh` | Smoke de seguridad con binarios reales (compila `cmd/engine` y `scripts/dev-tests/scenario` si no se pasan como argumentos; los binarios deben ser recientes — un motor viejo no conoce `-token-previous` ni `-lifecycle` y el escenario que lo use lo dirá con la cola del log). 8 escenarios de README: (1-4) auth del ingest — tokens coincidentes, token erróneo, sensor con token contra motor sin token, bind `0.0.0.0` sin token; (5) rotación sin downtime `-token-previous` — token viejo Y nuevo aceptados en ventana, intruso rechazado; (6) webhook autenticado — entrega con Bearer confirmada por el receptor del repo, y motor sin token contra receptor exigente → 401s → `webhook_failed`; (7) auth de la API local `-api-token` — `/api/*` responde 401 sin token y 200 con Bearer, `/api/health` queda abierta para probes; (8) r6: la superficie de ESCRITURA del ciclo de vida está gated igual — `POST /api/alerts/{id}/status` responde 401 sin Bearer (con challenge), 200 con él; una cola de triaje que cualquiera pudiera reescribir no es un control. | bash, go, curl, python3 |
| `smoke_ingest_tls.sh` | Smoke E2E del transporte TLS nativo del ingest (complementa `internal/ingest/ingest_tls_test.go` con despliegue real): PKI de laboratorio generada con openssl (hoja autofirmada, IP SAN 127.0.0.1, CA:true — misma forma que la que construyen los tests unitarios con crypto/x509) + 7 escenarios — (1) round trip TLS con banner `ingest TLS: ENABLED` y 19 eventos; (2) sensor EN CLARO contra puerto TLS → fallo visible y `events_total` inmóvil (los bytes en claro no se ingieren); (3) sensor con CA NO relacionada → handshake rechazado, 0 eventos; (4) TLS compone con el token AUTH — sensor autenticado sobre canal cifrado, intruso rechazado; (5) `-ingest-cert` sin `-ingest-key` → el motor se niega a arrancar ANTES del bind y nada queda escuchando; (6) fichero de cert ausente → FATAL nombrando la ruta; (7) ROTACIÓN EN CALIENTE — los PEM se reemplazan in-place: la conexión nueva presenta el cert NUEVO (validada contra la CA nueva), el sensor con la CA vieja es rechazado, la conexión previa sigue viva, el log dice `certificate reloaded` y el MISMO proceso del motor nunca reinicia (un solo `listening on`). Puertos: 17977/17978 (+10/+20/+30/+40), SMOKE_TLS_PORT/SMOKE_TLS_API_PORT. | bash, go, curl, openssl |
| `smoke_notify.sh` | Smoke E2E de los canales de notificación externos (C2) contra el motor real con `-notify`: telemetría real (LSASS comsvcs = critical + certutil = high) se reparte a 4 canales de laboratorio — slack-all recibe 2, telegram 2, slack-crit-only (`min_severity: critical`) recibe 1 y FILTRA 1 (silencio configurado, contado como dato), email apuntando a un relay muerto agota reintentos con `failed=2` SIN tocar la salud del motor; las capturas del mock llevan los contratos de canal (slack `{"text": ...}` con la línea renderizada; telegram `chat_id` + `text` en la ruta Bot API) y `/api/stats` expone `notify_channels` completo (sent/failed/dropped/filtered por canal); config rota (tipo inexistente) → el motor se niega a arrancar nombrando el problema (fail-loud, con puertos alternos porque el bind del ingest va ANTES de la carga de notify — semántica de bind verificada en vivo). Puertos: 18301 (receptor) / 18302 (API) / 18303 (ingest), SMOKE_RECEIVER_PORT/SMOKE_API_PORT/SMOKE_INGEST_PORT. | bash, go, curl, python3 |
| `smoke_lifecycle.sh` | Smoke E2E del ciclo de vida de alertas (r6) contra el motor real: telemetría real (volcado de LSASS via comsvcs sobre el feed TCP) dispara una regla → la alerta lleva `id` del motor (16 hex) y estado `new` → `POST /api/alerts/{id}/status` reconoce con nota → `GET /api/alerts` devuelve el overlay mezclado (status/note/by/at) en AMBOS modos (anillo y store) → estados inválidos e ids malformados responden 400 con cuerpo accionable → el export CSV lleva las columnas `id`/`status` → tras REINICIAR el motor, el registro de triaje sobrevive en el fichero `-lifecycle`. Con `-store`, la visibilidad estado+alerta tras reinicio es directa (la alerta persistida re-encuentra su estado); sin store, el fichero garantiza el registro de auditoría y la alerta en memoria se pierde con el anillo. | bash, go, curl, python3 |
| `smoke_store.sh` | Smoke del store SQLite opt-in con binarios reales (misma convención de compilación que `smoke_auth.sh`; un motor viejo no conoce `-store` y el escenario 2 lo dirá con la cola del log). 4 escenarios de README: (1) sin `-store` el motor se comporta como siempre — `store_enabled=false`, `store_events=0`; (2) con `-store` y una pasada del devsensor — `store_enabled=true`, contadores `store_events`/`store_alerts` vivos y `/api/events` sirviendo la igualdad exacta del histórico persistido; (3) kill + reinicio sobre el MISMO fichero — los contadores en proceso vuelven a 0 mientras el store re-siembra los valores previos, la API sirve el historial completo y la búsqueda libre (`q=lsass`) consulta el store; (4) store inabrible (un directorio como fichero) — FATAL en el arranque con línea de log sonora: la persistencia que el operador cree armada no puede quedar silenciosamente desarmada. No ejercita aquí el podador de retención (ticker de 5 min) ni la idempotencia de INSERT con IDs repetidos — cubiertos por los tests unitarios de `internal/store` (y la poda de retención tiene además E2E en la fase C de `e2e_store_sequences.sh`); ojo: cada replay del devsensor genera IDs frescos, así que repetir la pasada AÑADE filas por diseño. | bash, go, curl, python3 |
| `e2e_store_sequences.sh` | E2E de la ruta 10 (`GET /api/sequences`) y del store SQLite opt-in sobre el mismo fichero, en tres fases: **A. live** — 4 secuencias con los 7 campos del schema, `store_enabled=true`, `store_events` tras el feed del devsensor, correlator `4/8192`, lista coherente con el contador; **B. reinicio real** — el motor se mata y rearranca sobre el mismo fichero: `store_events` re-sembrado N→N, `events_total` in-proceso a 0, historial completo servido desde el store, `q=lsass` operativo; **C. retención** — reinicio con `-store-retention 1s`: la primera poda es síncrona en el arranque, así que a health-up el store ya está vacío (`store_events=0`, lista vacía) y el log `store pruned ... older than 1s` es la segunda vía de verificación. Aserciones de consistencia interna (N es lo sembrado); los números canónicos del devsensor demo (19/18, q=2) van en el output para comparación. | bash, go, curl, python3 |
| `e2e_beacon.sh` | E2E del detector de beaconing (paquete A3) sobre binarios reales, en tres fases: **A. config por defecto** — el suelo `min_interval` de `beacons.yaml` del repo frena de verdad un beacon rápido a 300ms (el knob anti-falsos-positivos funciona, no es decorativo); **B. perfil agresivo de prueba** — detección EXACTA (1 alerta `bcn-e2e-01` cuyo resumen nombra destino:puerto, cadencia y jitter), cooldown (2a ráfaga inmediata NO re-dispara: `fired` queda en 1), triage (`POST /api/alerts/{id}/status` sobre la alerta beacon → overlay acknowledged) y paridad stats/metrics (`beacons_tracked/cap/fired` contra `sf_beacon_*`); **C. supresión** — el wrapper SetEmit del detector honra el allowlist (perfil+host) igual que reglas y secuencias. Cazó dos defectos reales de método en su propia primera versión: la carrera de re-bind (el health probe pasaba contra el engine VIEJO tras un restart) y el fallback exe-adyacente de `resolveDataFile`, que cargaba el fixture de supresión de la fase C en la fase B — por eso el fixture NO se llama `suppressions.yaml` y los restarts esperan puerto libre. | bash, go, curl, python3, rg |
| `e2e_threshold.sh` | E2E del detector volumétrico de umbrales (paquete A2) sobre binarios reales, en tres fases: **A. pack por defecto** — el escenario canónico del devsensor NO dispara ningún umbral de `thresholds.yaml` (keys=0: el pack conservador no genera ruido de laboratorio); **B. definición agresiva de prueba** — el burst del devsensor dispara EXACTAMENTE 1 alerta (`thr-e2e-01`), cooldown (2º burst mantiene 1), triage acknowledged sobre la alerta threshold (mismo ciclo de vida que reglas) y paridad stats/metrics (`threshold_fired` contra `sf_thresholds_fired_total`); **C. supresión** — el wrapper SetEmit honra el allowlist (rule_id+host) y ninguna cadena del correlator avanza con alertas de umbral (dictamen Q3). | bash, go, curl, python3, rg |
| `e2e_risk_a1.sh` | E2E del KPI de riesgo por host (paquete A1) sobre binarios reales, en cinco fases: **A. scoring exacto con fixture hermético** — 3 reglas de prueba (high/medium/low, 1 evento canónico cada una) → `LAB-WKS-01` score 8.0 en banda de decay, alerts=3, tracked=1, schema del wire completo y replay repetido que NO duplica (dedup rule\|host\|pid del motor); **B. el triaje NO refunda** — cerrar las 3 alertas deja el score idéntico (el score modela lo que el motor VIÓ; el lifecycle, lo que el operador DECIDIÓ); **C. paridad stats/metrics** — `sf_risk_hosts_tracked` y `sf_host_risk_score{host=...}` contra el JSON de `/api/stats`; **D. señal viva** — tras reiniciar el motor el score se resetea (tracked=0, `hot_hosts=[]`, serie ausente de `/metrics`) mientras el fichero de lifecycle conserva las 3 closed: resetear el KPI no es perder la auditoría; **E. pack real del repo** — consistencia SIN número exacto (hermética a la evolución del pack: `hot_hosts[0].alerts == alerts_total`, paridad intacta). Nace de una deuda formal: el E2E original (score 129.79 con el pack del repo, nunca fue committeado) y su número murió con cada regla añadida — lección de reproducibilidad. | bash, go, curl, python3, rg |
| `siem_receiver.py` | Receptores de laboratorio para los sinks SIEM del motor (fixture de prueba etiquetada, espejo receptor de `-elastic`/`-splunk`, misma familia que `webhook_receiver.py`): modo `--protocol elastic` responde como `_bulk` real (un item por pareja meta/doc del cuerpo) y valida la forma NDJSON — pareja meta/doc, `_id` presente (idempotencia de reintentos), prefijo de índice; modo `--protocol splunk` responde como HEC real (200 + `code:0`) y valida el contrato del evento — `time` numérico, `event` objeto con los campos de la alerta, `sourcetype`/`source`, `fields` indexados; `--secret` exige el esquema de auth real de cada plataforma (`ApiKey` / `Splunk`) rechazando con el código del protocolo; `--stats-file` vuelca los contadores tras cada frame (lectura sin señales). | python3 (stdlib) |
| `e2e_siem.sh` | E2E de los conectores SIEM (Elasticsearch `_bulk` + Splunk HEC) sobre binarios reales, en tres fases: **A. entrega real a ambos sinks** — el replay canónico del devsensor llega EXACTO una vez a cada plataforma (recepción == `elastic_sent` == `splunk_sent` == `alerts_total`), forma de protocolo verificada por los receptores (cero frames malformados, credenciales correctas, índices `sf-alerts-YYYY.MM.DD`), paridad stats/metrics (`sf_elastic_sent_total`/`sf_splunk_sent_total` contra `/api/stats`) y apagado ordenado sin pérdida; **B. control negativo** — motor sin `-elastic`/`-splunk`: las 6 stats de sinks a cero y cero peticiones a los receptores (nadie entrega por accidente); **C. credencial errónea = falla visible** — receptores con credencial buena + motor con credencial incorrecta: agotados los reintentos, `elastic_failed`/`splunk_failed` >= `alerts_total` y el receptor NO aceptó nada (una credencial mala no puede convertirse en éxito silencioso). | bash, go, curl, python3, rg |
| `check_powershell_syntax.ps1` | Guard de sintaxis PowerShell: parsea cada `.ps1` del árbol con el parser AST real de PowerShell (`Parser::ParseFile`) y falla en el primer error con fichero, línea y mensaje. Nació de un incidente real: `"cannot verify $Url: …"` en `install.ps1` es un error de PARSEO (`InvalidVariableReferenceWithDrive`: `:` tras una variable se lee como calificador de ámbito/drive, igual que `$env:`), así que `irm \| iex` abortaba antes de ejecutar un solo paso — con el CI en verde porque nada parseaba los `.ps`. CI lo ejecuta dos veces (pwsh en Ubuntu y **Windows PowerShell 5.1** en el job Windows, el parser que de verdad corre `irm \| iex` en una máquina stock); `make ci` lo corre si hay pwsh en el PATH. La verificación de conducta de Windows (smoke_respond) es un check aparte: este guard certifica solo que los scripts PARSEAN, no lo que hacen. | pwsh 7 o Windows PowerShell 5.1 |
| `check_installer_native_stderr.py` | Guard de redirección de stderr en nativos: ninguna línea de `install.ps1`/`uninstall.ps1` puede contener `2>&1` o `2>$null` fuera del helper `Invoke-Native` (que corre con `EAP=Continue` y juzga por exit code). Nació del segundo crash real del instalador: `git clone` SIEMPRE abre con una línea de stderr («Cloning into …»), y bajo `$ErrorActionPreference='Stop'` PowerShell 5.1 convierte la primera línea redirigida en `NativeCommandError` terminante — `2>&1` y `2>$null` materializan el ErrorRecord ANTES de descartarlo, así que el instalador moría en el propio banner de progreso de git (con `2>$null`, el mismo efecto en cualquier probe `reg`/`netsh` que escribiera stderr). El helper `Invoke-Native` es el único patrón sancionado: muestra el progreso, conserva el texto para el diagnóstico y hace throw con el exit code y el detalle real. `--self-test` mantiene en el árbol las 3 fixtures del crash original (clone `2>&1`, probe `2>$null`, versión por variable) que DEBEN producir hallazgo. | python3 (stdlib) |

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

bash scripts/dev-tests/smoke_ingest_tls.sh                # TLS del ingest E2E: 7 escenarios
SMOKE_TLS_PORT=17977 SMOKE_TLS_API_PORT=17978 bash scripts/dev-tests/smoke_ingest_tls.sh
SMOKE_KEEP=1 bash scripts/dev-tests/smoke_ingest_tls.sh   # conserva certs y logs en /tmp

bash scripts/dev-tests/smoke_store.sh                     # compila y ejecuta
SMOKE_INGEST_PORT=17887 SMOKE_API_PORT=17888 bash scripts/dev-tests/smoke_store.sh
SMOKE_KEEP=1 bash scripts/dev-tests/smoke_store.sh        # conserva db y logs en /tmp

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

bash scripts/dev-tests/e2e_siem.sh                        # sinks SIEM E2E: 3 fases
SF_E2E_INGEST_PORT=18147 SF_E2E_API_PORT=18148 bash scripts/dev-tests/e2e_siem.sh
SF_E2E_ELASTIC_PORT=18149 SF_E2E_SPLUNK_PORT=18150 bash scripts/dev-tests/e2e_siem.sh
SF_E2E_KEEP=1 bash scripts/dev-tests/e2e_siem.sh          # conserva log/resúmenes en /tmp
```


`smoke_auth.sh` elige puertos libres vía `SMOKE_PORT`/`SMOKE_API_PORT`
(por defecto 17877/17878; los escenarios usan +10/+20/+30/+40-sobre-esos
con separación explícita entre ingest, API y receptores) y hace pre-flight:
si un puerto está ocupado por un proceso residual, falla al inicio con
mensaje accionable en vez de producir fallos confusos difíciles de atribuir.
Si un motor no llega a arrancar, el smoke vuelca la cola de su log
(`bail_with_log`) para que el diagnóstico no dependa de abrir `/tmp` a mano.

`e2e_store_sequences.sh` comparte la misma disciplina: puertos propios por
defecto (18077/18078, fuera del rango +40 del smoke para poder convivir),
pre-flight de puertos y binarios frescos compilados en un tmpdir salvo que
se pasen `SF_E2E_ENGINE`/`SF_E2E_DEVSENSOR` (un binario stale produce
síntomas engañosos — misma lección del escenario 5). Si el motor no arranca
en cualquier fase, vuelca la cola del log y sale. `smoke_store.sh` usa por
defecto 17887/17888 (el offset +10 del smoke), así que con defaults no es
simultáneo con `smoke_auth.sh`; los tres scripts conviven si se reparten
puertos por env. Nacieron en paralelo (dos entornos concurrentes) y son complementarios por
registro: `smoke_store.sh` aporta el FATAL de store inabrible y el modo
default; `e2e_store_sequences.sh`, la ruta 10 del correlador y la poda de
retención E2E.

Registro de depuraciones que dejaron funcionalidad (mismo patrón que el
resto del registro del repo): (1) `kill $!` sobre el subshell de arranque
no alcanzaba al binario del motor — motores huérfanos retenían puertos;
(2) offsets de puerto colisionaban entre ingest y API de un mismo motor con
los defaults adyacentes; (3) `--expect` exigía igualdad exacta y fallaba con
ráfagas de entregas; (4) binarios stale del entorno hacen fallar el
escenario 5 — recompilar (el script lo dice ahora por sí solo); (5) capturar
`$(grep -c ... || echo 0)` duplica la salida — `grep -c` ya imprime 0 sin
match, así que el eco extra producía "0\n0" y reventaba el `-ge` siguiente
(lección de la primera ejecución del e2e de store).

## Functional console DOM checks

These optional checks mount the real engine provider and dashboard with
isolated REST/SSE fixtures. They verify replay/triage preservation, rule
reload, idle activity expiry, queue navigation, optional 404 handling,
concurrent snapshot frames, live-channel warnings, outage/recovery, pinned
historical navigation, POST-only triage, lifecycle deep links, superseded
queries, batched decisions, memory-only limits, older engines, forensic
retries, complete JSON/JSONL exports, stale evidence responses and cleanup.
The 34 checks include report drafts/exports/revision conflicts/orphan snapshots and saved-search capture/application, cross-tab updates,
text rendering and blocked/corrupt storage handling.
They do not certify browser layout or replace the native Bun integration suite.

From the repository root, with the console dependencies already installed:

```bash
npm install --prefix tools/console-tests --no-audit --no-fund esbuild@0.25.11 jsdom@26.1.0
node scripts/dev-tests/check_console_dom.mjs
```

Optional tooling stays in the ignored `tools/` directory. Set
`CONSOLE_TEST_TOOLS` to an absolute tooling directory if using another location.
The script builds a temporary fixture, removes it on completion and returns
nonzero on failure. Requires Node.js 20+.

The same two commands are wired into `make console-dom`, the `ci` recipe and
the console job of `.github/workflows/ci.yml`, so the fixture no longer relies
on manual runs to catch regressions.

## File detections and frozen evidence

`smoke_file_forensics.py` starts a real engine on authenticated loopback
listeners, sends eleven inert fixture records and verifies eight alerts
(the six new file alarms, Startup and the Office-parent alarm), no alert
for an ordinary Office document, and six complete high/critical evidence
bundles through the bearer-gated API. Medium alerts have no bundle.
It clears inherited `SF_*` variables in the child, never arms response or
external sinks, and removes the temporary state after stopping its engine.
No attack commands are executed and no Windows collector is exercised.

```bash
go build -o bin/engine-file-smoke ./cmd/engine
python3 scripts/dev-tests/smoke_file_forensics.py --engine ./bin/engine-file-smoke
```

This smoke runs in the engine CI job and `make ci`. It uses Python's
standard library; PyYAML is only required by the separate documentation
guard `check_rule_inventory.py`.
It waits for the expected published alerts before comparing results:
`events_total` is updated before detection and evidence capture finish.

## Chromium console regression

`check_console_browser.mjs` runs the built application in Chromium. The
browser uses isolated REST responses and an SSE fixture; it never sends
triage or commands to a live engine. Seventeen checks exercise command search,
keyboard navigation, focus containment/restoration, URL lenses and history,
busy refresh, help handoff, composition/consumed events, historical paging,
POST-only triage, dashboard triage shortcuts/history restoration, mobile
access, reduced motion, forensic retries and real JSON/JSONL downloads
that retain the complete alert and telemetry fields, plus saved searches,
cross-tab storage events, browser Back/reload, query bounds and mobile fit.
The demo indicator is checked after hydration and on mobile. Fixture screenshots are
stored in the ignored `captures/browser-regression/` directory.
The initial load and the final page must also be free of browser runtime
errors, including server/client hydration mismatches under reduced motion.
Command navigation updates the URL before transferring focus on the next
animation frame. Its focus check waits up to five seconds for the content
to receive focus; it still fails if the transfer never happens.

From the repository root, after installing and building `web/console`:

```bash
make console-browser
```

The target pins Playwright 1.63.0 outside the application dependency graph.
It installs Chromium and starts the production console on loopback port
3100; the runner closes both browser and server even on failure. Linux hosts
without browser libraries can install them with:

```bash
node tools/console-tests/node_modules/playwright/cli.js install --with-deps chromium
```

`CONSOLE_TEST_TOOLS` selects another absolute tooling directory.
`CONSOLE_BROWSER_URL=http://127.0.0.1:3000` uses an already running console,
and `CONSOLE_CHROMIUM_PATH` selects an existing Chromium executable. External
HTTP hosts are rejected. Browser checks require Node.js 20+.

The same runner is part of `make ci` and the console job after the production
build. CI retains labelled fixture captures, including a failure screenshot,
as the `console-browser-regression` artifact for seven days. The checks
verify browser behavior; they do not certify a live ETW capture, the engine
transport or every UI flow. Cross-browser and additional mobile interaction
coverage remain follow-up work.

## Incremento SOC

```bash
go build -o bin/engine-soc-smoke ./cmd/engine
go build -o bin/collector-soc-smoke ./cmd/collector
python3 scripts/dev-tests/smoke_soc_pipeline.py --engine ./bin/engine-soc-smoke --collector ./bin/collector-soc-smoke
```

El smoke usa logs/MIME generados e inertes y binarios reales en loopback
con AUTH, API bearer y SQLite: seis formatos, siete registros, ocho alertas,
forensics, reconocimiento/cierre, informe CLI y rechazo de sobrescritura.
No contacta proveedores ni ejecuta ataques. La suite DOM incluye borradores,
actualizaciones lifecycle, descargas, conflictos, corrupción, cuota y catálogo
huérfano. Chromium añade guardado/reload/export exacto, bounds móvil y catálogo;
las capturas se etiquetan como fixtures. Las verificaciones DOM son 34 y las
verificaciones Chromium son 20 en la suite actual.

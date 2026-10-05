# Roadmap — Implementación A (motor y backend)

Archivo vivo de continuidad del carril `carril/implementacion-a`. Se actualiza al final de
cada ronda: qué está a medias, qué sigue y por qué.

## Estado actual

- Ronda 2026-10-05 12h36 cerrada (informe: `ronda_2026-10-05_12h36_A.md`). Entregado SIM-1 y
  SIM-2 completos: biblioteca `scenarios/` con 127 escenarios (114 reglas habilitadas + 13
  cadenas), etiqueta `simulation` propagada a toda alerta derivada de evidencia simulada,
  reproductor `engine scenarios list|replay` solo-loopback, red de regresión en CI y E2E
  contra motor de laboratorio real. La rama se publicó esta ronda: los commits de la ronda
  anterior estaban solo en local (faltaba credencial de push; ya resuelto).
- Ronda 2026-10-05 14h45 cerrada (informe: `ronda_2026-10-05_14h45_A.md`). Entregado SIM-4
  parte A: superficie API de validación bajo demanda (`GET /api/scenarios`,
  `POST /api/scenarios/run`, `GET /api/scenarios/runs`, `GET /api/scenarios/runs/{id}`),
  flag `-scenarios`, historial en SQLite (`scenario_runs`, últimos 200) o en memoria
  (últimos 50), paquete `internal/scenrun`, ejecución aislada reutilizando el runner de CI
  (nada de una ejecución llega a los anillos/store/webhook del motor), OpenAPI actualizada
  (34 rutas) y E2E ampliada con la fase E (19 comprobaciones; 21 en modo completo, batería
  127/127 por API). También el ALTA de Seguridad B: `x/text` v0.3.8 → v0.39.0
  (GO-2026-5970) en esta rama (hereda de `feat/enrollment`).
- Ronda 2026-10-05 14h55 cerrada (informe: `ronda_2026-10-05_14h55_A.md`). Entregado
  **REP-1 parte A** (catálogo `GET /api/reports` + `GET /api/reports/{kind}`:
  executive, incident, fleet, soc; JSON y CSV; honestidad de origen store/ring y tope de
  escaneo declarado), la **API de ruido** §2.4 (`GET /api/noise`: procesos por imagen,
  dominios DNS, reglas con overlay de triage; por host y flota) y el fix **SEC-A-1**
  (unicidad del nombre de identidad en el alta). OpenAPI 34 → 37 rutas. E2E nueva
  `e2e_reports_noise.sh` (33 comprobaciones). Flake determinista corregido en
  `TestScenarioEndpointsRoundTrip` (código propio de la ronda SIM-4). El entorno se
  reinició entre rondas: Go re-instalado (1.26.0) y GOPROXY alternativo documentado en
  el informe.
- Ronda 2026-10-05 21h15 cerrada (informe: `ronda_2026-10-05_21h15_A.md`). Entregados
  **AD-1** (conector LDAP de solo lectura: `internal/ad`, flag `-ad`, snapshot SQLite
  reemplazado atómicamente por sincronización, LDAPS/StartTLS con CA obligatoria,
  contraseña en fichero propio re-leída por sincronización, filtros literales,
  paginación RFC 2696 crítica, tope de objetos, fixture LDAP propio en loopback para
  los tests) y **AD-2** (`internal/ad/posture.go`: 10 hallazgos del TODO, severidad,
  objetos afectados con tope 50, remediación, puntuación 0-100 con historial de 500
  puntos; recomputado tras cada sincronización), más **SET-3 lado motor**
  (`version`, `alert_latency` p50/p95/max, `store_size_bytes`, `certificates` en
  `/api/stats`) y la fila `-scenarios` en `docs/OPERATIONS.md` (petición de PUL-A).
  OpenAPI 37 → 41 rutas. Nueva dependencia `github.com/go-ldap/ldap/v3` (justificación
  para SEG-B en el informe). El entorno se reinició de nuevo: Go 1.26.8 re-instalado.

## A medias

- Nada a medias: AD-1, AD-2 y SET-3 lado motor quedaron completos y verificados.
- AD-1/AD-2 quedan a la espera de su parte de consola (AD-5/AD-6, IMP-B): los contratos
  JSON están publicados en OpenAPI y en el informe de esta ronda.
- SIM-4 sigue a la espera de su parte B (pantalla de la consola, IMP-B); REP-1 igual.
- El informe de ruido sirve hoy `closed_pct`/`acknowledged_pct` (estado actual del
  triage). Cuando el campo de decisión de triaje exista (petición MEDIA de IMP-B, ronda
  propia de este carril), migrará a `false_positive_pct`.

## Cola de tareas del carril (orden pretendido)

1. **SEC-2**: credencial del sensor cifrada con DPAPI (sensor Rust, parte Windows;
   pendiente de esta ronda por tamaño: no cabía un DPAPI correcto y verificado junto
   al conector AD).
2. **Campo de decisión de triaje** (petición MEDIA de IMP-B): `decision:
   false_positive | authorized_activity | confirmed_incident` en el ciclo de vida
   (`POST /api/alerts/{id}/status` + store + OpenAPI), que desbloquea el «falso
   positivo» del flujo del triaje y convierte los porcentajes del ruido en FP% real.
3. **v1.1 Ruido**: supresiones con condiciones (PLAN-DETALLADO §2.3), lista de software
   conocido por organización (§2.2, `known-software.yaml`; el botón «añadir a software
   conocido» de la pestaña de ruido de IMP-B espera esto) y agrupación de arranques
   repetidos en el sensor (§2.1, parte Rust; requiere cargo en el entorno o pruebas en
   otro sitio).
4. **Motor**: cuotas por equipo en la memoria del motor (v1.1 «Motor y consola»).
5. **AD-6** (API de ajustes AD: horario laboral y umbral de inactividad ya leídos por
   el postura; falta la superficie de escritura decidida con el responsable) y **AD-3**
   cuando WEF exista.
6. **REP-2** informes programados (diarios/semanales en `data/reports` con retención,
   SMTP/webhook opcional): la maquinaria de datos ya existe tras REP-1 parte A.
7. **Diseño**: purga de hosts rechazados/revocados en el registro de alta (observación
   de SEG-A: hoy cuentan para siempre en `MaxHosts`).

## Decisiones y motivos (histórico vivo)

- **SIM-4 ejecuta el runner aislado de CI, no el camino por cable**: la batería bajo demanda
  reutiliza `internal/scenario.Runner` (enriquecimiento → reglas → correlador, orden de
  producción, Manager de alertas privado). Una ejecución no toca anillos, store, webhook ni
  stream del motor: una validación nunca puede confundirse con evidencia (el mismo límite
  que la etiqueta `simulation` garantiza en el camino por cable, que sigue cubierto por
  `engine scenarios replay`). Ventaja añadida: CI y consola validan con el mismo motor de
  ejecución, por construcción; sin dedup cruzada entre escenarios ni necesidad de sufijos de
  host por ejecución.
- **La biblioteca se recarga en cada ejecución y en cada listado**: un YAML editado surte
  efecto sin reiniciar y un fichero mal formado se ve en la consola como 500 con el fichero
  en el error, no enterrado en un log. El estado armado (`-scenarios`) se anuncia en el
  arranque; desarmado las rutas responden 501 con `hint` (patrón forense: «feature off»
  distinguible de un 404).
- **Una ejecución a la vez** (409 con el `run_id` actual en `hint`); el resultado por
  escenario se registra a medida que termina, así que el detalle de una ejecución en vuelo
  muestra progreso real.
- **Historial en SQLite cuando hay `-store`** (tabla `scenario_runs`, JSON de resultados por
  fila, retención de 200 ejecuciones) o en memoria (50) sin él: la tendencia sobrevive al
  reinicio en despliegues con almacén, que es donde tiene sentido.
- **Etiqueta `simulation` de extremo a extremo** (ronda anterior): se propaga a TODA alerta
  derivada de eventos simulados — reglas, cadenas, beacons, umbrales, intel, línea base.
- **Los eventos del escenario se decodifican vía JSON** (el esquema de la capa de
  transporte), no con tags YAML nativos: evita bifurcar el contrato del sensor.
- **Cobertura obligatoria por detección en CI** (`TestScenarioLibraryCoversEveryDetection`).
- **El reproductor CLI solo acepta loopback literal** y valida las expectativas contra el
  catálogo del motor de laboratorio antes de repetir (`FALTA-CATALOGO`).
- Corrección de CLI descubierta en la ronda SIM: los subcomandos nuevos deben registrarse en
  `cmd/engine/main.go` (`isRoutedSubcommand`) ADEMÁS de en el árbol Cobra.
- **El conector AD no tiene primitiva de escritura** (ronda AD): el paquete solo compila
  `bind` y `search` sobre `ldap.Conn`; «solo lectura» es la ausencia de la capacidad, no
  una política. El control de paginación se envía con criticality TRUE (un servidor que
  no sepa paginar FALLA en vez de devolver el árbol sin paginar) y el tope abandona el
  cursor con página 0, no leyendo todo y recortando.
- **La contraseña se re-leé en cada sincronización** desde su fichero: rotar la
  credencial no exige reiniciar el motor; vive solo en variables locales del stack de
  llamada del bind.
- **Snapshot atómico**: `ReplaceADSnapshot` borra e inserta dentro de UNA transacción
  (WAL): los lectores ven el directorio viejo o el nuevo, nunca una mezcla.
- **La postura se congela con cada snapshot** (se guarda en `ad_posture_history`, se
  sirve del almacén): `/api/ad/posture` no recomputa por petición (no quema el almacén
  ni puede ser más actual que el snapshot que sirve) y `ready=false` honesto hasta la
  primera sincronización — nunca una puntuación fabricada.
- **API = copias**: `Connector.Snapshot()` devuelve el `Status` por valor y copia el
  slice de avisos; el postura servido es un documento decodificado del almacén. La
  lección de scenrun (ronda 1) aplicada por construcción, verificada con
  `-race -count=5` en `internal/ad`, `internal/api`, `cmd/engine`, `internal/ingest` e
  `internal/alert`.
- **`go-ldap/ldap/v3` elegida por necesidades del protocolo**: StartTLS, control
  RFC 2696 (con criticality TRUE exprés, construido en BER a mano porque la librería
  no lo expone), lectura cruda de `objectSid` y rendición de SIDs binarios. El
  razonamiento completo para la auditoría de SEG-B está en el informe de ronda.
- `TestExampleConfigLoads` carga `ad.example.yaml` con el cargador real (KnownFields
  estricto): el ejemplo documentado no puede desincronizarse del esquema.
- Entorno de esta ronda: workspace reiniciado de nuevo (Go ausente); instalado
  Go 1.26.8 linux/amd64 en `/home/z/go`; staticcheck re-instalado; `DISCORD_WEBHOOK_URL`
  sigue sin definirse (sin notificaciones, como en rondas previas); sin `cargo` ni
  `pwsh`: sensor y PowerShell no se tocaron.
- Entorno de la ronda 14h55 (histórico): push resuelto con el token del responsable; sin
  `cargo` ni `pwsh` (sensor y PowerShell no se tocaron); bun disponible pero la consola
  no cambió.

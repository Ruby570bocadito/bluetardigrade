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

## A medias

- Nada a medias: las tres tareas de la ronda quedaron completas y verificadas.
- SIM-4 queda a la espera de su parte B (pantalla de la consola, IMP-B): el contrato está
  publicado en OpenAPI y en el informe de ronda. REP-1 igual: la pantalla es de IMP-B y
  el contrato (catálogo + JSON/CSV + schemas) está publicado.
- El informe de ruido sirve hoy `closed_pct`/`acknowledged_pct` (estado actual del
  triage). Cuando el campo de decisión de triaje exista (petición MEDIA de IMP-B, ronda
  propia de este carril), migrará a `false_positive_pct`.

## Cola de tareas del carril (orden pretendido)

1. **Campo de decisión de triaje** (petición MEDIA de IMP-B): `decision:
   false_positive | authorized_activity | confirmed_incident` en el ciclo de vida
   (`POST /api/alerts/{id}/status` + store + OpenAPI), que desbloquea el «falso
   positivo» del flujo del triaje y convierte los porcentajes del ruido en FP% real.
2. **v1.1 Ruido**: supresiones con condiciones (PLAN-DETALLADO §2.3), lista de software
   conocido por organización (§2.2, `known-software.yaml`; el botón «añadir a software
   conocido» de la pestaña de ruido de IMP-B espera esto) y agrupación de arranques
   repetidos en el sensor (§2.1, parte Rust; requiere cargo en el entorno o pruebas en
   otro sitio).
3. **Motor**: cuotas por equipo en la memoria del motor (v1.1 «Motor y consola»).
4. **AD-1** conector LDAP de solo lectura (necesita fixture LDAP de pruebas en CI); tras
   él, AD-2 (cálculo de postura: el informe ejecutivo ganará la sección de postura y
   el catálogo crecerá) y AD-6 (API de ajustes).
5. **REP-2** informes programados (diarios/semanales en `data/reports` con retención,
   SMTP/webhook opcional): la maquinaria de datos ya existe tras REP-1 parte A.
6. **Diseño**: purga de hosts rechazados/revocados en el registro de alta (observación
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
- Entorno de esta ronda: push resuelto con el token del responsable; sin `cargo` ni `pwsh`
  (sensor y PowerShell no se tocaron); bun disponible pero la consola no cambió.

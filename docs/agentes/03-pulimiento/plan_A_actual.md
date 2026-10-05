# Plan de ronda — Pulimiento A (2026-10-05 12h27 Madrid)

Quinta ronda de Pulimiento A en la rama `carril/pulimiento-a`.
Continuidad de las rondas 1-4 (ver `roadmap_A.md`).

## Sincronización previa

- `git fetch origin --prune`: sin cambios en `origin/carril/implementacion-b`
  (sigue en `4257127`, ronda 2 de IMP-B cerrada a las 12h15). Las
  otras cuatro ramas de carril siguen sin existir.
- `git pull --ff-only origin carril/pulimiento-a`: already up to date.
- `git merge origin/main`: already up to date.
- IMP-B no ha publicado nueva ronda desde la 12h15. Nada que leer
  nuevo.
- **Discord:** no se envió notificación de inicio
  (`DISCORD_WEBHOOK_URL` no definida; ya declarado).

## Identificadores del TODO trabajados

El repo sigue sin `TODO.md`. Continúo numerando mis hallazgos
`POL-A-<tema>`. Esta ronda:

- **POL-A-docs-12** — `docs/ARCHITECTURE.md` sección «System
  overview»: el diagrama mermaid tiene deriva factual múltiple:
  1. El subgraph EP dice «ETW Kernel-Process providers» pero el
     sensor ahora consume Kernel-Process + Kernel-Network +
     Kernel-Registry + DNS-Client (misma deriva que la fila
     «Telemetry» que corregí en la ronda 3, pero en el diagrama).
  2. El pipeline del motor omite componentes que existen y son
     visibles para el operador: `intel` (offline threat-intel),
     `baseline` (per-host novelty), `fleet` (machine inventory +
     heartbeats) en el enriquecimiento; `forensic` (evidence
     bundles), `lifecycle` (alert triage), `suppress` (operator
     allowlist) en la alerta; `notify` (Slack/Telegram/email) y
     `siem` (Elastic/Splunk) como sinks de alerta junto al
     webhook; `respond` (active response) como sink de acción.
  3. El edge del store solo muestra events y alerts; en realidad
     el store también persiste baseline y la alerta lleva triage.
- **POL-A-docs-13** — `docs/ARCHITECTURE.md` párrafo bajo el
  diagrama: dice «The unified event schema (`pkg/model`) is the
  master contract: sensors emit it, the engine validates and
  enriches it, rules index it, interfaces consume it.» Es cierto
  pero incompleto: no menciona que el sensor Rust y el collector
  Go emiten el mismo schema, ni que la consola y el SIEM lo
  consumen. Lo enriquezco un poco para que el lector entienda el
  contrato completo.

## Ficheros que voy a tocar

- `docs/ARCHITECTURE.md` (diagrama mermaid + párrafo bajo el diagrama)
- `changelog.d/PUL-A-system-overview-diagram.md` (fragmento)
- `docs/agentes/03-pulimiento/ronda_2026-10-05_12h27_A.md` (informe)
- `docs/agentes/03-pulimiento/roadmap_A.md` (continuidad)

## Por qué

`docs/ARCHITECTURE.md` es mi área. El diagrama «System overview» es
lo primero que un lector ve tras la intro: si miente (dice
«Kernel-Process» cuando hay 4 providers, omite intel/baseline/
forensic/notify/siem/respond), el lector se hace un modelo mental
incompleto del sistema. La deriva del subgraph EP es la misma que
ya corregí en la fila «Telemetry» (ronda 3) — de hecho, leer el
diagrama y la fila juntos hoy es contradictorio (el diagrama dice
una cosa, la fila debajo dice otra).

Decisión de diseño: enriquecer el diagrama sin hacerlo ilegible.
Mermaid fluye mejor con ~20 nodos que con ~40; añado los
componentes que el operador ve desde fuera (intel/baseline/fleet
en enriquecimiento; forensic/lifecycle/suppress en alerta; notify/
siem/respond como sinks) y dejo los detalles de cada uno al
feature inventory y al layout (que ya están al día). No añado
`redact`, `reputation`, `sigma`, `yamlcheck`, `tlsutil`, `incident`
al diagrama: son transversales o opt-in y el diagrama los
complejizaría sin valor.

## Verificación prevista

Mis cambios son texto en `docs/ARCHITECTURE.md` (mermaid + 1
párrafo). Verifico:

- `python3 scripts/dev-tests/check_rule_inventory.py` (no toca
  reglas ni la tabla auto-generada; confirmo marcadores).
- `python3 scripts/dev-tests/check_openapi.py` (no toco la API).
- Sintaxis mermaid: no tengo un validador mermaid instalado, así
  que verifico manualmente que los nodos referenciados en los
  edges existen, que los subgraphs están balanceados, y que las
  etiquetas de edge usan comillas consistentes. Lo declaro en el
  informe.

Sigo sin tener `go`/`cargo`/`pwsh`/`staticcheck` en el entorno; los
cambios de esta ronda no tocan ese código.

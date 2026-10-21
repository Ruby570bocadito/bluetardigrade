# AGENTS.md — Reglas de trabajo en bluetardigrade

> Cualquier agente que trabaje en este repositorio lee esto ANTES de tocar
> nada. Complementa a [CONTRIBUTING.md](CONTRIBUTING.md); si algo choca,
> manda [docs/agentes/PROTOCOLO.md](docs/agentes/PROTOCOLO.md).

## El proyecto en 30 segundos

SOC self-hosted para endpoints Windows: sensor ETW en Rust (`sensor/`),
motor de detección en Go como binario único (`cmd/`, `internal/`, `pkg/`),
reglas YAML mapeadas a MITRE ATT&CK (`rules/`), consola web Next.js
(`web/`) y documentación en español (`docs/`). Contexto completo:
`README.md` y `docs/OPERATIONS.md`.

## Coordinación de agentes (v2)

La coordinación vive en `docs/agentes/` y este fichero ya no define el
equipo ni las fronteras:

- `docs/agentes/PROTOCOLO.md` — reglas obligatorias: ciclo por tarea,
  claims como cerrojo, higiene del repo, informe vivo.
- `docs/agentes/OWNERSHIP.md` — qué rutas puede tocar cada rol.
- `docs/agentes/ROADMAP.md` — fase actual, tareas por rol y contratos
  (lo edita SOLO DIR).
- `docs/agentes/estado/<ID>.md` — informe vivo de cada rol.

El QUÉ con detalle sigue siendo [TODO.md](TODO.md): se edita solo para
borrar lo ya completado, con entrada en `changelog.d/`. Decisiones vigentes
del producto, en TODO.md y en el ROADMAP.

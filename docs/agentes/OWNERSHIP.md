# Zonas por ruta (v2)

Fuente de fronteras para cada rol. Solo se edita por DIR (o con su aprobación
en «Peticiones»). Los claims viven en `docs/agentes/claims/` — ver
[PROTOCOLO.md](PROTOCOLO.md) §1.

| ID | Rutas que puede modificar/borrar |
|----|----------------------------------|
| DIR | `docs/agentes/PROTOCOLO.md`, `docs/agentes/OWNERSHIP.md`, `docs/agentes/ROADMAP.md`, `docs/agentes/claims/`, `docs/agentes/estado/` |
| IMP-1 | `cmd/`, `internal/`, `pkg/`, `sensor/`, `rules/`, `scenarios/`, `sequences/`, `intel/`, `configs/`, `thresholds.yaml`, `beacons.yaml`, `*.example.yaml` de la raíz, `docs/api/`, `go.mod`, `go.sum`, `Makefile`, `Dockerfile`, `install.ps1`, `uninstall.ps1`, `scripts/` |
| IMP-2 | `web/` (console y console-service), `website/`, `tools/console-tests/` |
| PUL | `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `.gitignore`, `.github/`, `docs/` (fuera de `docs/agentes/` y `docs/api/`), manifiestos de dependencias de `web/` y `website/` (package.json, bun.lock) |
| SEG | Transversal: fixes mínimos de bugs/vulnerabilidades en cualquier ruta, siempre con claim previo |
| TEST | `tests/e2e/` (la crea TEST), `docs/agentes/hallazgos/` (crea y cierra hallazgos). NUNCA modifica código de producto |

Reglas:

- PUL es el único que limpia globalmente (archivos muertos/duplicados,
  refactors sin cambio de comportamiento en todo el repo) y nunca toca una
  ruta con claim activo de otro agente.
- IMP-1 e IMP-2 no crean ni reordenan documentación: excepciones `docs/api/`
  (viaja con el código, guard `check_openapi.py`) y borrar de TODO.md el
  punto que acaban de completar (convención del repo: punto hecho = fuera de
  TODO.md).
- `changelog.d/`: cada entrega añade SU entrada en el commit de la entrega
  (precedente M-1, C-2, O-2); PUL audita el formato y la agregación a
  CHANGELOG.md.
- Varias instancias del mismo rol (p. ej. dos IMP-1 en vuelo) coordinan por
  claims sobre ficheros disjuntos; si un fichero se comparte (hub.go,
  flags.go, run_api.go), solo cambios estrictamente aditivos y rebase
  antes de cada push.
- Un fallo que rompe el build para todos lo arregla quien lo detecte, con
  cambio mínimo, y lo anota en su estado (PROTOCOLO.md §2).
- Zona nueva o reparto distinto (p. ej. duplicar IMP): fila nueva editada
  por DIR; sin fila no hay zona.

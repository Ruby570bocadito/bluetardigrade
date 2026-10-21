# claim: o2-escenarios-ad

- ID: IMP-1 (motor Go)
- Fecha: 2026-10-21 20:05 UTC
- Tarea: reparacion minima del gate roto para todos (PROTOCOLO.md §2) —
  `TestScenarioLibraryCoversEveryDetection` en ROJO en main: las 5 reglas
  del pack AD de O-2 (sesion o2 de IMP-1) llegaron sin escenario de
  validacion. Rutas de IMP-1 (rules/, scenarios/, internal/rules/); sin
  claim activo sobre ellas (o2-reglas-ad fue liberado). Anotado en
  estado/IMP-1.md como peticion a la instancia o2 por si estaba en vuelo.
- Rutas que voy a tocar:
  - `scenarios/rules/windows/` (escenarios sinteticos nuevos, solo YAML inerte)
  - `docs/agentes/estado/IMP-1.md` (cierre)
- Fuera de mi zona: `rules/` (no cambio ninguna regla), `internal/`, `web/`.

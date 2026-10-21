# claim: o2-reglas-ad

- ID: IMP-1 (motor Go + sensor Rust)
- Fecha: 2026-10-21 19:15 UTC
- Tarea del ROADMAP: O-2 — reglas AD: 4625 rociado de contraseñas,
  4769 Kerberoasting, 4662 DCSync, 4728/4732/4756 altas en grupos
  privilegiados y 7045 servicios nuevos, cada una con evidencia sintética
  de disparo y de silencio.
- Rutas que voy a tocar:
  - `rules/windows/` (reglas YAML nuevas)
  - `scenarios/rules/windows/` (espejo de escenarios, si el inventario lo exige)
  - `internal/rules/` (tests de evidencia sintética)
  - `docs/agentes/estado/IMP-1.md`
- Fuera de mi zona: `web/`, `docs/api/`, `sensor/`, `cmd/`. Sin solape con
  el claim activo `c2-team3-frontend` (IMP-2): no toco consola.

# claim: m7-wef-pack

- ID: IMP-1
- Fecha: 2026-10-22 (hora UTC del commit)
- Tarea: M-7 lado motor — pack AD por ID de evento WEF (4625/4769/4662/
  4728/4732/4756/7045) sobre el contrato de eventos que la guía
  docs/AD-WEF-SUSCRIPCION.md delega en M-7:
  - Contrato `windows.event`: type nuevo en pkg/model, host = equipo
    ORIGEN (no el recolector), id estable 32-hex (convención del
    OpenAPI para colectores), source wef, atributos win_* con los
    campos semánticos por ID (derivados triviales del XML del evento,
    mismo estilo que las attributes mail_* de phishing).
  - Reglas: DCSync (4662, critical, excluye réplicas de cuentas
    máquina), Kerberoasting RC4 (4769, high), alta en grupo
    privilegiado (4728/4732/4756, high), servicio con intérprete o
    ruta escribible (7045, high; el 7045 genérico queda fuera por la
    misma decisión de falso positivo que el pack de endpoint).
  - Rociado (4625): volumétrico por naturaleza → entrada en
    thresholds.yaml (group_by win_ip), no regla por evento.
  - OpenAPI: windows.event en el enum Event.type (docs/api, viaja con
    el código); inventario de reglas regenerado con su guard.
  - La sección «Entrega al motor» de AD-WEF-SUSCRIPCION.md pasa del
    pendiente al mapeo real (la propia guía designa ese hueco para
    M-7; edición estrictamente aditiva, se anota a DIR/PUL).
- Rutas:
  - `rules/windows/wef-security.yaml` (NUEVO)
  - `thresholds.yaml` (entrada thr-ad-spray)
  - `pkg/model/model.go` (const TypeWindowsEvent)
  - `internal/rules/` (tests del pack), `internal/threshold/` (test de
    la entrada, si el patrón de tests lo pide)
  - `docs/api/openapi.yaml` (enum Event.type)
  - `docs/OPERATIONS.md` (SOLO el bloque máquina-generado RULE
    INVENTORY, vía check_rule_inventory.py --write)
  - `docs/AD-WEF-SUSCRIPCION.md` (sección Entrega al motor, aditivo)
  - `changelog.d/` (entrada de la entrega)

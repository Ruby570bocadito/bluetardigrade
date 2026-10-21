# roadmap_A — Implementaciones A (motor Go)

Roadmap de instancia (el roadmap general es docs/agentes/ROADMAP.md, de los
Directores). Estado del carril motor tras cada ronda mía.

## Estado tras la ronda 2026-10-21 (17h11 UTC)

- **M-1 TEAM-3 backend: HECHO** (en revisión, PR `agent/motor/m-1`).
  - Asignación en lifecycle (parcial, idempotente, persistente).
  - Endpoints: `POST /api/alerts/{id}/assign`, `POST /api/alerts/assign`
    (lote ≤200, resultado por id).
  - Filtro `assignee=` (nombre o `none`) en list, search y exports; CSV
    con columnas nuevas al final.
  - Contrato M-1→C-2 declarado en el informe de la ronda (SSE
    `alert_lifecycle` con los campos nuevos; sin topic nuevo).
- **M-2 AD-7 login dominio LDAPS:** siguiente de mi carril (hornada 2).
  Diseño en TODO.md F2; requiere bind LDAPS con credenciales del usuario y
  mapeo de grupos AD→roles; las cuentas locales siguen de respaldo.
- **M-3 YARA en motor:** depende del contrato de S-2 (sensor). Esperar.
- **M-4 consulta BD solo lectura:** pendiente, sin dependencias.
- **M-6 analista IA por grupos:** depende de que el hub lea el motor con el
  alcance de quien pregunta (F2, en curso por otras instancias).
- **M-7 WEF + AD-3/AD-4:** hornada 3.
- **E-1 (canal servidor→sensor):** BLOQUEADA hasta visto bueno del humano
  al contrato de la épica E-1..E-4.
- **M-5 ML beta de triaje:** tras M-1 ✔ y C-2. Ahora desbloqueable en
  cuanto C-2 aterrice.

## Propuestas dejadas en el informe (para cualquier carril motor)

- Contador de cola sin asignar en `/api/stats`.
- Aviso al asignado vía los canales de notify (depende del fichero notify
  que desbloquea Seguridad B).
- Filtro `assignee` histórico completo en export modo store.

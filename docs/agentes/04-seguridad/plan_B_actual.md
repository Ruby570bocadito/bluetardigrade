# Plan de ronda — Seguridad B (2026-10-05, ronda 2)

Base: mi rama `carril/seguridad-b` (7 commits de la ronda 1, ya publicados
en origin, pendientes de que el responsable decida su merge a main).

Tareas de esta ronda:

- **SEC-5 (bug propio de la ronda 1)**: el trigger `push` de
  `.github/workflows/deps-audit.yml` quedó escrito como
  `branches: ain]` — filtra a una rama inexistente y el job no se ha
  disparado nunca (0 runs en `carril/seguridad-b`, verificado por API).
  Lo arreglo según la intención documentada en la cabecera (push sin
  filtro) y añado un guard estático (`scripts/dev-tests/check_workflows.py`,
  con `--self-test`) que parsea los YAML de workflows y rechaza filtros
  de rama malformados: es exactamente la clase de error que se coló y
  no tiene test que lo cace. Guard en `make ci` y en el propio workflow.
  Verificación de extremo a extremo: tras el push, el job debe aparecer
  (y lo disparo también con `workflow_dispatch`).
- **SEC-1/SEC-2/SEC-4: auditoría del protocolo ENROLL** (ítem 2 del
  roadmap: desbloqueado, el TODO declara el alta de equipos «hecha» en
  `feat/enrollment`). Auditoría de lectura del código publicado: emisión
  y almacenamiento de tokens, canje único y canje en vuelo, exclusiva
  TLS/servidor local, suplantación por nombre duplicado, estado pendiente
  frente a ingesta, aprobación/revocación y fuga de secretos en
  respuestas y logs. Resultado: veredictos con SHA del commit auditado
  en `docs/MODELO-DE-AMENAZAS.md` §2 y hallazgos asignados a su carril
  en el informe (no toco su código).
- **Diagnóstico del CI rojo en `main` (5e168ba)**, para los carriles
  dueños: (a) `smoke_file_forensics.py:115` con `rules_count == 75`
  stale tras el pack de 39 reglas (7c2b7e8) — ya reclamado por el PR
  #16, solo verifico su fix cuando aterrice; (b) 12 tests de
  `internal/respond`/persistencia caen en el runner Windows con patrón
  ~3s (esperas que expiran) — evidencia y hipótesis en el informe.

Ficheros que voy a tocar: `.github/workflows/deps-audit.yml`,
`scripts/dev-tests/check_workflows.py` (nuevo), `Makefile`,
`docs/MODELO-DE-AMENAZAS.md` (§2), `docs/agentes/04-seguridad/*`,
`changelog.d/*`. No toco: `scripts/dev-tests/smoke_file_forensics.py`
(PR #16), código de `feat/enrollment` ni `feat/sensor-service`, ficheros
compartidos vetados.

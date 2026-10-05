# Plan de ronda — Implementación A (2026-10-05, ronda 3)

- Tareas del TODO: **REP-1 parte A** (catálogo de informes, datos y API: resumen ejecutivo,
  incidente, cobertura de flota y actividad del SOC; postura AD/inicios de sesión/ruido
  siguen bloqueados por AD-1/AD-3 y la sección de ruido) y la **API de ruido** (§2.4:
  `GET /api/noise?window=24h`, top de procesos, dominios y reglas, por equipo y flota).
  Además el **hallazgo SEC-A-1 de Seguridad A** (bug real en mi carril: el nombre de
  identidad del alta no comprueba unicidad; re-lanzar el sufijo dentro del cerrojo).
- Ficheros: nuevo `internal/report` (agregaciones puras y CSV, probado sin HTTP),
  `internal/api/reports.go` + `internal/api/noise.go` (2 rutas nuevas
  `/api/reports`, `/api/reports/{kind}` y 1 ruta `/api/noise`), `docs/api/openapi.yaml`
  (34 → 37 rutas), `internal/enroll/enroll.go` (fix SEC-A-1), changelog fragment,
  e2e nueva `scripts/dev-tests/e2e_reports_noise.sh`, informe/roadmap.
- Por qué este orden: IMP-B declara REP-3/REP-4 bloqueadas hasta publicar REP-1 y su
  informe de ruido §2.4 espera la API; SEC-A-1 es un parche pequeño con alto impacto
  (el motor se niega a arrancar tras una colisión) que Seguridad A dejó asignado a este
  carril. El campo de decisión de triaje que IMP-B pide (MEDIA) queda fuera: cambia el
  contrato del ciclo de vida y merece ronda propia; la API de ruido reporta hoy
  `closed_pct` honesto y cambiará a FP% cuando exista el campo.
- Para Implementación B (contrato): `GET /api/reports` (catálogo: kinds, parámetros y
  formatos) y `GET /api/reports/{kind}?window=24h|7d|30d&format=json|csv` (json por
  defecto; csv `text/csv` con el mismo escapado de fórmulas que los export existentes).
  `GET /api/noise?window=24h&host=X&limit=10` (top procesos por imagen, dominios DNS,
  reglas con recuento y % cerrado; `host` vacío = flota completa). Detalle y schemas en
  OpenAPI al cerrar la ronda.
- Fuera de alcance: pantalla de informes y pestaña de ruido (IMP-B), REP-2 (programados),
  v1.1 Ruido (software conocido y supresiones con condiciones), AD-1, el campo `decision`
  del triaje.

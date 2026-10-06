# Plan de ronda — Implementación A (2026-10-06, ronda siguiente a las 09h01)

Base: `9b82845` — **los 8 commits retenidos de las dos rondas anteriores ya están
publicados al abrir esta ronda** (`bc91c7d..9b82845`, primera acción, cola #1 del
roadmap cerrada). `origin/main` sigue en `35cd866` (sin cambios; su Makefile roto es
hallazgo con dueño: PUL-A). Leído: SEG-A r14 (09h51), SEG-B r9 (09h50), IMP-B r7
(07h02), PUL-A r12 (07h47), PUL-B r5 (09h05). **El único ítem ALTA de otro carril
sobre mi código (los 2 hallazgos de SEG-A r11) ya está corregido y publicado.**

Tareas (en este orden):

1. **AD-6/SET-1 parte A — API de ajustes de Active Directory** (desbloquea la
   pantalla de IMP-B, que la declara bloqueada por mí): `GET /api/settings/ad`
   (config efectiva, con la contraseña NUNCA), `PUT /api/settings/ad` (valida con
   el cargador real, escribe el YAML atómico + la contraseña vía `secretfile.Write`
   si viene, 409 si el fichero `-ad` cambió en disco, recarga en caliente del
   conector: `ad.New` + `SetAD` bajo cerrojo, parada del bucle anterior fuera de
   camino de petición) y `POST /api/ad/test` («Probar conexión» del TODO: bind +
   muestreo por tipo de objeto, sin guardar nada). Todo detrás de la puerta
   `-api-write` (403 ruidoso como las supresiones) + línea de auditoría por cambio.
   Ficheros: `internal/ad/config.go` (+horario laboral del TODO: work_start/
   work_end/work_days, validados; se declaran honestos: los consumirá AD-3),
   `internal/ad/settings.go` (nuevo, probe), `internal/ad/connector.go`
   (accesorio `Config()`), `internal/api/ad_settings.go` (nuevo),
   `internal/api/api.go`, `cmd/engine/run.go`, `ad.example.yaml`,
   `docs/api/openapi.yaml` (41→44 rutas), `docs/OPERATIONS.md`.
2. **Si cabe: `engine doctor` valida `known-software.yaml`** con el cargador real
   (paridad con `ingest-identities`; cola v1.1 Ruido residual).
3. Verificación completa tras el ÚLTIMO cambio (checklist CI + `-race -count=5` en
   `internal/api`/`internal/ad`, `-count=3` en los demás tocados), informe, roadmap,
   `changelog.d/IMP-A-*.md`, merge-tree contra las cinco puntas, push.

No toco: consola (IMP-B/PUL-B), CI/Makefile (PUL-A), sensor Rust (sin cargo),
ficheros compartidos.

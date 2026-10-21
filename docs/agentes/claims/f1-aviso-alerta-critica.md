# claim: f1-aviso-alerta-critica

- ID: SEG (seguridad y bugs)
- Fecha: 2026-10-22 20:15 (CEST, Europa/Madrid)
- Tarea del ROADMAP (ALTA): cerrar F1 «alerta crítica sin aviso» — verificar
  las tres vías con fix mínimo y test de regresión donde toque.
- Estado de la verificación (esta ronda): vía navegador y vía aviso en
  consola correctas en código y tests (555 de consola en verde, campana
  desactivada por diseño con estados de permiso honestos); vía externa
  reproducida e2e con `smoke_notify.sh` (8 ok / 0 FAIL) y el launcher ya
  pasa `-notify` (runtime.ps1; changelog.d ya documenta el fix en
  windows-notify-channel.md y console-notify-pending.md).
- Hallazgo nuevo del pase de la vía externa: los sumideros salientes que
  envían evidencia y credenciales (webhook SIEM, Slack/Telegram,
  Elasticsearch, Splunk, reputation) usan `http.Client` con la política de
  redirección por defecto (hasta 10 saltos, con posible bajada a http): un
  receptor que responde 3xx reenvía payload + credencial al destino del
  redirect. El patrón correcto ya existe en el repo (actions.go, doctor,
  report: `ErrUseLastResponse`).
- Rutas que voy a tocar:
  - `internal/webhook/webhook.go` (+ `_test.go`)
  - `internal/notify/channels_http.go` (+ `channels_http_test.go`)
  - `internal/siem/elastic.go`, `internal/siem/splunk.go` (+ `siem_test.go`)
  - `internal/reputation/reputation.go` (+ `reputation_test.go`)
  - `changelog.d/` (entrada del fix) y `TODO.md` (cierre del punto F1)
  - `docs/agentes/estado/SEG.md`
- Fuera de mi zona: `cmd/`, `docs/`, `sensor/`, `web/`. Sin solape con el
  claim activo `c2-team3-frontend` (web/console).

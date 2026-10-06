# Plan de ronda — Implementación A (2026-10-06, ronda siguiente a las 11h50)

Base: `c113fcb` — los 4 commits retenidos de la ronda doctor+cuotas están
publicados al abrir esta ronda (`9409784..c113fcb`, la acción #1 de la cola).
`origin/main` sigue en `35cd866` (ya fusionado en mi rama). Leído al abrir:
informe ronda 16 de SEG-A (**hallazgo MEDIA nuevo sobre mi código**: hot-swap
AD-6 sin serializar — carrera en `current` vía repro por la ruta real y
lost-update fichero-vs-publicado en 7/20), informes ronda 17 de SEG-A y 15 de
SEG-B (dirigidos a IMP-B o al Makefile, nada para mí), informe ronda 10 de
IMP-B (su pantalla SET-1 ya consume mi API; sin petición nueva), planes de los
cinco carriles. El Makefile sigue roto en solitario (heredado de `main`,
dominio de PUL-A; el reparo canónico es el `0852035` de SEG-A): no lo toco.

Tareas (en este orden):

1. **SEG-A r16 MEDIA — serializar el hot-swap de AD-6.** El swap pasa a correr
   SINCRÓNICAMENTE dentro de la sección crítica `adWriteMu` del PUT
   (`adReloadAsync` → `adReloadSync`; `Run`/`Stop` siguen en goroutines de
   fondo): el orden publicación==fichero queda determinista, el bookkeeping
   `current` de `cmd/engine/run.go` queda bajo cerrojo y ningún conector
   queda huérfano sin `Stop()`. NO basta tomar `adWriteMu` dentro de la
   goroutine (el entrelazado H1,H2,C2,C1 seguiría divergiendo en reposo).
   Test de concurrencia que replica el bookkeeping del motor por la ruta
   real (fail-before/pass-after, `-race -count=5`). Ficheros:
   `internal/api/ad_settings.go`, `internal/api/ad_settings_test.go`,
   `cmd/engine/run.go` (comentario mentiroso), `docs/api/openapi.yaml`
   (semántica de la respuesta del PUT), `docs/OPERATIONS.md`,
   `changelog.d/IMP-A-ad-swap-serialization.md`.
2. Verificación completa tras el ÚLTIMO cambio (checklist CI + `-race
   -count=5` en api/engine/ad, `-count=3` en el resto tocado), merge-tree
   contra las cinco puntas, informe, roadmap, push.

Si la ronda sobra: cola (`REP-2` informes programados → purga de hosts
rechazados por cuota). No toco: consola (IMP-B/PUL-B), CI/Makefile (PUL-A),
sensor Rust (sin cargo), ficheros compartidos.

# Plan de ronda — Implementación A (2026-10-06, ronda siguiente a las 10h53)

Base: `293be1d` — la ronda AD-6/SET-1 parte A está publicada (`c357cc8..293be1d`,
verificado con fetch: `origin/carril/implementacion-a` en `293be1d`). La pantalla
de IMP-B queda DESBLOQUEADA (su plan ronda 9 la declaraba esperando mi API de
ajustes). `origin/main` sigue en `35cd866`; mi rama ya lo contiene (sin merge
pendiente). Leído al abrir: plan ronda 9 de IMP-B, plan ronda 13 de PUL-A
(pre-flight de fusión: mi rama fusiona limpia), plan ronda 8 de PUL-B, plan
ronda 15 de SEG-A (sus 2 hallazgos sobre mí ya cerrados en `4a445aa`), plan
ronda 11 de SEG-B. **Ningún ítem ALTA nuevo dirigido a IMP-A.** Sin cargo en el
entorno: §2.1 (agrupación de arranques en el sensor, Rust) sigue bloqueada.

Tareas (en este orden):

1. **v1.1 Ruido residual — `engine doctor` valida `known-software.yaml`** con el
   cargador real (`internal/known`), paridad con lo que ya hace el doctor para
   `ingest-identities` y `-ad`: fallo claro con fichero y causa, OK honesto si no
   hay flag. Ficheros: `cmd/engine/doctor*.go` (+tests).
2. **v1.1 Motor y consola — cuotas por equipo en la memoria del motor** («que un
   equipo ruidoso no expulse a los demás»): estado por host (correlación, línea
   base, beacons, umbrales, anillos) con tope por host, política visible y
   contadores de honestidad en `/api/stats` — nada silencioso; estado compartido
   SIEMPRE por copia. Ficheros: según diseño tras leer las estructuras
   (`internal/correlate`, `internal/baseline`, `internal/beacon`,
   `internal/threshold`, `internal/alert`, `internal/api/metrics.go`),
   `docs/api/openapi.yaml` si `/api/stats` gana campos.
3. Verificación completa tras el ÚLTIMO cambio (checklist CI + `-race -count=5`
   en paquetes con goroutines tocados, `-count=3` en el resto), informe,
   roadmap, `changelog.d/IMP-A-*.md`, merge-tree contra las cinco puntas, push.

No toco: consola (IMP-B/PUL-B), CI/Makefile (PUL-A), sensor Rust (sin cargo),
ficheros compartidos.

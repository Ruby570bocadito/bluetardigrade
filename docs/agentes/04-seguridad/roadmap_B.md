# roadmap_B — Seguridad B (bugs funcionales, carril A↔B)

Instancia: 04-seguridad [B] · Primera ronda: 2026-10-21.

## Hecho

- Ronda 1 (2026-10-21): bug «Alerta crítica sin aviso» — rama externa.
  `runtime.ps1` pasa `-notify tools\config\notify.yaml`; check «Avisos
  externos» en `sf-engine doctor` (valida con `notify.Load`, no envía, no
  divulga secretos); `notify.example.yaml`; 4 tests nuevos. Sub-punto F3
  cerrado con changelog.d. Auditoría sin defectos de: `critical-notifier.tsx`,
  `alert-notify.ts`, `use-engine-stream.ts`, replay del PR #28 en
  `internal/api`/`internal/risk` (nivel código; la prueba física es del
  humano). Ver informe `ronda_2026-10-21_18h54_B.md`.
- Ronda 2 (2026-10-21): carril sensor completo (reparto confirmado con A,
  que retiró su punto 3 tras leer mi plan `aa81f88`):
  - **Corregido** `transport.rs`: el stream de eventos restauraba
    «blocking semantics» tras el handshake → un motor que acepta TCP y
    deja de leer bloqueaba el hilo de entrega indefinidamente (el stop
    no se consultaba: el apagado perdía la cola en vez de volcarla al
    spool y los latidos se congelaban → falsos «sin señal»). Ahora los
    writes llevan techo de 30 s (`STREAM_WRITE_TIMEOUT`), reads siguen
    en bloqueo; `set_stream_timeouts` sustituye al `set_timeouts(None)`
    (método retirado por dead code).
  - **Corregido** `enrollment.rs`: la credencial ahora se limpia a disco
    (`sync_all`) antes del rename atómico — un corte de luz en la
    ventana de enrolamiento dejaba una credencial rota que inutilizaba
    cada arranque posterior con el token de enrolamiento ya borrado.
  - Regresión POL-1 (splits `877e378`/`088eaaa`): revisados orquestador
    `run.go`, `run_pipeline.go` (drain fiel al original), `run_background.go`
    (shutdown watch, sweeps, watcher de flota con reloj de suspensión) y
    `run_ingest.go` (credenciales/identidades/enrolamiento) — sin
    desviaciones funcionales halladas.
  - Correlador (`internal/correlate/observe.go`): pase estático sin
    defectos (re-arm con `delete`, entrega fuera del mutex, tope de
    estados con `reclaimLocked`, refresco solo con hits más nuevos).
    Dejo constancia para A: el «colador» ya tiene esta pasada estática.
  - Fragmento `changelog.d/sensor-transport-write-ceiling.md`.
  - **Bloqueo de main diagnosticado**: la CI del push mostró `Go
    engine` en fallo ya presente en `9130a45` (merge PR #42): `err
    redeclared` por conflicto semántico split POL-1 x brazo profiling.
    Reproducido con Go local y fix preparado; el merge de M-1
    (`a51108a`, Implementaciones A) aterrizó la misma corrección, así
    que mi commit se retiró como duplicado y verifiqué el main
    resultante: build, vet, `test -count=1`, GOOS=windows y gofmt en
    verde. Ver informe (adenda del cierre).
  Ver informe `ronda_2026-10-21_19h35_B.md` (con adenda del cierre).

## A medias

- Nada a medias: ambos fixes entraron completos con la batería Rust
  replicada en local (check+clippy host y cross Windows, 38/38 tests).
  La suite Go se corrió al cierre tras instalar el toolchain (no estaba
  disponible al empezar): verde sobre el main resultante.

## Siguiente en mi backlog

1. **Pérdida silenciosa en conexión medio-muerta (detectado, no
   corregido)**: writes que el kernel acepta en el buffer de una
   conexión sin RST se dan por entregados y se pierden — el protocolo
   NDJSON no tiene ack por evento. El arreglo real es de protocolo
   (ack del motor o keepalive + ventanas): propuesta para
   Directores/Implementaciones, no cabe en una ronda de bugs sin
   cambiar el wire. Detalle en mi informe de ronda 2.
2. **Pérdidas ETW invisibles**: los contadores EventsLost/BuffersLost
   de las sesiones no llegan al latido (ferrisetw no los expone) — un
   desborde de buffer del kernel se vería como hueco de telemetría sin
   aviso. Terreno natural de S-4 (latido) o de una extensión de
   ferrisetw; propuesto en el informe.
3. `Sender::connect` trata un timeout de handshake como fatal mientras
   `send_line` lo reintenta en runtime: inconsistente (mitigado por la
   recuperación del servicio de Windows, restart 5s/10s/60s). Candidato
   a normalizarse como transitorio en una próxima ronda.
4. Correlador: la parte dinámica (tests con ventanas al límite, re-arm
   bajo tope de estados) sigue abierta para A o para mí si A no llega.
5. Si C/D entrega Ajustes → Notificaciones (F3): auditar el flujo de
   validación y el botón «Enviar prueba» desde bugs.

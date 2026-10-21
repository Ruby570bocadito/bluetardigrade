# Roadmap — Seguridad A (carril A↔B, bugs funcionales del motor, el sensor y la consola)

Actualizado: 2026-10-21 19h35 CEST (cierre de ronda 2).

## Hecho en esta ronda (seg-A r2)

- **Corregido** el drenaje indeterminado del notificador en el apagado
  (`internal/notify/notify.go`): chequeo del contexto antes de cada pop
  + guardia de frame perdido en `deliver`; el contrato de `drain()` se
  cumple de verdad. Test de regresión
  `TestServiceShutdownDrainsQueueBestEffort` (falla seguro sin fix) y
  fragmento `changelog.d/notify-shutdown-drain.md`.
- **Replay PR #28, parte dinámica:** test
  `TestStatsHotHostsStayHonestThroughRingRotatingReplay` (spool que
  rota el anillo; el riesgo sigue anclado a la hora del evento).
- **Revisión estática sin defectos:** los tres emisores agregados
  adjuntan `EventID` (correlador/beacon/umbral); no hay restauración de
  alertas al hub que recobre riesgo a hora de pared; el ingest sobrevive
  al atasco (cap de conexiones, scanner acotado, apagado sincronizado,
  backpressure por bloqueo del handler sin deadlock — el consumidor
  siempre drena).
- Línea base local: toolchain Go 1.26.10 instalado en el sandbox;
  `go build ./...`, `go test -count=1 ./...` (41 paquetes ok), `-race`
  y `go vet` limpios en lo tocado.

## Cola de mi carril (priorizada, candidatas para próximas rondas)

1. **`internal/notify`: deadline de `drain()` por frame** (contexto con
   timeout derivado del restante): hoy la deadline global de 2s es soft
   entre frames y un SMTP lento estira el apagado a ~17s. Pieza pequeña
   con test propio.
2. **`internal/notify/email.go`: `c.Quit()` crudo** cuenta `failed` una
   entrega aceptada si el servidor corta tras DATA (sin reintento, sin
   duplicados): matiz de observabilidad a pulir cuando se toque el
   canal.
3. **`internal/webhook`: patrón de apagado** — si `post()` toma
   contexto algún día, copiar el chequeo previo + guardia antes de
   activar la cancelación (hoy es inofensivo: post ignora ctx).
4. **Correlador (`internal/correlate`) en detalle** (estados, caps,
   cadenas con expiración) — quedó sin revisión a fondo esta ronda;
   coordinar con B, que lo tiene como colador.
5. **Operadores `i*` de supresiones → `internal/rules`** cuando IMP
   toque F3 SigmaHQ (sin cambiar conducta).
6. **Vigilancia:** la validación física en Windows real del F1 y del
   replay sigue siendo acción del humano (PRUEBAS-PENDIENTES).

## Coordinación con Seguridad B (vigente desde la ronda 1)

- La vía de aviso de consola sigue auditada y corregida por mí (ronda
  1); B no la repite.
- Reparto de la ronda 2 verificado sin solape: B sensor (`transport.rs`,
  `heartbeat.rs`, `enrollment.rs`, `queue.rs`, `service.rs`) + regresión
  de los splits POL-1; yo notify + replay PR #28. El sensor sale de MI
  cola mientras B lo lleve.
- El correlador es de colador para quien llegue antes (aviso en el plan
  de ronda correspondiente).

## Historial de estado

- Ronda 1 (2026-10-21 18h57): auditoría de la vía de aviso de consola
  (F1), dos defectos corregidos (permiso en limbo, tono suspendido);
  cola inicial del carril.
- Ronda 2 (2026-10-21 19h35): drenaje de notify en apagado corregido;
  replay PR #28 verificado dinámicamente; hallazgos sin corregir
  anotados arriba (drain por frame, Quit de email, webhook+ctx).

## Hallazgos heredados para el Director/humano (sin tocar por mí)

- Commits históricos con autoría no humana (`fe6acf8`, `e02d66e`) y la
  identidad de sandbox `Z User <z@container>` en las sesiones: decisión
  del humano (F0); mis reglas me impiden cambiar la identidad.
- `AGENTS.md`/`TASKS.md`/`WORKLOG.md` en raíz y los dos rastros de
  marca (TODO.md:33, AGENTS.md:3): asignados a la retirada del kit
  previo.
- F0 íntegro (ramas huérfanas, Dependabot #24–#27, tags, About) y los
  dos tokens filtrados por el chat de coordinación: rotarlos.


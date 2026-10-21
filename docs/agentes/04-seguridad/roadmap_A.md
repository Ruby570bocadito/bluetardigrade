# Roadmap — Seguridad A (carril A↔B, bugs funcionales del motor, el sensor y la consola)

Actualizado: 2026-10-21 19h59 CEST (cierre de ronda 3).

## Hecho en esta ronda (seg-A r3)

- **Revisión funcional de la entrega M-1** (asignación de alertas,
  TEAM-3, commit `a51108a`): `internal/lifecycle` (trío de asignación,
  conservación en `Set`, desasignación en bloque, expulsión FIFO),
  `internal/api/alert_assign.go` (ruta individual, lote de 500 no
  atómico con resto `not attempted` correcto, validaciones, clasificación
  de errores por centinela) y los filtros `assignee`/`unassigned` del
  overlay (`records.go`, paridad anillo/tienda). **Sin defectos
  funcionales**; dos observaciones menores sin efecto observable
  (detalle en el informe de ronda). Suite M-1 verificada en local.
- **Corregido** el presupuesto soft del drenaje de notify en apagado
  (`internal/notify/notify.go`): la deadline de 2s solo se comprobaba
  ENTRE frames — cada intento corría con `context.Background()` sin
  techo, así que un SMTP atascado (15s) estiraba el apagado del motor a
  ~17s con `nt.Wait()` bloqueando la secuencia de parada. Ahora el
  presupuesto se enforza POR INTENTO: ctx con timeout derivado del
  restante (el canal de correo aplica `ctx.Deadline` al socket), el
  frame que sale con el presupuesto gastado cuenta como `dropped` sin
  intento. Test de regresión
  `TestServiceShutdownDrainBudgetIsEnforcedPerFrame` (falla con el
  código viejo: ~10s de drain y contadores equivocados) y fragmento
  `changelog.d/notify-drain-budget.md`.
- Línea base local: `go build ./...`, `go vet ./...`, suite completa
  `go test -count=1 ./...` en verde y `-race` en notify/lifecycle/api.

## Cola de mi carril (priorizada, candidatas para próximas rondas)

1. **Pase de regresión del split S-5 de `collector.rs` (PR #43)**: se
   fusionó DESPUÉS de los informes de ronda 2 de ambas parejas de
   seguridad — nadie del carril lo ha contrastado aún contra el
   `collector.rs` original. Terreno natural de B (sensor); si no lo
   reclama en su plan de ronda 3, lo tomo yo en la ronda 4.
2. **`internal/notify/email.go`: `c.Quit()` crudo** cuenta `failed` una
   entrega aceptada si el servidor corta tras DATA (sin reintento, sin
   duplicados): matiz de observabilidad a pulir cuando se toque el
   canal.
3. **Correlador (`internal/correlate`) en detalle dinámico** (estados,
   caps, cadenas con expiración, ventanas al límite) — compartido con B;
   quien lo reclame primero en su plan de ronda.
4. **`internal/webhook`: patrón de apagado** — si `post()` toma
   contexto algún día, copiar el chequeo previo + guardia antes de
   activar la cancelación (hoy el cliente HTTP se autocapsa a 3s).
5. **Operadores `i*` de supresiones → `internal/rules`** cuando IMP
   toque F3 SigmaHQ (sin cambiar conducta).
6. **Vigilancia:** la validación física en Windows real del F1, del
   replay y del nuevo presupuesto de drain sigue siendo acción del
   humano (PRUEBAS-PENDIENTES).

## Coordinación con Seguridad B (vigente desde la ronda 1)

- La vía de aviso de consola sigue auditada y corregida por mí (ronda
  1); B no la repite.
- Reparto verificado sin solape en las rondas 1-2; en la ronda 3 mi plan
  (275063a) reclama M-1 + notify y deja el correlador dinámico como
  «primero que lo publique». El sensor sigue siendo de B mientras lo
  lleve — incluida la regresión del S-5 (punto 1 de la cola).
- El plan de ronda 3 de B no estaba publicado al cerrar mi ronda;
  desempate por plan publicado primero, como siempre.

## Historial de estado

- Ronda 1 (2026-10-21 18h57): auditoría de la vía de aviso de consola
  (F1), dos defectos corregidos (permiso en limbo, tono suspendido);
  cola inicial del carril.
- Ronda 2 (2026-10-21 19h35): drenaje de notify en apagado corregido
  (race del select); replay PR #28 verificado dinámicamente; hotfix de
  main sin compilar (PR #41); hallazgos anotados (drain por frame, Quit
  de email, webhook+ctx).
- Ronda 3 (2026-10-21 19h59): revisión de M-1 sin defectos; presupuesto
  de drain enforzado por frame (el primero de los hallazgos de la ronda
  2 sale de la cola); PR #43 señalado para regresión del carril.

## Hallazgos heredados para el Director/humano (sin tocar por mí)

- Commits históricos con autoría no humana (`fe6acf8`, `e02d66e`) y la
  identidad de sandbox `Z User <z@container>` en las sesiones: decisión
  del humano (F0); mis reglas me impiden cambiar la identidad.
- `AGENTS.md`/`TASKS.md`/`WORKLOG.md` en raíz y los dos rastros de
  marca (TODO.md:33, AGENTS.md:3): asignados a la retirada del kit
  previo.
- F0 íntegro (ramas huérfanas, Dependabot #24–#27, tags, About) y los
  dos tokens filtrados por el chat de coordinación: rotarlos. **Esta
  sesión confirma el punto**: los tokens ya no están disponibles aquí y
  el push de la ronda 3 queda bloqueado hasta que el humano publique
  con credenciales suyas (detalle en el informe de ronda).

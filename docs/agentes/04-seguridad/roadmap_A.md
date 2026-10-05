# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-05,
ronda 7, cierre (19:50 Europe/Madrid).

## Estado tras el cierre de la ronda 7 (2026-10-05)

- **Auditoría de los paquetes sin lectura profunda (store, api, risk,
  correlate, incident) completada: 3 bugs funcionales corregidos con
  test** en código ya fusionado en main. Informe:
  `ronda_2026-10-05_19h45_A.md`.
  1. **MEDIA-BAJA** — `/api/noise` descartaba la marca de truncado del
     escaneo de ALERTAS: ventanas con >10 000 alertas en la store
     presentaban top lists parciales como completas. Fix:
     `Truncated: evTrunc || alTrunc` + test con semilla real de
     10 001 alertas (fail-before/pass-after demostrado con stash).
  2. **BAJA** — `POST /api/scenarios/run` clasificaba el id
     desconocido por `strings.Contains` del mensaje (contradice el
     contrato anti message-matching que `handleAlertStatus`
     documenta); hoy el centinela `scenrun.ErrUnknownScenario` lo hace
     estructural. Mensaje del wire idéntico.
  3. **MEDIA-BAJA** — `incident.AddAlerts` mutaba parcialmente el caso
     al superar el tope de 1000 alertas: el cliente veía 400 pero los
     ids que cabían quedaban en memoria sin timeline ni persistencia.
     Fix: pre-recuento y rechazo antes de mutar + test.
- **store y risk/correlate sin bug que corregir**: el batch degrada a
  una transacción por evento sin doblar contadores, `Prune` es
  guardado por `run.go` (`retention > 0`), los haystacks del store
  coinciden campo a campo con los del hub, el decaimiento/expulsión
  del riesgo es correcto y la correlación recicla estados con claves
  struct sin aliasing.
- **Obligatorio de ronda**: `-race -count=3` verde en api/scenrun/
  incident (mi diff); las ramas ajenas no cambiaron código desde el
  barrido de la ronda 6 (PUL-B `173ac11` y SEG-B `b0eaa60` docs-only),
  su evidencia sigue vigente.
- Checklist CI completo verde tras el último cambio de código: gofmt
  vacío, vet, build nativo y GOOS=windows, staticcheck,
  `-race -count=1 ./...`, openapi self-test, inventario (114 reglas),
  consola 371 tests + tsc + build, sensor 36 tests + clippy -D
  warnings.

## Historial reciente

### Ronda 6 (17h35) — cambios Go de SEG-B y REP-4 de IMP-B (informe `ronda_2026-10-05_17h35_A.md`)

- **Cambios Go de SEG-B revisados, sin bug que corregir**: el fallback de
  run-id de scenrun conserva la forma del wire (`run-%016x`, test nuevo
  que lo clava), las cabeceras `nosniff`/`no-referrer` van en el wrapper
  más externo del Hub (cubre 401/403; Cache-Control no forzado a
  propósito), el self-test de openapi admite el envoltorio nuevo y el
  blindaje del analista está acotado bloque a bloque (`clampBlock`) —
  el `rule_id` sin tope de longitud no puede inflar el prompt.
- **REP-4 de IMP-B revisado, sin bug que corregir**: gráficas de informes
  honestas (sin donuts inventados, división por cero guardada, formato de
  día del motor verificado en `internal/report/soc.go:152`) y el enlace
  informe-del-caso aplica la lente al remontar. `bun test` 391 ok y tsc
  limpio en su punta. **Mis dos hallazgos de la ronda 5 siguen vigentes**
  (REP-4 no tocó `generate` ni `noise-view`).
- **Obligatorio de ronda**: `-race -count=5` verde en `internal/api` e
  `internal/scenrun` en la rama de SEG-B (scenrun es el paquete de la
  carrera de la ronda 1); IMP-B sigue sin tocar Go.

### Ronda 5 (17h06) — código de consola de IMP-B ronda 2 (informe `ronda_2026-10-05_17h06_A.md`)

- Dos hallazgos en su rama sin fusionar (no corrijo en su carril):
  1. **MEDIA** — `noise-view.tsx` l.282: la supresión desde Ruido sale para
     toda la flota (`host: ''` → `undefined`) aunque el informe esté
     acotado a un equipo; el comentario del componente promete lo
     contrario. Para IMP-B: pasar `report.host` al target.
  2. **BAJA** — `reports-view.tsx` `generate` (l.92-106): sin guardia de
     vigencia; la respuesta de una selección anterior puede pintarse bajo
     el tipo/ventana recién elegidos.
  El resto de las ~2.6k líneas (reports/noise/simulation/url-state,
  ui-tabs, batería, matriz ATT&CK, shell/atajos) revisado sin más
  hallazgos; `bun test` 391 ok y `tsc` limpio en su worktree.

### Ronda 5 — PUL-A y corrección de mi addendum de ronda 4

- **PUL-A revisado, sin bug funcional**: sus cambios de motor son solo
  comentarios; `parseEnrollLine` es extracción verbatim; su
  `FuzzAuthEnrollFirstLine` complementa a mi `FuzzEnrollLine`; el workflow
  nocturno de fuzzing es sólido (21 targets únicos).
- **Corrección de mi addendum de ronda 4**: mis commits de rondas 2-3 no
  están aún en main — PUL-A nunca tuvo mi `FuzzEnrollLine`; el conflicto
  `merge-tree` en `internal/ingest/fuzz_test.go` es real por editar ambos
  el mismo fichero desde la misma base. Resolución que se mantiene:
  conservar ambos targets. Mi `internal/enroll/fuzz_test.go` no colisiona
  (fichero que su rama no toca).
- **Obligatorio de ronda cumplido**: `-race -count=5` verde en los 8
  paquetes con goroutines que toca la rama de PUL-A; el árbol Go de
  IMP-B es idéntico a main (ya cubierto en mi ronda 2).
- Rondas 2-4: dos bugs del código de ronda 1 corregidos con test, 5 fuzz
  targets nuevos (24 en el módulo con los de PUL-A), registro del alta
  reforzado contra digests duplicados, sensor Rust revisado a fondo sin
  bug que corregir (36 tests + clippy limpio).

## Pendiente (orden de prioridad para reabrir)

1. **Auditar `internal/ad` (AD-1/AD-2/SEC-2)** — sigue bloqueado: IMP-A
   tiene solo plan (16h05); su plan reserva la auditoría para cuando se
   fusione. Prioridad real al reabrir.
2. **Ronda 8: paquetes del motor aún sin auditoría profunda** —
   `fleet`, `baseline`, `notify`, `webhook`, `siem` (elastic/splunk),
   `actions`/`respond` (motor), `lifecycle`, `enrich`/`redact`,
   `reputation` (solo su fuzz) y los caminos de `cmd/engine`.
3. **Verificar que IMP-B incorpora los dos hallazgos de la ronda 5** en
   su rama antes de la fusión (su REP-4 de la ronda 6 no los tocó).
4. **Resolver DOS conflictos append-append al fusionar** (ronda 7):
   `internal/ingest/fuzz_test.go` con PUL-A — conservar
   `FuzzEnrollLine` y `FuzzAuthEnrollFirstLine` — y el NUEVO
   `internal/scenrun/scenrun_test.go` con SEG-B — conservar
   `TestRunIDsMatchWireContract` (suyo) y
   `TestStartUnknownScenarioWrapsSentinel` (mío); `scenrun.go` y
   `api/scenarios.go` se auto-fusionan limpios.
5. **`min_count: 2` en beacons** — decisión del responsable pendiente desde
   la ronda 1 (¿validación en carga `>= 3` o documentar?).
6. **SET-3 lado motor** — depende de IMP-A; auditar cuando suba.
7. **PowerShell con `pwsh`** — el entorno no lo tiene; scripts revisados
   en lectura sin hallazgos.
8. **PR #18 de Dependabot** — reclamado por Seguridad B (su carril).

## Notas de contexto que no deben perderse

- **El canal de salida de este entorno se come la secuencia literal
  `[h`**: esta ronda volvió a ocurrir al leer `dashboard.tsx` (parecía
  `const istory`); verificar SIEMPRE con recuentos grep/booleanos o
  extracción por índice, nunca fiarse de la salida cruda con corchetes.
- Los worktrees de solo lectura (`git worktree add --detach`) son la vía
  cómoda para revisar/verificar ramas ajenas sin tocarlas: crear, medir,
  `git worktree remove --force`.
- Los procesos en background (`nohup setsid …`) no sobreviven entre
  comandos: sesiones largas (race, fuzz) en primer plano con timeout
  amplio (`-race -count=3` de api/scenrun/incident tardó ~70 s esta ronda).
- Entorno sin Go preinstalado: `/home/z/tools/go/bin` (1.26.6),
  `staticcheck` en `/home/z/go/bin` (2026.2.1), `bun` 1.3.14 en PATH del
  sistema, `cargo` en `/home/z/.cargo/bin` (1.99, NO está en el PATH por
  defecto: exportarlo antes de las baterías del sensor). Sin `pwsh`.
- Límites respetados: sin tocar `TODO.md`, `PLAN-DETALLADO.md`,
  `CHANGELOG.md` (se usa `changelog.d/`), `openapi.yaml` ni `README.md`;
  sin cruzar a ramas de otros carriles (solo worktrees desprendidos de
  lectura, eliminados al cerrar).

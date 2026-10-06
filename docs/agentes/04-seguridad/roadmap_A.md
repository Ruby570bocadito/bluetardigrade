# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-06,
ronda 11, cierre (06:52 UTC, Europe/Madrid).

## Estado tras el cierre de la ronda 11 (2026-10-06)

- **Auditoría completa del código AD/SEC-2 de IMP-A (`bc91c7d`,
  ~4.8k líneas Go) ejecutada — mi pendiente 1 desbloqueado y hecho.**
  2 hallazgos, ambos en su rama (aún sin fusionar en main — no
  corrijo en su carril; informe `ronda_2026-10-06_06h52_A.md` con
  prueba fail-before y fix verificado):
  1. **MEDIA** — `internal/api/ad.go`: `postureWire.Score` (l. 107)
     se declara y JAMÁS se asigna; `GET /api/ad/posture` responde
     `"score": null` incluso con `ready: true` (probe con store
     temporal + 87 almacenado confirmó el fail-before; parche de una
     línea verificado pass-after). Fix para IMP-A: `score := p.Score;
     out.Score = &score` al inicio del bloque `if p != nil`.
  2. **BAJA** — lecturas sin cerrojo de campos seteados bajo cerrojo:
     `h.ad` en los 4 handlers (`ad.go` l. 38/81/136/178) y
     `h.alertLatency`/`h.ingestCert`/`h.version` en `statsSnapshot`
     DESPUÉS del `h.mu.Unlock()` (la disciplina del paquete es la de
     `scenarioService()`: copiar bajo cerrojo). Sin disparador en el
     cableado actual (setters solo en arranque), pero carrera real si
     se re-arrrma en caliente.
- **Limpio sin hallazgos**: secretfile (ida y vuelta, 0600, DPAPI con
  LocalFree, Zero real), config validation, client.go (paginación
  crítica BER correcta, fileTime/SID, tope que corta el fetch),
  connector.go (estado por copias, credencial puesta a cero siempre),
  store/ad.go (snapshot atómico, NOCASE, poda), posture.go (BFS
  anti-ciclo, listas capadas, ausencia honesta), latency ring (p95
  sin desborde), secret-write por stdin, deltas de alert/ingest/
  tlsutil/run.
- **Observaciones (no bugs)**: `eolOS` no incluye Windows 10 (EOL
  2025-10, anterior a la fecha del proyecto — decidir si ESU o
  omisión); el primer sync AD bloquea el arranque (Run síncrono,
  documentado).
- **Consolas ajenas sin hallazgos**: guardia CSV de SEG-B (misma regla
  que SafeCell del motor, fullwidth y espacios correctos) y armazón
  i18n de IMP-B (disciplina del tema). Mis dos hallazgos de la ronda 5
  siguen vigentes en `5ecbcc4` (sexto aviso).
- **Obligatorio**: IMP-A tip con `-race -count=5` verde en ad
  (12,8 s), secretfile (1,1 s), api (52,2 s), store (13,1 s) en
  worktree desprendido; PUL-A docs-only; IMP-B/SEG-B consola; PUL-B
  sin mover.
- Entorno reconstruido tras el reset del sandbox (repo re-clonado,
  Go 1.26.0, staticcheck 2026.2.1). Checklist Go completo verde en mi
  árbol (37 paquetes -race); consola/sensor sin cambios desde la
  ronda 9 en todas las puntas, evidencia previa vigente.

## Historial reciente

### Ronda 11 (06h52 UTC) — auditoría AD/SEC-2 de IMP-A + consolas SEG-B/IMP-B (informe `ronda_2026-10-06_06h52_A.md`)

- **2 hallazgos en la rama de IMP-A (anotados, no corregidos: rama
  sin fusionar)**: score de postura jamás servido (MEDIA, con
  fail-before/pass-after probados) y lecturas de Hub sin cerrojo
  (BAJA, disciplina scenarioService).
- **Auditoría limpia** del resto del código nuevo: secretfile,
  ad/client/connector/posture, store/ad, latency ring, secret-write.
- **Consolas**: guardia CSV de SEG-B e i18n de IMP-B sin hallazgos;
  mis dos hallazgos de la ronda 5 re-verificados vigentes (sexto
  aviso).
- **Obligatorio**: `-race -count=5` en la punta de IMP-A (ad/
  secretfile/api/store), verde.
- Sandbox reiniciado y reconstruido; checklist Go completo verde
  (37 paquetes).

### Ronda 10 (19h39 UTC) — revisión PUL-A re-ejecutada + IMP-B IDEA-11 + fuzzing vivo (informe `ronda_2026-10-05_19h39_A.md`)

- **PUL-A**: POL-12 verificado comment-only; adopción SEC-7 verbatim
  verificada byte a byte; `-race -count=5` ingest+enroll verde en su
  punta; conflicto `fuzz_test.go` reducido a un hunk de 2 líneas
  (`"unicode"`).
- **IMP-B IDEA-11**: sin bug que anotar (auto-apertura sin carrera,
  expiración de token honesta, descarte tolerante); mis dos hallazgos
  de la ronda 5 re-verificados vigentes en `d6f2285`.
- **Fuzzing vivo**: 5 objetivos, ~2,0 M ejecuciones, 0 crashes.
- **Obligatorio**: única punta ajena movida con Go = PUL-A
  (test-only), `-race -count=5` en su punta; IMP-B sin Go (diff
  verificado); resto sin movimiento, evidencia de rondas 5-8 vigente.

### Ronda 8 (20h05) — revisión de IDEA-3 de IMP-B y auditoría fleet/baseline/lifecycle (informe `ronda_2026-10-05_20h05_A.md`)

- **IDEA-3 de IMP-B (`9f35615`) revisado, sin bug que anotar** (informe
  `ronda_2026-10-05_20h05_A.md`): validación NFKC/bidi y topes por
  ambos lados (lectura y escritura), evicción LRU correcta, sin bucle
  de re-render (el efecto depende de `setPlan`, estable), nota al
  motor no bloqueante, export con escape triple y recuento honesto de
  alertas fuera de ventana. `bun test` 403 pass, tsc y build limpios
  en su punta. Su árbol Go sigue idéntico a main (solo un fixture TSX
  de su check de DOM): `-race` no aplica a su carril esta ronda.
- **Mis dos hallazgos de la ronda 5 siguen vigentes en `9f35615`**
  (re-verificados línea en mano): supresión flota-completa desde Ruido
  acotado (MEDIA) y `generate` sin guardia de vigencia (BAJA).
- **Auditoría propia `fleet`/`baseline`/`lifecycle`: sin bug que
  corregir** (Check nunca desreferencia Sensor nulo, expulsión sin
  clave vacía, gracia de restauración correcta, baseline deja de
  aprender sin expulsar historia, lifecycle FIFO antes de persistir).
- **Obligatorio de ronda**: carriles ajenos sin código nuevo (IMP-B
  consola-only; resto docs-only); evidencia `-race` de rondas 6-7
  vigente. Sin cambios de código propio.

### Ronda 7 (19h45) — auditoría store/api/risk/correlate/incident (informe `ronda_2026-10-05_19h45_A.md`)

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

1. **IMP-A debe corregir los 2 hallazgos de la ronda 11 antes de
   fusionar** (score de postura MEDIA + lecturas sin cerrojo BAJA;
   informe `ronda_2026-10-06_06h52_A.md` con fix y prueba). Cuando
   los suba: re-auditar su delta y verificar la sonda del score.
2. **Verificar que IMP-B incorpora los dos hallazgos de la ronda 5** en
   su rama antes de la fusión (sexto aviso en `5ecbcc4`).
3. **Fuzzing vivo, segunda tanda**: `FuzzLoadIntelFile`,
   `FuzzLoadSuppress`, `FuzzConvertSigma`, `FuzzDecodeMail` (45-60 s
   cada uno); los cinco de la ronda 10 quedaron limpios.
4. **Resolver DOS conflictos al fusionar** (re-verificado en la
   ronda 11): `internal/ingest/fuzz_test.go` con IMP-A/PUL-A —
   conservar `"unicode"` junto a mi bloque (el EOF adoptado verbatim
   se auto-fusiona) — y `internal/scenrun/scenrun_test.go` con SEG-B
   — conservar `TestRunIDsMatchWireContract` (suyo) y
   `TestStartUnknownScenarioWrapsSentinel` (mío). Contra `main` de
   hoy ambas puntas fusionan limpias.
5. **`min_count: 2` en beacons** — decisión del responsable pendiente
   desde la ronda 1.
6. **SET-3 lado consola de IMP-A revisado** (stats payload con
   versión/latencia/certificados, ronda 11): pendiente solo la vista
   de IMP-B que lo consuma.
7. **PowerShell con `pwsh`** — el entorno no lo tiene; scripts revisados
   en lectura sin hallazgos.
8. **`internal/ad` auditado (ronda 11)**: el bloqueo de rondas 1-10
   quedó resuelto con la publicación de IMP-A; de aquí en adelante,
   re-auditar solo deltas NUEVOS del carril.

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

# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-06,
ronda 17, cierre (10:14 UTC, Europe/Madrid).

## Estado tras el cierre de la ronda 17 (2026-10-06)

- **Solo movió IMP-B (`28d6f9e..2c47271`)**: barrido i18n de
  incidentes (`0380c89`), merge sano de la rama de IMP-A
  (`9763675`: `internal/` idéntico a `293be1d`, consola intacta, sin
  marcadores) y la página SET-1 (`2c47271`). Auditoría de las ~1.600
  líneas nuevas: LIMPIA con 2 hallazgos BAJA nuevos para IMP-B —
  (1) `draftPayload` recorta el password (`password?.trim()`) pero el
  motor lo almacena/sondea verbatim (PUT sin trim, `:476` literal):
  un bind password con espacios en los extremos viaja mutado y el PUT
  persiste la credencial recortada; (2) presupuesto de la sonda
  desalineado: cliente `AbortSignal.timeout(30_000)` vs motor
  `45*time.Second` colgado de `r.Context()` — 30-45 s es inalcanzable
  vía consola. La disciplina del secreto en la vista es correcta
  (write-only, nunca en localStorage/consola/URL, `setPassword('')`
  tras guardar), el merge y el cableado de `ajustes` en los 5 puntos
  de extensión son consistentes.
- **FIX PROPIO — `make` estaba ROTO en 6 de 7 carriles en solitario
  (incluido el mío y `main`)**: `63fa077` convirtió TODOS los TAB de
  receta a 8 espacios (62 líneas), no solo las 7 de PUL-B. Matriz
  verificada con `make -n tidy`: rotos = main, seguridad-a
  (pre-fix), implementacion-a, implementacion-b, pulimiento-b; OK =
  pulimiento-a, seguridad-b. La tabla de PUL-A era correcta para
  parejas (su lado reparado gana en el 3-way) pero ocultaba el
  alcance en solitario. Reparé MI carril: TAB restaurados sin tocar
  contenido (verificado normalizando indentación contra `63fa077^`),
  fail-before capturado, 18/18 targets en `make -n`, guardia de
  PUL-A verde. Commit `0852035` + changelog.
- **FIX PROPIO — `--ignore-scripts` en los 4 `npm install` del
  Makefile** (decisión convergida: PUL-A ci.yml r12, SEG-B Makefile;
  main/IMP-A/IMP-B/PUL-B/mío a 0 antes de esta ronda). Pass-after
  REAL: `make console-install && make console-dom` verde completo.
  Commit `a13012e` + changelog.
- **Octavo aviso a IMP-B**: los 2 hallazgos de la ronda 5 siguen
  vigentes en `2c47271` (ninguno de sus commits los tocó).
- **Baterías**: worktree `2c47271` — bun 463 pass / tsc / build;
  `-race -count=5` api (55,0 s) + ad (17,3 s) en el árbol fusionado
  (Go heredado, combinación nueva); fuzzing trío 3/3 (60 s c/u);
  checklist CI completa en mi árbol (37 paquetes -race).
- **Conflictos (POR EXIT CODE, desde `a13012e`)**: main y pulimiento-b
  LIMPIOS (mi reparación del Makefile aterrizaría sola en main);
  reports_test.go con IMP-A e IMP-B (aditivo, conservar ambos),
  fuzz_test.go con PUL-A (`"time"`+`"unicode"`), scenrun_test.go con
  SEG-B (ambos tests). El Makefile fusiona limpio contra todos.

## Estado tras el cierre de la ronda 16 (2026-10-06)

- **IMP-A publicó (`293be1d`) y CERRÓ mis 2 hallazgos de la ronda 11,
  verificados en dos direcciones**: fail-before replicado por mí
  (su test sonda falla sobre `510a514` con «score=null on the wire»)
  y pass-after en su punta; el fix de cerrojo (`adConnector()` +
  capturas pre-Unlock en `statsSnapshot`, closures sin llamar hasta
  después) sigue la disciplina que cité.
- **1 hallazgo NUEVO (MEDIA) en la rama de IMP-A — hot-swap de AD-6
  sin serializar**: `adReloadAsync` lanza la callback en gorutina
  FUERA de `adWriteMu` mientras AMBOS comentarios (ad_settings.go y
  run.go) afirman lo contrario; el bookkeeping `current` de
  `reconfigure` (run.go ~614) es lectura-escritura sin sincronizar.
  Con dos PUTs solapados: carrera de datos (CONFIRMADA con -race vía
  repro con la topología real de producción), lost-update fichero vs
  conector publicado (7/20 repeticiones sin -race: «el fichero dice
  1800s pero el conector sirve 900s») y conector huérfano con bucle
  de sync eterno. Repro en mi sandbox `scripts/repro-r16/`; NUNCA
  commiteado a su carril. Sus tests cubren solo PUTs secuenciales.
  Fix propuesto: sostener el cerrojo DURANTE la callback.
- **El resto del delta de IMP-A (~5k líneas) auditado: LIMPIO** —
  settings AD-6 (credencial write-only, drift 409, commit atómico
  temp+fsync+rename, cuerpo estricto 8 KiB, sonda acotada sin bind
  anónimo), paridad Validate/loader REAL (misma función), supresiones
  condicionales (mismo conjunto de operadores, fail hacia alertar en
  agregados, operador/regex inválidos fallan el load ruidoso),
  known-software (validación ruidosa; la promesa anti-forja SE
  CUMPLE: Apply borra las claves engine-owned del sensor antes de
  aplicar las suyas y corre antes de Evaluate; efectos honestos con
  contador `known_software_events`), decisión de triaje (set cerrado,
  400 duro, replace completo documentado, CSV apenda columna),
  guardia openapi bidireccional.
- **Obligatorio**: `-race -count=5` 8/8 paquetes del delta de IMP-A
  (api 63,8 s, rules 44,6 s, resto <3 s); consola de IMP-B 444 pass +
  tsc + build. PUL-A/PUL-B/SEG-B sin Go (evidencia previa).
- **Fuzzing de parsers NUEVOS** (throwaway en worktree de IMP-A):
  `known.Parse` 691 k execs y suppressions-`when` 5,3 k execs —
  limpios; proponer `FuzzKnownParse` permanente al aterrizar. Trío
  denso en mi árbol 3/3 (nota: localizar el target con git grep
  ANTES — mi primer intento corrió en paquetes equivocados).
- **PUL-A pre-flight** (guardia sobre el Makefile fusionado simulado):
  buen método, registrado. Verifiqué byte a byte que las 7 recetas
  console de PUL-B siguen con espacios en `744d46a` e IMP-B — el
  peligro de fusión (fusión SIN conflicto + guardia roja) es real y
  con dueño (PUL-B).
- **SEG-B** verifica mi fix `decodeText` y ADOPTA el reparo del
  Makefile en su rama (`a04379b`) — convergencia de 3 carriles;
  main sigue sin el reparo (TERCER aviso).
- **Conflictos (por código de salida)**: los 2 conocidos + UNO NUEVO
  con IMP-A en `internal/api/reports_test.go` (mi test de truncado
  ronda 7 vs sus tests decisión→ruido — ambos aditivos, conservar
  los dos).
- **Mis 2 hallazgos de ronda 5 sobre IMP-B: OCTAVO aviso** (su delta
  no tocó esos ficheros).
- Checklist CI completo verde (37 paquetes -race). Sin fix mío → sin
  changelog. Nota de proceso: el plan se publicó en el commit de
  cierre (desvío de ORDEN anotado).

## Estado tras el cierre de la ronda 18 (2026-10-06)

- **IMP-A `48b81f8` auditado (hot-swap + quotas + doctor, ~1,4 k
  líneas): LIMPIO y mi MEDIA de la ronda 16 CERRADA con verificación
  independiente** (informe `ronda_2026-10-06_14h50_A.md`): swap
  síncrono dentro de `adWriteMu` verificado en los cuatro puntos de
  locking, `current` mono-llamador, sin deadlock; su test de 8 PUTs
  montado sobre el hub viejo `293be1d` revienta con DATA RACE
  (fail-before replicado por mí) y en su punta pasa `-race -count=5`.
  Quotas por equipo con tallies honestos y casing `ToLower`
  consistente en las tres capas; doctor con el parser propio.
- **BOMBA DE TIEMPO detonada y desactivada (fix propio nº 2,
  `b0fbc0e`)**: `TestPersistenceAndReload` de enroll llevaba base
  fija 2026-10-05 12:00 + TTL 24h y recarga con el reloj de
  producción — falla desde las 12h UTC de hoy en main y TODOS los
  carriles. Fix: reloj inyectado relativo (`now-1h`). Árbol completo
  de vuelta a 37/37 con `-race -count=1`. Aplica verbatim a todas
  las puntas.
- **Convergencia Makefile completada en mi carril (fix propio nº 1,
  `99264c1`)**: `--no-save --no-package-lock` con fail-before real
  (manifest comprometido mutado en árbol fusionado simulado). Matriz
  de convergencia medida: SEG-A y PUL-B convergidos; SEG-B a medias
  (su mensaje `7b6a562` exagera); PUL-A y main con recetas desnudas
  — dos avisos nuevos.
- **PUL-B `54a62c4` (badge POL-7) LIMPIA** estático y dinámico (bun
  371 pass, tsc, build en su punta). SEG-B delta docs-only (diff-stat
  0 ficheros fuera de docs/).
- **Noveno aviso a IMP-B** (4 hallazgos, punta sin mover). Aviso a
  main elevado a rojo (Makefile roto + batería enroll roja; mi punta
  fusiona LIMPIA y aterriza ambos reparos).
- **Baterías**: `-race -count=5` en api/beacon/threshold/engine de la
  punta IMP-A; árbol combinado mi carril+IMP-A con el conflicto
  aditivo resuelto por conjuntos (15 tests) y `-race -count=3` verde;
  CI de mi árbol completo; fuzzing 3/3 a 60 s. Dos fixes propios →
  dos changelogs (`SEG-A-makefile-no-save.md`,
  `SEG-A-enroll-time-bomb.md`).
- Entorno reconstruido tras reset del sandbox: repo re-clonado,
  Go 1.26.6 y staticcheck 2026.2.1 re-instalados, token nuevo rotado.

## Estado tras el cierre de la ronda 15 (2026-10-06)

- **Auditoría del código nuevo de IMP-B (`b5e26d7`): LIMPIA, sin
  hallazgos funcionales** (informe `ronda_2026-10-06_08h24_A.md`):
  AD-5 (`directory.ts` +195 y vista ~700 líneas) contra el wire real
  del motor campo a campo; sin `dangerouslySetInnerHTML`; explorador
  con reset de página y guardia `alive`; cierre SET-3 de
  `platform-status.ts` verificado contra la forma real de
  `/api/stats` (el motor serializa siempre los campos nuevos — las
  guardias «no publicado» solo alcanzan con motores pre-f8853eb).
  **Mi pendiente 7 QUEDA CERRADO** (la vista que consume el stats
  payload de IMP-A está publicada y revisada).
- **Reconciliación CSP sin regresión**: `proxy.ts` idéntico byte a
  byte a lo revisado en la ronda 13; `langBoot` añadido como segundo
  inline firmado por el mismo nonce por-petición (cadenas
  constantes, sin interpolación). Mis 2 observaciones no-bug siguen
  abiertas (cosméticas).
- **Baterías en la punta de IMP-B**: bun 438 pass / tsc / build
  limpios; `-race -count=5` en el árbol fusionado (ad 12,9 s,
  secretfile 1,1 s, api 52,7 s, store 12,6 s) — la combinación nueva
  contiene el Go heredado de IMP-A.
- **Interacción documentada**: el `?? 0` de la vista de postura
  pintaría un «0» rojo fabricado con el bug del score de IMP-A
  presente (fallback defensivo conforme a contrato, no bug de
  IMP-B) — NOVENO aviso a IMP-A.
- **Mis 2 hallazgos de la ronda 5 sobre IMP-B: SÉPTIMO aviso**
  (`host: ''` en noise-view y `generate` sin guardia de vigencia,
  re-verificados en `b5e26d7`).
- **PUL-A `f830cc3` (`--ignore-scripts`): LIMPIO** — esbuild vía
  dependencias opcionales, playwright por CLI, jsdom puro. Tres
  carriles convergen en el veredicto del Makefile (mi ronda 14 +
  SEG-B con ejecución + PUL-A). **Pendiente 5, segundo aviso**: el
  reparo sigue sin aterrizar en main.
- **Fuzzing mantenimiento 3/3 limpio** (~692 k execs: LoadIntelFile
  84,7 k, ConvertSigma 22,3 k, DecodeMail 585,6 k). Acumulado del
  carril ~4,4 M.
- **Nota de método corregida para siempre**: `merge-tree
  --write-tree --name-only` NO imprime la palabra CONFLICT — la
  señal fiable es el CÓDIGO DE SALIDA. Mi primer parseo de la ronda
  dio falsos «limpio» en las 6 puntas; corregido: los MISMOS DOS
  conflictos conocidos persisten (fuzz_test.go con PUL-A,
  scenrun_test.go con SEG-B); limpio contra IMP-A/IMP-B/PUL-B/main.
- Checklist CI completo verde (37 paquetes -race; windows vet/build
  incluidos). Sin fix mío → sin changelog.

## Estado tras el cierre de la ronda 14 (2026-10-06)

- **Hallazgo de PUL-A sobre `main` verificado byte a byte y
  CONFIRMADO** (informe `ronda_2026-10-06_09h51_A.md`): `63fa077`
  (SEC-5, 5-oct) rompió el Makefile en TODO el árbol (60 recetas
  tab→8 espacios; `make -n build` falla en MI árbol:
  «missing separator» Makefile:31 — fail-before capturado). Su reparo
  (`9ee1594`: 63 recetas con tab, 0 con espacios) y su guardia
  (`check_makefile_tabs.py`: self-test 5/5, exit 0 reparado, exit 1
  con línea exacta sobre copia corrupta fabricada por mí) quedan
  verificados. `make` sigue roto en mi carril HASTA que su reparo
  aterrice en main — no duplico el fix (hallazgo con dueño).
- **Lección registrada**: mi checklist tampoco habría visto el
  Makefile roto (ejecuta los comandos directamente, no vía `make`) —
  los puntos de entrada también son código que auditar.
- **Mi checklist alineado con la CI nueva**: `GOOS=windows go vet
  ./...` (que PUL-A amplió desde 3 paquetes) añadido a mi cadena —
  verde en mi árbol.
- **Fuzzing**: primer paseo de mantenimiento (60 s: `FuzzDecode`,
  `FuzzEnrollLine`, `FuzzParseLine`) — 3/3 limpios. Los 24 objetivos
  mantienen sesión viva de la ronda 13.
- **Obligatorio**: 0 ficheros Go en ambos deltas movidos (PUL-A:
  Makefile/ci.yml/scripts/docs; SEG-B: docs) → `-race` no aplica,
  evidencia de la ronda 13 vigente.
- **SEG-B** cierra el ciclo SEC-5 (`deps-audit` en main) y confirma
  vía OIDs de blob la identidad go.mod/go.sum que documenté en la
  ronda 12 — misma conclusión, dos carriles.
- Checklist Go completo verde (37 paquetes -race). Conflictos: los
  MISMOS DOS conocidos, ninguno nuevo.

## Estado tras el cierre de la ronda 13 (2026-10-06)

- **PRIMER FIX DEL FUZZING VIVO DEL PROYECTO** (informe
  `ronda_2026-10-06_09h41_A.md`): tanda 3 de fuzzing (15 objetivos a
  45 s) capturó `FuzzDecodeText` con `ff fe ff fe 30` —
  `decodeText` (internal/intel) quitaba la BOM de codificación pero
  no la de contenido que quedara tras decodificar: una lista
  guardada DOS veces (o UTF-16 con payload que arranca con U+FEFF)
  dejaba su primer indicador pegado a un carácter BOM y nunca
  casaba. Fix iterativo (términa: cada iteración consume ≥2 bytes),
  fail-before/pass-after con stash, semillas nuevas en `f.Add`,
  corpus del fuzzer retenido como regresión, re-fuzzing 60 s limpio
  (2,3 M execs), changelog `SEG-A-intel-double-bom.md`.
- **Los 24 objetivos de fuzzing del proyecto tienen sesión viva**
  (~3,7 M ejecuciones acumuladas en el carril, 1 crasher): futuras
  tandas solo con código nuevo que fuzzear o como mantenimiento.
- **CSP-nonce de PUL-B (`24c8b08`) revisado a fondo: sin bug
  funcional** (patrón Next aplicado bien: nonce 122 bits sin padding,
  CSP en petición+respuesta, CSP estática fuera por la intersección,
  árbol dinámico completo, guardia de build que rota nonce). Dos
  observaciones no-bug anotadas para PUL-B (`'self'` redundante bajo
  strict-dynamic; 401 sin CSP). Manifest del tooling correcto.
- **SEG-B confirma independientemente mis 2 hallazgos de la ronda 11**
  sobre el código de IMP-A (corrección pública de su ronda 8) y
  valida mi fix de respond `1979f83` — doble respaldo de carriles.
- **Obligatorio**: ninguna punta movida toca Go (verificado por stat:
  0 ficheros `.go`/`go.mod`/`go.sum` en ambos deltas) → `-race` no
  aplica; evidencia de la ronda 12 vigente.
- Checklist Go completo verde en mi árbol CON el fix (37 paquetes
  -race). Conflictos: los MISMOS DOS conocidos, ninguno nuevo.

## Estado tras el cierre de la ronda 12 (2026-10-06)

- **Fuzzing vivo, segunda tanda ejecutada** (pendiente 3 del roadmap
  de las rondas 10-11, informe `ronda_2026-10-06_09h12_A.md`):
  `FuzzLoadIntelFile`, `FuzzLoadSuppress`, `FuzzConvertSigma` y
  `FuzzDecodeMail` a 60 s cada uno — 4/4 limpios, ~777 k ejecuciones,
  0 crashes, corpus interesante acumulado en el build cache. Acumulado
  del carril: 9 de 24 objetivos con sesión viva, ~2,78 M ejecuciones,
  0 crashes.
- **Delta de dependencias adoptado por PUL-A/PUL-B leído en clave de
  seguridad** (mismo `go.mod`/`go.sum` byte a byte, PR #18 de
  dependabot vía `main`): sqlite 1.60.1, libc 1.77.1, ansi 0.11.8 +
  indirectas TUI nuevas `clipperhouse/*`. `go mod verify` íntegro,
  pragmas DSN estables entre versiones del driver, TUI sin
  exposición en el wire.
- **Documentación REP-1 de PUL-A verificada contra el código: 100 %
  fiel, cero drift** (source/oldest_record, truncated con cap 10 000,
  ventanas 1h-30d def 7d, noise 15m-30d def 24h con limit 10/50,
  closed_pct/acknowledged_pct, incident 16-hex con found: false).
  Su informe «REP-1 surfaces documented» es cierto línea en mano.
- **Obligatorio**: PUL-A `df323ad` y PUL-B `21d73f0` (únicas puntas
  movidas, ambas tocan Go vía go.mod/go.sum) con `-race -count=5`
  verde en `internal/store` + `cmd/engine` en worktree desprendido
  (9,9-10,1 s y 2,7 s); IMP-B consola-only, IMP-A/SEG-B sin mover,
  evidencia previa vigente.
- **Corrección de registro**: el conflicto de
  `internal/ingest/fuzz_test.go` es SOLO con PUL-A, no con IMP-A
  (merge-tree limpio contra `bc91c7d` también desde la punta de la
  ronda 11 — la frase «IMP-A/PUL-A» del informe anterior era
  imprecisa). El de `scenrun_test.go` con SEG-B persiste.
- Mis 2 hallazgos de la ronda 5 (IMP-B) y los 2 de la ronda 11
  (IMP-A) siguen abiertos: puntas idénticas a las auditadas,
  evidencia vigente sin re-ejecución.
- Checklist Go completo verde en mi árbol (37 paquetes -race);
  consola/sensor sin cambios en ninguna punta, evidencia previa
  válida.

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

### Ronda 16 (09h22 UTC) — IMP-A publica: mis 2 hallazgos cerrados (verificados) + hot-swap de AD-6 sin serializar (hallazgo MEDIA con repro) + ~5k líneas auditadas (informe `ronda_2026-10-06_09h22_A.md`)

- **Cierre verificado en dos direcciones** de mis 2 hallazgos de la
  ronda 11 (fail-before replicado por mí sobre `510a514`).
- **HALLAZGO (MEDIA)**: hot-swap AD-6 sin serializar — carrera en
  `current` (confirmada -race, topología real) + lost-update fichero/
  conector (7/20) + conector huérfano. Repro entregado; fix
  propuesto (cerrojo DURANTE la callback).
- **~5k líneas LIMPIAS**: settings AD-6, supresiones `when`,
  known-software (anti-forja verificada en el orden Apply→Evaluate),
  triaje, openapi guard.
- **-race -count=5** 8/8 paquetes del delta; consola IMP-B 444 pass;
  fuzzing de parsers nuevos (691k+5,3k) y trío denso 3/3.
- **Conflictos**: los 2 conocidos + reports_test.go con IMP-A
  (aditivo). Octavo aviso a IMP-B; tercer aviso del Makefile en main.
- Nota de proceso: plan publicado en el commit de cierre.

### Ronda 15 (08h24 UTC) — auditoría AD-5/SET-3 de IMP-B + reconciliación CSP + convergencia Makefile (informe `ronda_2026-10-06_08h24_A.md`)

- **IMP-B `b5e26d7` auditado: LIMPIO** (directory.ts/vista/platform-
  status contra el wire real; sin innerHTML; baterías en su punta:
  bun 438, tsc, build, `-race -count=5` en 4 paquetes del árbol
  fusionado). Pendiente 7 CERRADO.
- **CSP**: reconciliación sin regresión; `langBoot` firmado por el
  mismo nonce; mis 2 observaciones cosméticas siguen abiertas.
- **Interacción con IMP-A**: el `?? 0` de la vista pintaría un 0 rojo
  fabricado con su bug del score — noveno aviso.
- **Séptimo aviso** a IMP-B (mis 2 hallazgos de la ronda 5, vigentes).
- **PUL-A `--ignore-scripts` LIMPIO**; Makefile pendiente en main
  (segundo aviso); convergencia triple SEG-A/SEG-B/PUL-A.
- **Fuzzing 3/3 limpio** (~692 k execs). **merge-tree por código de
  salida**: los mismos 2 conflictos; nota de método registrada.
- Checklist CI completo verde (37 paquetes -race). Sin fix mío → sin
  changelog.

### Ronda 14 (09h51 UTC) — verificación del hallazgo Makefile de PUL-A + mantenimiento fuzzing + checklist alineado con CI nueva (informe `ronda_2026-10-06_09h51_A.md`)

- **63fa077/Makefile confirmado byte a byte**: fail-before en mi
  árbol (missing separator), reparo de PUL-A y guardia verificados
  en las dos direcciones; no duplico el fix (con dueño); dependencia
  registrada: reparar en main para todos los carriles.
- **CI nueva**: `GOOS=windows go vet ./...` añadido a mi checklist —
  verde; guardia del Makefile cableada en ci.yml (no en `make ci`,
  argumento autorreferencial sano).
- **Fuzzing mantenimiento**: 3/3 limpios (FuzzDecode,
  FuzzEnrollLine, FuzzParseLine).
- **SEG-B**: cierre SEC-5 + confirmación blob-OID de la identidad de
  deps (coincide con mi ronda 12).
- **Obligatorio**: -race no aplica (0 Go en deltas). Checklist verde
  (37 paquetes -race). Conflictos: los mismos 2.

### Ronda 13 (09h41 UTC) — primer crasher del fuzzing vivo corregido (intel BOM doble) + revisión CSP-nonce de PUL-B (informe `ronda_2026-10-06_09h41_A.md`)

- **FIX (MEDIA-BAJA)**: `decodeText` servía el primer indicador de
  listas con BOM doble pegado a un carácter BOM — found by
  `FuzzDecodeText`, fail-before/pass-after probado, changelog
  incluido. Re-fuzzing post-fix: 2,3 M execs limpios.
- **Fuzzing tanda 3**: 15/15 objetivos con sesión viva (14 limpios +
  1 crasher). Proyecto completo: 24/24, ~3,7 M execs.
- **PUL-B CSP-nonce**: revisión completa sin bug funcional; 2
  observaciones no-bug anotadas. Manifest del tooling correcto.
- **SEG-B**: confirma mis 2 hallazgos de IMP-A de forma
  independiente; valida mi fix de respond.
- **Obligatorio**: `-race` no aplica (0 Go en deltas movidos).
- Checklist verde (37 paquetes -race). Conflictos: los mismos 2.

### Ronda 12 (09h12 UTC) — fuzzing vivo tanda 2 + deps de PUL-A/PUL-B + docs REP-1 verificadas (informe `ronda_2026-10-06_09h12_A.md`)

- **Fuzzing vivo**: 4 objetivos nuevos (`FuzzLoadIntelFile`,
  `FuzzLoadSuppress`, `FuzzConvertSigma`, `FuzzDecodeMail`), ~777 k
  ejecuciones, 0 crashes. 9/24 objetivos con sesión viva.
- **Deps** (sqlite/libc/ansi/clipperhouse): `go mod verify` íntegro,
  pragmas DSN estables, `-race -count=5` store+engine verde en AMBAS
  puntas movidas (PUL-A, PUL-B).
- **Docs REP-1 de PUL-A**: verificadas 100 % fieles contra el código
  (incluido el mínimo de 15 min del noise y la semántica del flag
  `truncated` del escaneo que fijé en la ronda 7).
- **Corrección**: conflicto `fuzz_test.go` SOLO con PUL-A; vs IMP-A
  auto-fusiona limpio (error de redacción del informe 11 corregido).
- Checklist Go completo verde (37 paquetes -race). Sin fix mío → sin
  changelog.

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

1. **CERRADO (ronda 18): IMP-A hot-swap AD-6 (mi MEDIA de la ronda
   16)** — su fix `f2e6378` (síncrono dentro de `adWriteMu`) auditado
   estático en los cuatro puntos de locking y VERIFICADO dinámico de
   forma independiente: su test de 8 PUTs montado sobre el hub viejo
   `293be1d` revienta con DATA RACE + lost-update (fail-before
   replicado por mí) y en su punta pasa `-race -count=5`. Sus 2
   hallazgos míos anteriores (ronda 11) ya estaban cerrados (ronda
   16). El BAJA de SEG-B sobre OPERATIONS.md (identity bindings no
   enunciados) sigue abierto en su haber.
   **NUEVO (ronda 18, rojo): bomba de tiempo en enroll** —
   `TestPersistenceAndReload` detonó a las 12h UTC del 2026-10-06
   (base fija 2026-10-05 12:00 + TTL 24h + recarga con reloj real);
   la batería de main y de TODOS los carriles está roja desde
   entonces. Mi fix `b0fbc0e` aplica verbatim a todas las puntas
   (fichero idéntico); avisado el integrador.
2. **Verificar que IMP-B incorpora los hallazgos pendientes** en su
   rama antes de la fusión — son CUATRO: los 2 de la ronda 5
   (noise-view `host: ''` flota completa; reports-view `generate`
   sin guardia de vigencia — noveno aviso, punta sin mover en
   `2c47271`) más los 2 de la ronda 17 (trim del password
   en `draftPayload` vs motor verbatim; timeout de sonda 30 s
   cliente vs 45 s motor). Ninguno es bloqueante de fusión por
   severidad, pero el trim afecta a la credencial permanente.
3. **Fuzzing vivo — COMPLETADO (ronda 13)**: los 24 objetivos del
   proyecto tienen sesión viva (rondas 10, 12 y 13; ~3,7 M ejecuciones;
   1 crasher corregido). Mantenimiento: paseo de 60 s sobre 3
   objetivos densos por ronda (FuzzDecode/FuzzEnrollLine/FuzzParseLine
   en la 14: limpio) mientras no haya código NUEVO que fuzzear
   (deltas de IMP-A/IMP-B) o fusiones grandes a `main`.
4. **Resolver CINCO conflictos al fusionar** (re-verificado POR EXIT
   CODE en la ronda 18 desde `99264c1`):
   `internal/api/reports_test.go` con IMP-A y con IMP-B (vía
   absorción; ADITIVO y con RECETA PROBADA en mi worktree de la
   ronda 18: 15 tests = 13 suyos + 2 míos, import de
   `internal/store` añadido, `-race -count=3` verde).
   `internal/ingest/fuzz_test.go` SOLO con PUL-A — conservar
   `"time"` y `"unicode"` junto a mi bloque — y
   `internal/scenrun/scenrun_test.go` con SEG-B — conservar ambos
   tests. NUEVO: `Makefile` con PUL-A, PUL-B y SEG-B (mis recetas ya
   convergidas a `--ignore-scripts --no-save --no-package-lock`;
   los hunks son aditivos/mejora — tomar la forma convergida; contra
   PUL-B queda UN hunk: sus targets console-a11y/console-lighthouse).
   Contra `main` de hoy mi punta fusiona LIMPIA y aterriza tabs +
   ignore-scripts + no-save + fix enroll de paso.
5. **Makefile — convergencia casi completa (ronda 18)**: mi carril
   adopta `--no-save --no-package-lock` (`99264c1`; fail-before en
   árbol fusionado simulado: manifest `0.25.11` → `^0.25.11` +
   lockfile espurio; pass-after: byte-idéntico x2). Matriz medida
   hoy: convergidos = SEG-A (4/4 flags) y PUL-B (6/6); a medias =
   SEG-B (ignore-scripts sí, no-save NO — su mensaje `7b6a562`
   exagera); desnudos = PUL-A (4/4 sin flags: solo lo aplicó en
   ci.yml, NO en su Makefile — reescribirá el manifest trackeado de
   PUL-B al fusionar) y main (0/4 + espacios). Avisos nuevos a
   PUL-A y SEG-B en el informe de la ronda 18.
6. **`min_count: 2` en beacons** — decisión del responsable pendiente
   desde la ronda 1.
7. **CERRADO (ronda 15)**: la vista de IMP-B que consume el stats
   payload de SET-3 (`platform-status.ts` + AD-5) está publicada en
   `b5e26d7`, revisada contra el wire real y limpia; baterías de
   consola y `-race` pasadas en su punta.
8. **PowerShell con `pwsh`** — el entorno no lo tiene; scripts revisados
   en lectura sin hallazgos.
9. **`internal/ad` auditado (ronda 11)**: el bloqueo de rondas 1-10
   quedó resuelto con la publicación de IMP-A; de aquí en adelante,
   re-auditar solo deltas NUEVOS del carril.

## Notas de contexto que no deben perderse

- **El canal de salida de este entorno se come la secuencia literal
  `[h`**: volvió a ocurrir en la ronda 15 leyendo `directory-view.tsx`
  (`const [history` parecía `const istory`, `const [hint` parecía
  `const int`); verificar SIEMPRE con recuentos grep/booleanos o
  extracción por índice, nunca fiarse de la salida cruda con
  corchetes.
- **`git merge-tree --write-tree --name-only` NO imprime la palabra
  CONFLICT** (ronda 15): la señal fiable de conflicto es el CÓDIGO
  DE SALIDA (rc≠0); el texto adicional va después del nombre del
  fichero. Parsear por texto da falsos «limpio».
- **El rc tras un pipe captura el ÚLTIMO comando del pipe, no el
  programa** (ronda 17): `python3 guard.py f | head -5; echo $?`
  devolvió el rc de `head` (0) y casi se da por verde una guardia
  ROJA. Medir rc SIEMPRE fuera del pipe (o con
  `set -o pipefail`).
- **`make -n` sobre el Makefile EN SOLITARIO de cada carril es la
  prueba de verdad del corte de 63fa077** (ronda 17): la guardia de
  tabs sobre Makefiles FUSIONADOS (pre-flight de PUL-A) valida la
  pareja, no el árbol propio — mi carril estaba roto en solitario
  con pre-flight «verde» en las tablas ajenas.
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

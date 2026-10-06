# Roadmap de Seguridad B — continuidad

Archivo vivo: qué tengo a medias, qué sigue y por qué. Se actualiza
cada ronda; los informes de cada ronda quedan en esta carpeta.

## Estado tras la ronda 2026-10-05 (ronda 1)

Tareas del TODO de mi carril (SEC-1 a SEC-6, SEC-9):

- **SEC-5 Dependencias — cerrada en su base, con mantenimiento vivo.**
  El CI escanea (`deps-audit.yml`: govulncheck + osv-scanner + cargo
  audit, push/PR + semanal) y el guard de ciclo de vida vigila la
  cadena de suministro JS (`check_package_lifecycle.py`, en `make ci`
  y en el workflow). `golang.org/x/text` elevada a v0.39.0 (GO-2026-5970).
  Decisión del PR #8 de Dependabot entregada en el informe: mantener
  (mantenimiento rutinario, no urgencia). Siguientes: responder a los
  rojos del nuevo job cuando aparezcan; revisar el `audit.toml`/`osv-scanner.toml`
  si alguien ignora un advisory.
- **SEC-6 Cadena de suministro — hecha la parte automática.** El
  auditado manual de los componentes React Bits copiados (11 ficheros,
  ~600 líneas, CSS/animación, sin red ni almacenamiento) está en el
  informe de la ronda 1. Pendiente: re-auditar cuando un carril copie
  componentes nuevos o añada dependencias (el guard avisa de los
  scripts, no de los componentes).
- **SEC-1 Modelo de amenazas — primera entrega.**
  `docs/MODELO-DE-AMENAZAS.md` con STRIDE por superficie (ingesta,
  alta de equipos, AD, inicio de sesión, informes y descargas, ajustes)
  y el estado de cada mitigación. Pendiente: actualizar la sección del
  alta de equipos cuando Implementación A aterrice la rama (los tests
  exigidos deben existir); añadir las secciones de prevención §6.2–6.4
  si el responsable desbloquea esa línea.
- **SEC-2 Secretos en reposo — revisado, sin hallazgos accionables en
  main.** Identidades y tokens solo como SHA-256; ficheros operativos a
  0600; banners de log sin valores. Lo que falta (DPAPI para
  credenciales de AD/SMTP/webhook, ACL de ProgramData del sensor) llega
  con las ramas de Implementación A: exigido en el modelo de amenazas
  (§3, §6) y anotado en el informe para su carril.
- **SEC-3 Entradas — revisado; un endurecimiento aplicado.** CSV con
  `csvSafe` correcto en el motor; sin `dangerouslySetInnerHTML` en la
  consola; `react-markdown` sin rehype-raw y con transformación de URLs
  por defecto; el sumidero `innerHTML` del estado del hub convertido a
  DOM nodes con guard estático. LDAP no existe aún: el escape RFC 4515
  queda como requisito en el modelo de amenazas §3 para AD-1.
- **SEC-4 Sesiones — revisado.** Basic + PBKDF2 con bloqueo y fail-closed
  hoy; CSRF cubierto por guard de origen (motor) y host pinning + 
  Sec-Fetch-Site (proxy); cabeceras CSP/XFO/nosniff presentes. TEAM-1
  (sesión con cookie) deberá cumplir el modelo de amenazas §4: regenerar
  id en login y mantener presupuesto anti fuerza bruta.
- **SEC-9 Privacidad — revisado, sin superficie de datos personales
  todavía.** Retención de store y forense configurable; los datos de
  usuario llegan con AD-3/AD-4: requisitos ya escritos en el modelo de
  amenazas §3 (auditoría de consulta de ficha, rol mínimo, RGPD).

## Estado tras la ronda 2026-10-05 (ronda 2)

- **SEC-5:** verificado el ciclo real del job `deps-audit`: aún no ha
corrido porque el workflow solo existe en mi rama (GitHub no lo ejecuta
para pushes a main hasta que el merge lo lleve allí). De paso: push sin
filtro (cada rama escaneada al empujar) y guard estático de triggers
`check_workflows.py` en `make ci` y en el propio workflow. Nota de
entorno para las siguientes rondas: las vistas de texto del entorno
corrompen secuencias con corchetes («[main]» se ve como «ain]»); todo
contenido crítico se verifica por bytes (el falso positivo me costó una
tarde de depuración — el trigger siempre fue válido).
- **SEC-1/2/4:** auditoría completa del protocolo ENROLL publicado en
`feat/enrollment` (5908107) — veredictos por fila en el modelo §2, sin
hallazgos accionables nuevos; residuo DPAPI/ACL ya asignado a
Implementación A.
- **CI en main (5e168ba) rojo, diagnosticado:** (a) `smoke_file_forensics.py`
con el count de reglas stale tras el pack de 39 reglas (7c2b7e8) — fix
ya reclamado por el PR #16 (toca el fichero); (b) 12 tests de
`internal/respond`/persistencia caen en el runner Windows con patrón
de ~3 s (esperas que expiran) — evidencia en el informe de ronda, para
el carril de motor. Nada de esto es mío: no toco smoke ni respond.
- **PRs:** #16 y #17 revisados por listado de ficheros (sin superficie
nueva de seguridad para mi carril); #8 de Dependabot: mantener, como en
la ronda 1.

## Estado tras la ronda 2026-10-05 (ronda 3)

- **Superficies nuevas auditadas y en verde:** `/api/scenarios*`
  (armado solo por flag y anunciado, replay aislado, POST con token +
  same-origin + una ejecución en vuelo + 8 KiB + timeouts clampeados),
  `/api/reports` y `/api/noise` (solo GET, escaneos y top lists
  acotados, CSV por `SafeCell`, filename cerrado) y el analista IA de
  incidentes (payload acotado consola→hub, validación campo a campo,
  prompt con fences y truncados, presupuesto doble, token fuera de
  loopback). Sin hallazgos accionables; veredictos completos en el
  informe de ronda.
- **Dos correcciones propias:** (1) el motor ahora envía
  `X-Content-Type-Options: nosniff` y `Referrer-Policy: no-referrer`
  en toda la API (middleware exterior; el guard `check_openapi.py`
  aprende el patrón con fixture nuevo); (2) el fallback de
  `newRunID` ya respeta la forma `run-` + 16 hex del contrato de
  `/api/scenarios/runs/{id}`, y el patrón vive en
  `scenrun.ValidRunID` (una sola definición).
- **PR #18 de Dependabot: roto, no fusionar tal cual.** El bump de
  `x/ansi` v0.11.8 no compila contra `x/cellbuf` v0.0.13 (pseudo-versión
  de bubbletea; la API de `ansi.Style` cambió). La parte de
  `modernc.org/sqlite` v1.60.1 sola está verificada en verde (build
  Linux/Windows, vet, 37 paquetes con `-race`, govulncheck limpio).
  Receta y evidencia en el informe. Las `clipperhouse/*` nuevas del
  grafo TUI se revisan cuando la cadena sea coherente.
- **SEC-6 re-auditoría reactbits: sin hallazgos nuevos** (11 ficheros,
  642 líneas, solo presentación; PUL-B toca colores en cuatro esta
  ronda, sin superficie nueva).
- **Observaciones asignadas:** IMP-B — rol `analyst` y cap 8 KiB para
  `POST /api/scenarios/run` en el proxy; console-service — unificar la
  validación de `analyst:ask` con la de incidentes (candidato para mi
  siguiente ronda si nadie lo coge).

## Estado tras la ronda 2026-10-05 (ronda 4)

- **`analyst:ask` (alerta única) endurecido:** la copia de reserva del
  cliente pasa hoy por la misma limpieza campo a campo que el flujo de
  incidentes (`cleanAlertObject` compartido; campos desconocidos fuera
  del prompt, cadenas clampeadas). La copia del motor sigue siendo
  autoritativa mientras el id esté en el anillo; mensajes y
  presupuestos sin cambios. Tests unitarios + de integración; el test
  de integración demostrado en rojo contra el código previo.
  console-service: 108 pass / 0 fail, tsc limpio.
- **AD-1/SEC-2 siguen sin publicarse** (IMP-A en su commit de plan al
  abrir y al cerrar la ronda): nada que auditar todavía.

**Nota de parada (protocolo, condición «bloqueado»):** tras la ronda 4
no queda ninguna tarea de mi carril ejecutable sin trabajo ajeno:
- AD-1 y SEC-2 dependen de IMP-A (ni `main` ni su rama tienen código);
- SEC-9 (ficha de usuario, auditoría de consulta) depende de AD-3/AD-4
  y WEF, también IMP-A;
- prevención §6.2-6.4 exige decisión explícita del responsable;
- `deps-audit` y los guards solo corren en `main` cuando el responsable
  fusione las rondas pendientes.
Al publicarse AD-1, esa auditoría es la primera tarea de la ronda
siguiente (checklist en la ronda 3 de este roadmap y modelo §3).

## Estado tras las rondas 2026-10-05 (rondas 5-7)

- **SEC-3, exportaciones CSV de la consola: guardia de fórmulas
  unificada.** Los «table twins» de las gráficas (`chart-frame`) y la
  exportación de la selección de alertas son los mismos datos que el
  motor ya escapa en su CSV de `/api/reports` (hostnames, identidades,
  texto de timeline), pero la consola los serializaba ella misma:
  `csvCell` de `chart-export.ts` no aplicaba regla alguna y
  `alert-actions.tsx` llevaba una copia local más débil que la del
  motor (sin fullwidth ＝＋－＠, sin saltar espacios iniciales, sin
  `\n`). Ahora hay una sola definición con la semántica exacta de
  `SafeCell` (`internal/report/report.go`), el contrato nullish que la
  exportación de alertas ya usaba y exención para números finitos.
  Tests que fallaron antes del fix. **Historia:** el fix original se
  perdió con un reinicio del entorno antes de publicarse (sin
  credenciales git); la ronda 7 lo re-aplicó íntegro y lo
  re-verificó: consola 376 pass / 0 fail + tsc + build, y el árbol
  fusionado completo (console-service 108 pass incluido).
- **SEC-5, PR #18 de Dependabot: fusionado por el responsable, con el
  fix de compatibilidad que mi ronda 6 pedía.** No entró «tal cual»:
  el merge incluye `x/cellbuf` v0.0.13→v0.0.15, compatible con
  `x/ansi` v0.11.8. Batería Go completa del estado fusionado en
  verde: gofmt, build Linux/Windows, vet, 37 paquetes con `-race`,
  govulncheck limpio, staticcheck limpio. Revisión de las indirectas
  nuevas del grafo TUI (`clipperhouse/displaywidth` v0.11.0,
  `clipperhouse/uax29/v2` v2.7.0): MIT, procesamiento local de texto
  (segmentación Unicode TR29), sin red ni exec — cadena limpia.
- **Ronda 6 (revisiones sin código):** workflow de fuzzing nocturno
  de PUL-A limpio desde la seguridad CI; higiene de `SECURITY.md` de
  PUL-B sin debilitar la política; deep-links de REP-4 de IMP-B
  correctos (16-hex, whitelist, catálogo como whitelist); reactbits
  (`blur-text`, `decrypted-text`) tras la ronda a11y, limpios; tooling
  a11y limpio (fuera del grafo de la app, versiones fijadas,
  loopback-only; observación a PUL-B: comprometer lockfile del
  tooling).
- **Playbooks de respuesta de IMP-B (`9f35615`, en su rama):
  veredicto positivo a nivel de commit** — validación campo a campo
  con topes (200/1000/64), rechazo de caracteres de control y BIDI
  (anti-spoofing en exports), almacenamiento con tope y expulsión,
  sin HTML crudo; re-auditoría profunda al fusionar.
- **AD-1/SEC-2 siguen sin publicarse** (IMP-A en su commit de plan):
  la auditoría del conector sigue siendo la primera tarea al
  desbloquearse (checklist en la ronda 3 y §3 del modelo de amenazas).
- **Lección de entorno:** el reinicio perdió el clon y los commits no
  publicados; solo sobrevivió lo fusionado en remoto. Publicar pronto
  (y no acumular trabajo local sin push) es parte del control de
  riesgo.

## Siguientes rondas (orden propuesto, tras la ronda 4)

1. **AD-1 en cuanto IMP-A la publique:** LDAPS obligatorio y
   validación de certificado, credencial fuera de API y logs, escape
   RFC 4515, paginación y tope de objetos, cero operaciones de
   escritura, auditoría de la dependencia LDAP nueva. Es la prioridad
   del responsable y mi verificación pasa de requisito a código.
2. **SEC-2 con IMP-A:** DPAPI para la credencial (diseño completo
   entregado como addendum del informe de la ronda 4: sobre
   `dpapi|plain`, ACL, escritura con bind de prueba y `[]byte` en
   memoria; sus tests son mi checklist de auditoría).
3. ~~Unificar la validación de `analyst:ask` con
   `validateIncidentPayload`~~ — hecho en la ronda 4 (`6597e27`).
4. Verificar el fix del smoke del PR #16 si llega antes del merge, y
   el ciclo real de `deps-audit` en `main` tras el merge de la ronda 1
   (el job ya corre verde en mi rama).
5. Revisar los próximos PRs de Dependabot con la misma disciplina
   (bump + CI verde local antes de recomendar; los de seguridad,
   urgentes).

## Ronda 8 (2026-10-06) — cierre del carril (RONDAS_MAXIMAS)

- **Segundo reinicio del entorno** tras publicar la ronda 7; sin
  pérdida (el push con el token efímero dejó 55c8b35 en remoto). La
  lección «publicar pronto» se validó en la práctica.
- **AD-1 auditada** (IMP-A f8853eb): LDAPS implícito por defecto con
  CA exigida y ServerName fijado; filtros literales (inyección
  imposible por construcción); paginación RFC 2696 con criticality
  TRUE y tope aplicado en el bucle; credencial fuera de logs y API con
  tests canario (137 chars, en crudo/base64/hex + longitud); cero
  primitivas de escritura LDAP; fixture LDAP real en CI. Cumple, con
  la fila «E» (negativa a operar) como aviso a la espera de decisión
  del responsable.
- **SEC-2 auditada** (IMP-A 3c8a97d): sobre versionado dpapi|plain,
  LOCAL_MACHINE en Windows, plain+0600 verificado en cada lectura
  POSIX, temp+rename+Sync con chmod previo, secreto solo por stdin,
  búfer propio puesto a cero tras el bind (copia string documentada
  como límite de go-ldap), avisos sin reescritura automática. Cumple:
  4/5 tests exigidos; el 5.º (bind de prueba) es del flujo AD-6.
- **Cadena de suministro:** go-ldap v3.4.11, asn1-ber, go-ntlmssp —
  MIT las tres, sin red fuera del DC configurado. Limpia.
- **IMP-B i18n + asistente (46e3996/7c21abb):** limpio (listas
  blancas, lectura tolerante validada, sin HTML crudo, secretos fuera
  de cliente). **SEG-A idempotencia (1979f83):** correcta (cierra
  check-then-act). **PUL-B a11y (fa2b56a):** sin regresiones sobre la
  guardia CSV (solo contraste).
- **Verificación:** consola 376 pass / tsc / build en el clon nuevo.
  La batería Go de imp-a no se ejecutó aquí (CDN de Go inalcanzable,
  tres intentos, límite del sandbox); queda para su CI y la
  re-auditoría al fusionar. La batería Go propia no se repite: árbol
  idéntico al 55c8b35 ya validado.
- **Cierre del carril:** 8/8 rondas. Pendiente de otros: seguimiento
  SEC-5 (ciclo real de `deps-audit` — CERRADO en la ronda 10; en esta
  línea lo numeré antes por error como «SEC-9», corrección pública
  allí), O-2 (decisión sobre la fila E) y O-3 (bind de prueba en AD-6).
  Para quien fusione: conservar ambos tests EOF en
  internal/scenrun/scenrun_test.go (conflicto anotado con seguridad-a).

## Ronda 9 (2026-10-06, verificación fuera de cuota)

- **Hallazgos de SEG-A confirmados de forma independiente** (inspección
  propia sobre bc91c7d): (1) MEDIA — `GET /api/ad/posture` nunca sirve
  `score` (campo declarado y jamás asignado); (2) BAJA — lecturas sin
  cerrojo de `h.ad` (4 handlers) y de `version`/`alertLatency`/
  `ingestCert` fuera del span en `statsSnapshot`. Corrección pública:
  los veredictos de seguridad de la ronda 8 se mantienen; la fila
  «limpio» de `api/ad.go` era incompleta (mi checklist no cubre
  completitud de campos ni contratos de mutex). Corregirá IMP-A.
- **PUL-B CSP por nonce (d458fae): limpio** — patrón Next.js correcto
  (nonce por petición de 122 bits, strict-dynamic, firma del theme
  boot vía x-nonce, CSP estática eliminada con razonamiento correcto,
  check dedicado que exige rotación y firma total). Observación de la
  ronda 6 (lockfile del tooling) CERRADA con su manifest.
- **PUL-A go.mod (df323ad): limpio** — solo sincronización con la
  cadena del PR #18 ya auditada.
- El carril vuelve a parada por cuota agotada; puerta de reapertura:
  contenido nuevo de seguridad (AD-6, re-verificación integrada tras
  la fusión a main). La mención a «SEC-9» de esta entrada era el
  seguimiento de deps-audit, que es SEC-5 — corregido y cerrado en la
  ronda 10; SEC-9 real es Privacidad y depende de AD-3/AD-4.

## Ronda 10 (2026-10-06, 07h22 UTC, verificación fuera de cuota)

- **Cruce con la ronda 12 de seguridad-a (f72a479):** registro de
  conflictos re-verificado (único conflicto: `scenrun_test.go`,
  «conservar ambos» vigente; su corrección de `fuzz_test.go` es
  solo-suya y consistente); identidad byte a byte del go.mod/go.sum
  (`380a323f`/`d3211152`) en main/PUL-A/PUL-B confirmada; versiones
  del delta verificadas contra el árbol; cobertura de seguridad del
  conjunto ya completa entre ambos carriles (integridad suya,
  govulncheck/licencias mías).
- **Seguimiento SEC-5 CERRADO:** el ciclo real de `deps-audit` está
  verificado con evidencia de primera mano en main — workflow con
  cron semanal + política de alertas (`deps-audit.yml`), primer ciclo
  real con 5 vulnerabilidades de stdlib alcanzadas y corregidas vía
  go 1.26.6 (`cfe9d85`), y mi ALTA de x/text aplicada (`cbc31b1`,
  GO-2026-5970). Límite: la historia de Actions no es observable
  desde el sandbox; evidencia documental.
- **Corrección pública de numeración:** deps-audit es SEC-5, no
  SEC-9. SEC-9 real = Privacidad (TODO.md l. 767), bloqueada por
  AD-3/AD-4 de IMP-A (sin código). Mis informes históricos no se
  tocan; las entradas vivas del roadmap quedan corregidas.
- **Fuzz lote 2 constatado:** los 4 objetivos existen en f72a479 en
  los paquetes listados; 24 objetivos en su carril vs 20 en main.
- Informe: ronda_2026-10-06_07h22_B.md. Sin changelog (verificación).
  Sin Go en el sandbox (ronda de docs; evidencia previa válida).
  Puerta de reapertura actualizada: AD-6, AD-3/AD-4 (SEC-9),
  fusiones a main.

## Ronda 11 (2026-10-06, 07h43 UTC, verificación fuera de cuota)

- **Cruce con la ronda 11 de PUL-A (`df323ad..22878b3`)** — superficie
  SEC-5/SEC-6: guardia de tabs del Makefile en CI, vet cross-Windows
  ampliado a todo el módulo.
- **`check_makefile_tabs.py`: LIMPIO** — solo stdlib, sin
  subprocess/eval/red, self-test bidireccional 5/5 verificado por mí,
  semántica GNU make fiel (asignaciones con `:` vs cabeceras de regla,
  continuaciones `\` exentas, comentarios/blank sin estado).
- **`ci.yml`: saneador, sin superficie nueva** — cero acciones
  externas nuevas (nada que re-fijar por SHA), permisos intactos;
  `vet ./...` estrictamente más fuerte (type-chequea `_test.go` bajo
  GOOS=windows).
- **Verificación con ejecución real** (python3 y make sí hay en este
  sandbox): `63fa077` ancestro de main ✓; MI Makefile heredado roto —
  62 defectos en mi árbol (62 marcadas + 1 continuación exenta = las
  63 reparadas: reconcilia y valida la exención por diseño) ✓;
  Makefile reparado OK ✓; `make -n build` parsea ✓. Evidencia:
  `scripts/pula-cross/` (fuera del repo).
- **Para quien fusione:** merge-tree de mi punta vs PUL-A limpio — el
  Makefile toma su versión reparada automáticamente; el conflicto
  único sigue siendo `scenrun_test.go` con seguridad-a (receta en mi
  ronda 10).
- Informe: ronda_2026-10-06_07h43_B.md. Sin changelog (verificación).
  PARADA; puerta de reapertura: informe ronda 13 de seguridad-a,
  AD-6, AD-3/AD-4 (SEC-9), fusiones a main.

## Ronda 12 (2026-10-06, 08h16 UTC, verificación + 2 fixes de convergencia)

- **SEG-A fix `decodeText` (primer crasher real del fuzzing):
  CORRECTO** — verificado por lectura independiente: bucle con
  terminación garantizada (cada iteración consume ≥2 bytes), traza del
  crasher `fffefffe30` produce `"0"` limpio, cadena mixta UTF-8→UTF-16
  cubierta, semillas de regresión completas, 2,3 M re-fuzz limpio.
  Fuzzing: 24/24 objetivos con sesión viva. Su revisión CSP coincide
  con mi ronda 9; mis hallazgos de IMP-A quedan con doble respaldo.
- **Mis delegaciones cerradas por PUL-A (ronda 12), verificadas:**
  punto 5 (--ignore-scripts en el harness, con justificación correcta
  y 34/34 DOM local) y punto 3 (fuzzing nocturno ya existía en
  bench-nightly desde su ronda 5 — mi ítem era stale, cerrado).
- **IMP-B: lockfile del tooling revisado** — v3, 70 paquetes, todo
  registry.npmjs.org; única hasInstallScript = esbuild (ver abajo).
  Delta de export-menu.tsx = solo aria-label; el CSV de servidor usa
  el escape del motor — sin regresión en mi guardia CSV.
- **FIX Mío a04379b — Makefile:** adopto el reparo de PUL-A (tabs,
  vet ./..., guardia theme, mis líneas ya tabuladas) + añado
  --ignore-scripts a las 4 líneas npm del harness (paridad con su
  ci.yml). Guardia de tabs 0 defectos; make -n ci parsea. Para el
  fusionador: conflicto con PUL-A = 3 hunks npm; tomar mi versión
  (= suya + flag) reproduce mi fichero exacto (verificado).
- **FIX Mío 3046716 — guardia SEC-6:** mecanismo de excepción de
  install-script REVISADA y fail-closed (entradas exactas
  name@version con la razón en el código; unresolvable = marcado;
  trustedDependencies sin excepciones; bump de versión re-dispara).
  fail-before/pass-after demostrado contra el lockfile de IMP-B:
  guardia vieja exit 1 → nueva exit 0; self-test 5+4.
- Informe: ronda_2026-10-06_08h16_B.md. Sin changelog (los dos fixes
  son de convergencia interna del carril, no visibles al usuario
  final; el fusionador decide si el Makefile/guard merecen entrada
  al converger). PARADA; puerta: fusiones a main (recetas listas),
  AD-6, AD-3/AD-4 (SEC-9), observaciones CSP no-bug de PUL-B.

## Ronda 13 (2026-10-06, 09h18 UTC, verificación)

- **IMP-A `4a445aa`: mis 2 hallazgos confirmados, CIERRE VERIFICADO**
  (diff + test, no el informe): score de postura servido
  (`out.Score = &score`; test guarda 87 y exige 87 en el wire, sin
  red) y lecturas bajo cerrojo (`adConnector()` en los 4 handlers +
  captura pre-Unlock de los 6 campos restantes en `statsSnapshot`).
  SEG-A puede retirar su «novena espera» — su fix aterrizó tras su
  ronda 15.
- **AD-6/SET-1 (`877dff5`): auditoría LIMPIO.** SEC-2 completo
  (GET sin secreto, buffer a cero, auditoría por nombres de campo,
  `redact.EndpointLabel`), transporte LDAP único (`openLDAP`: solo CA
  de la organización, ServerName fijado, TLS 1.2 de suelo, sin
  InsecureSkipVerify), validación del cargador antes de disco, commit
  atómico 0600, drift 409 por sha256 con re-baseline propio, hot-swap
  async con registro inmutable, decode estricto (DisallowUnknownFields,
  8 KiB). **INFORMATIVA para IMP-B (pantalla del botón):** el test sin
  password en el cuerpo envía la credencial ALMACENADA al servidor que
  el cuerpo nombre (diseño correcto para migrar de DC; pedir
  confirmación en la UI si el operador cambió server/port). Horario
  laboral validado pero sin consumidor hoy — **SEC-9 sigue BLOQUEADA**
  (AD-3/AD-4 esperan WEF).
- **Supresiones condicionales + known-software: LIMPIO.** Operador
  cerrado del motor (desconocido = carga ruidosa), aggregates jamás
  silenciados por entradas condicionales (fallo hacia VISIBILIDAD),
  caps de filete; eventos enriquecidos NUNCA se borran (solo
  degradaciones honestas + contador), YAML malformado = FATAL al
  arranque. Recomendación: sha256 en las entradas sensibles de
  known-software.
- **Pre-flight ronda 13 (método PUL-A adoptado) contra las 5 tips:**
  IMP-A limpio + guardia OK + ci.yml idéntico; **IMP-B y PUL-B:
  fusión LIMPIA pero Makefile fusionado ROJO (7 recetas con espacios,
  l. 86-88/93-96, y sin --ignore-scripts)** — el caso silencioso: el
  merge-base (main) y mi fichero no contienen los targets
  console-a11y/lighthouse, el 3-way toma el bloque con espacios tal
  cual. Receta para quien fusione IMP-B/PUL-B: guardia sobre el
  Makefile FUSIONADO obligatoria + tomar el bloque reparado + 2 flags
  npm. PUL-A retira su observación sobre mi carril (su §2a: las líneas
  con espacios eran del merge-base; mi análisis de ronda 10-12
  quedaba validado). Conflicto con PUL-A = los mismos 3 hunks npm de
  mi ronda 12 (receta vigente, re-verificada hunk a hunk); conflicto
  con SEG-A = el `scenrun_test.go` conocido (su ronda 15 no tocó el
  fichero; receta «conservar ambos» vigente).
- **PUL-B source maps en producción: LIMPIO** — mismo origen tras la
  puerta de credencial del proxy (matcher `/:path*` verificado por mí
  en ronda 9), solo DevTools los descarga, el bundle no cambia.
- **IMP-B i18n: LIMPIO** (sin innerHTML/dangerouslySetInnerHTML/eval
  en el delta). Los 2 hallazgos de SEG-A r5 sobre IMP-B siguen
  vigentes (verificado `noise-view.tsx:282` con `host: ''` en
  `28d6f9e` — octavo aviso).
- Informe: ronda_2026-10-06_09h18_B.md. Sin changelog (verificación).
  PARADA; puerta: fusiones a main (receta del Makefile silencioso
  lista), pantalla AD-6 de IMP-B, verificación SEC-5/SEC-9 que la
  fusión habilite.

## Ronda 14 (2026-10-06, 09h29 UTC, verificación + corrección)

- **SEG-A r16 (MEDIA, hot-swap AD-6): CONFIRMADO — CORRECCIÓN
  PÚBLICA a mi ronda 13 §2.** Los comentarios de `adReloadAsync` y
  `run.go` afirman serialización por `adWriteMu` y es falso: la
  callback corre en la goroutine fuera del span del handler (defer
  Unlock ya soltó). Verificado estructuralmente en `run.go` l.613-631
  (`current` sin sincronizar) + repro `-race` y 7/20 lost-updates de
  SEG-A. Consecuencias: carrera real, conector publicado ≠ fichero
  comprometido (ángulo de seguridad: declarado≠sirvido), conector
  huérfano que nunca recibe Stop. Fix propuesto correcto (cerrojo
  durante la callback); dueño IMP-A. Lección reiterada: mi checklist
  cubre exposición/credenciales; la disciplina concurrente de SEG-A
  cubre lo demás — el cruce es parte del control.
- **known-software anti-forja: VERIFICADO por lectura propia** —
  `enrich.Apply` borra las claves engine-owned (incluida
  `known_software`) del evento ANTES de aplicar las suyas; un sensor
  no puede cegar las reglas opt-out forjando enriquecimiento.
- **IMP-B ronda 10 (i18n incidentes): LIMPIO** (sin
  innerHTML/dangerouslySetInnerHTML/eval en el delta; diccionarios
  constantes). AD-6/SET-1 desbloqueada para su ronda 11: mi
  observación informativa del botón (confirmar envío de credencial
  almacenada si cambió server/port) + exigir fix del hot-swap de
  IMP-A ANTES de que la pantalla estimule PUTs solapados.
- Matriz de fusión sin cambios (precheck re-ejecutado): CLEAN vs
  main/IMP-A/IMP-B/PUL-B; 2 conflictos con receta (PUL-A Makefile,
  SEG-A scenrun_test.go). Tercera confirmación independiente del
  Makefile silencioso (SEG-A r16).
- Informe: ronda_2026-10-06_09h29_B.md. Sin changelog.
  PARADA; puerta: fix hot-swap (IMP-A), pantalla AD-6 (IMP-B r11),
  fusiones a main. Push SIGUE bloqueado sin credencial — 4 commits
  locales esperan (6d0b61f, 8af7c2b, 76e9de1, docs r14).

## Ronda 15 (2026-10-06, 09h51 UTC, verificación)

- **Push de las rondas 13-14 SALIÓ** (`b670e5f..abd812f`, credencial
  del responsable solo en memoria, verificado con ls-remote).
- **Pantalla AD-6/SET-1 de IMP-B (`2c47271`): LIMPIA salvo 1 BAJA.**
  Contraseña write-only también en el cliente (solo estado React,
  type=password + autocomplete new-password, limpiada tras guardar/
  cargar, jamás localStorage ni URL); payload solo con campos dirty
  (numéricos inválidos bloquean el envío; password solo si se
  tecleó); fases 403/501 honestas con frase del motor verbatim;
  reload_pending/last_reload_error mostrados; doble-submit
  deshabilitado en la UI (reduce, NO cierra la carrera del hot-swap
  — el fix del motor sigue siendo el requisito).
- **BAJA (fix en runProbe ~l.385, para IMP-B):** «Probar conexión»
  SIN confirmación — server/port editado + password vacío ⇒ el
  motor envía la credencial ALMACENADA al servidor del formulario
  en silencio (diseño correcto para migrar de DC, tras -api-write,
  pero la UI no lo dice). Guardia propuesta: confirmación explícita
  cuando cambie server/port, no hay password y hay sobre almacenado.
  Su informe declara el comportamiento sin abordar la implicación.
- Matriz de fusión sin cambios. Puertas: fix hot-swap (IMP-A,
  MEDIA), guardia del botón (IMP-B, BAJA), Makefile a main,
  hallazgos r5 de IMP-B, SEC-5/SEC-9 con la fusión.
- Informe: ronda_2026-10-06_09h51_B.md. Sin changelog. PARADA.

## Ronda 16 (2026-10-06, 10h28 UTC, verificación)

- **Delta:** SEG-A `5678f6b..4d23194` (su ronda 17): TABs del
  Makefile reparados, `--ignore-scripts` en targets npm, informe con
  2 hallazgos BAJOS nuevos sobre SET-1.
- **BAJA-1 CONFIRMADA (contraseña recortada, para IMP-B):** el
  cliente envía `password?.trim()` (`draftPayload`; rutas runProbe
  l.391 y runSave l.410) pero el motor almacena VERBATIM
  (`pw := *in.Password` → sobre SEC-2) y la sonda usa verbatim.
  Contraseñas de bind con espacios —legales en AD— quedan mutadas
  para siempre. Fix: enviar tal cual, trim solo para decidir si
  viaja. Mi ronda 15 no lo vio: el checklist de exposición no cubre
  el contrato de normalización — lección registrada.
- **BAJA-2 CONFIRMADA (presupuesto de sonda, para IMP-B):** cliente
  aborta a 30 s (`AbortSignal.timeout(30_000)` en engine-writes
  l.28) vs motor 45 s (`context.WithTimeout(r.Context(), 45s)`):
  el aborto del fetch mata el contexto del motor ⇒ 30-45 s
  inalcanzable vía consola. Fix: 50 s en el cliente.
- **Tabla Makefile de SEG-A verificada exacta:** main ROJO (66
  líneas espacios), mi carril OK (reparo `a04379b`), su reparación
  OK. Paridad `--ignore-scripts` byte a byte (4 líneas npm idénticas).
- **CORRECCIÓN a los dos registros de conflictos:** con el Makefile
  reescrito de SEG-A, la fusión conmigo confligte en Makefile (2
  hunks triviales: alcance del vet windows, línea del check de
  tema) — su §8 decía «LIMPIO contra todos» y mi matriz registraba
  solo scenrun_test.go (receta nº 2 vigente). PUL-A: único
  conflicto real sigue siendo su Makefile de 3 hunks npm (receta
  nº 1); el .py auto-fusiona limpio. IMP-B/PUL-B: CLEAN con guardia
  ROJA en las mismas 7 líneas (4.ª confirmación del caso
  silencioso). main/IMP-A: CLEAN + guardia verde.
- Puertas: hot-swap AD-6 (MEDIA, IMP-A, sin movimiento), TRES BAJOS
  en SET-1 para IMP-B (botón sin confirmación + los 2 de SEG-A),
  Makefile roto en main (6 de 7 carriles estaban rotos en solitario;
  lo reparan las fusiones de SEG-A/mí), SEC-9 bloqueado, SEC-5
  cerrado.
- Informe: ronda_2026-10-06_10h28_B.md. Sin changelog. PARADA.

## Ronda 17 (2026-10-06, 12h05 UTC, verificación)

- **Delta:** IMP-A `293be1d..60a63a3` — doctor de known-software
  (mismo parser del motor), cuotas de memoria por equipo v1.1
  (threshold/beacon/anillos), informe + plan siguiente.
- **Cuotas: LIMPIO salvo 1 BAJA documental.** Techo de admisión
  nunca expulsión; recuperación por purga de evidencia muerta
  antes del rechazo; saturación global conserva la conducta
  auditada (weakest-first); tallies por host acotados a 64 con
  totales siempre; top-8 determinista; métricas SIN etiquetas de
  host (cardinalidad acotada por construcción — sin label-
  bombing); anillos atribuyen el host del registro antes de
  recortar; correlator sin cuota justificado por construcción
  (1 estado por (secuencia, host), 8192 cap). Baterías cotejadas:
  `-race -count=5` incluyó los paquetes del delta.
- **BAJA documental (para IMP-A):** la propiedad depende del
  binding de identidades — con bindings activos la ingesta refusa
  hosts fuera del binding (l.422-429); con token compartido
  `Host` es auto-declarado y un feed hostil puede quemar la cuota
  de otro equipo (acotada, visible en quota_top_hosts). Fix: una
  frase en OPERATIONS.md (la sección nueva promete la propiedad
  sin declarar el requisito).
- **Doctor known-software: LIMPIO** (paridad por construcción con
  `known.Parse`; 5 formas honestas; sin superficie nueva).
- **Matriz sin cambios** (5.ª confirmación del caso silencioso
  IMP-B/PUL-B; recetas nº 1 y nº 2 vigentes; IMP-A `60a63a3`
  CLEAN + guardia verde).
- **Hot-swap MEDIA: sigue abierto**, sin tocar esta ronda; el plan
  de IMP-A anuncia el fix con el diseño correcto (swap síncrono
  bajo `adWriteMu`) — verificación prevista registrada (§4 del
  informe).
- Puertas: hot-swap (IMP-A, MEDIA — fix anunciado), guardia del
  botón + 2 BAJOS de contrato en SET-1 (IMP-B), frase de
  OPERATIONS.md (IMP-A, BAJA), Makefile roto en main, SEC-9
  bloqueado, SEC-5 cerrado.
- Informe: ronda_2026-10-06_12h05_B.md. Sin changelog. PARADA.

## Ronda 18 (2026-10-06, verificación) — hot-swap AD-6 verificado; Makefile de PUL-B converge

- **Gatillo doble:** IMP-A `60a63a3..48b81f8` (aterriza el fix del
  hot-swap MEDIA anunciado) y PUL-B `744d46a..e2bd3aa`
  (publicación de sus rondas 9-15: TABs + `--ignore-scripts` +
  `--no-save --no-package-lock`).
- **AD-6 hot-swap: LIMPIO.** Los tres puntos de mi plan r17 §4
  verificados en la diff `f2e6378`: swap síncrono DENTRO del
  `adWriteMu` del PUT (`defer Unlock`; orden de publicación ==
  orden de commit por construcción), bookkeeping `current` de
  llamador-único ahora verídico (cambio solo de comentarios en
  `cmd/engine/run.go`; además `adReconfigure` ahora se lee bajo
  `h.mu`), y prueba determinista 8-PUT que replica el bookkeeping
  del engine SIN cerrojo propio (pausa 200µs hace el fail-before
  determinista bajo el async viejo; aserciones: 8×200, swaps
  completos, último publicado == archivo commiteado, cero
  huérfanos). `-race -count=5` afirmado por IMP-A; sandbox sin Go
  → verificación por construcción, anotada. Respuesta del PUT
  reporta swap resuelto (`reload_pending` false +
  `last_reload_*`); el GET concurrente en ventana ve true —
  openapi.yaml lo distingue con exactitud. OPERATIONS.md sin
  mentiras. **Recomendación: SEG-A cierra el gate (dueño).**
- **Makefile PUL-B: convergencia SEG-A adoptada** (TABs, 6/6
  flags, `--no-save --no-package-lock` — la mutación del manifest
  que documenté en r13 queda cortada también en su carril).
  Targets nuevos console-a11y/console-lighthouse con versiones
  pinneadas y `--ignore-scripts`: sin observaciones.
- **Matriz r18:** main/IMP-A CLEAN + guardia verde (4 flags);
  IMP-B CLEAN + guardia ROJA — 6.ª confirmación del caso
  silencioso (se resuelve cuando PUL-B llegue a main); PUL-A
  receta nº 1 sin cambios + `.py` nuevo = ruido informativo
  (comentario, limpio); **PUL-B CONFLICTO NUEVO conmigo (5
  hunks)** — receta: npm×3 y windows vet → tomar PUL-B (superset
  y convergencia SEG-A); línea `check_console_theme.py` → mi
  carril es el único portador (conservar la mía, aditiva;
  señalar a PUL-B/SEG-A); `alert-actions.tsx` auto-merge limpio.
  SEG-A receta nº 2 sin cambios.
- Puertas: AD-6 (MEDIA) verificada por SEG-B → cierre pendiente
  del dueño; 3 BAJOS de SET-1 (IMP-B); frase de OPERATIONS.md
  (IMP-A); Makefile a main; SEC-9 bloqueado; SEC-5 cerrado.
- Informe: ronda_2026-10-06_10h55_B.md. Sin changelog. PARADA.

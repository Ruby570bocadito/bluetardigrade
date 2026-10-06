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

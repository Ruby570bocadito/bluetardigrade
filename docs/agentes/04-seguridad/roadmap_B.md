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

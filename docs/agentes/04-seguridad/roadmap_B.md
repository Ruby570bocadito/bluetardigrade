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

## Siguientes rondas (orden propuesto, tras la ronda 2)

1. Verificar el fix del PR #16 cuando aterrice: el smoke debe pasar con
el count real (114 reglas tras el pack o el valor que fije el guard de
inventario) y no reintroducirse un número hardcodeado.
2. Cuando el responsable fusione mi ronda 1 a main, confirmar que el
job `deps-audit` corre en main y en cada push de rama (ahora sin
filtro), y responder a sus hallazgos si los hay.
3. SEC-1: extender el modelo a las superficies de prevención §6.1–6.3
cuando el responsable las desbloquee; y §1.3 instalador (Authenticode,
GPO/Intune) cuando Implementación A lo publique.
4. Revisar los PRs de Dependabot que vengan (mantener la política:
bump + CI verde; los de seguridad, urgentes).
5. Conector AD (AD-1): cuando exista código, el escape RFC 4515 y el
LDAPS obligatorio del modelo §3 pasan de requisito a verificación.

# TODO — bluetardigrade

Lista de trabajo práctica: solo lo que falta. Lo entregado está en el
[CHANGELOG](CHANGELOG.md) y en el historial de git; la dirección a largo
plazo, en [docs/ROADMAP.md](docs/ROADMAP.md); lo que hay que probar en un
Windows real, en [docs/PRUEBAS-PENDIENTES.md](docs/PRUEBAS-PENDIENTES.md); el
diseño detallado de cada bloque, en [docs/PLAN-DETALLADO.md](docs/PLAN-DETALLADO.md).

Al terminar algo, se borra de aquí y queda en el CHANGELOG. Un PR pequeño por
punto, con el CI en verde (incluidos los jobs de Windows) antes de fusionar.

Última revisión: 20 de octubre de 2026.

---

## Decisiones vigentes

- La rama `100agentes` se descarta (PR #23 cerrado sin fusionar).
- *Observe-only* pasa a ser una opción de instalación: la respuesta ampliada
  se elige al instalar y está apagada por defecto.
- `sf-start` arranca motor, consola, hub y el servicio del sensor ETW;
  `sf-stop` lo para todo.
- Siguen en pie:
  - Active Directory se lee; cualquier acción sobre AD sería opt-in, como la
    respuesta ampliada.
  - Ninguna acción en los equipos es «ejecutar un comando»: solo un conjunto
    cerrado de acciones, firmadas, auditadas y con lista de protegidos.
  - La validación de detecciones usa telemetría sintética e inerte.
  - No se descargan feeds ni herramientas de terceros automáticamente.

## F0 — Higiene del repositorio

- [ ] Abrir el PR de la rama `claude/trusting-fermat-ffz98u` (Go 1.26.10,
  Next 16.3.8, oráculo del fuzz, ARCHITECTURE, limpieza, roadmap,
  `sf-start`/`sf-stop`/`sf-status`, instalador silencioso) y fusionarlo con el
  CI en verde, incluidos los jobs de Windows.
- [ ] Borrar ramas en GitHub (la sesión de Claude no puede borrar ramas
  ajenas): `100agentes`, `audit/mejoras-2026-10-08` (cierra el PR #22) e
  `integracion/rondas-2-3`.
- [ ] Fusionar o cerrar los PRs de Dependabot #24–#27 cuando el CI esté verde.
- [ ] Tags sueltos `console-v1` y `v0.1.0`: no tienen release ni referencias;
  decidir si se borran. `v1.0.0-rc1` se queda.
- [ ] En «About» del repositorio:
  - descripción: *Self-hosted SOC toolkit for Windows endpoints: Rust ETW
    sensor, single-binary Go detection engine (114 YAML rules mapped to MITRE
    ATT&CK, kill-chain correlation, beaconing, forensic bundles) and a live web
    console for triage and response.*
  - topics: `soc` `edr` `threat-detection` `blue-team` `detection-engineering`
    `mitre-attack` `etw` `sysmon` `windows-security` `incident-response`
    `threat-hunting` `dfir` `siem` `sigma-rules` `cybersecurity`
    `security-tools` `self-hosted` `golang` `rust` `nextjs`.
- [ ] Settings → General → Pull Requests: activar «Automatically delete head
  branches».

## F1 — Uso diario

`sf-start`, `sf-stop`, `sf-status` y el instalador silencioso ya están en la
rama de F0; las acciones en lote sobre alertas ya existían.

- [ ] Probar en Windows real `sf-start` / `sf-stop` / `sf-stop -KeepSensor` /
  `sf-status`: UAC solo cuando el sensor cambia de estado y el sensor parado
  antes que el motor.
- [ ] Probar el instalador silencioso: salida en una pantalla, log en
  `%TEMP%\bluetardigrade-install.log`, `-ShowBuildOutput` y un fallo de
  compilación que siga mostrando el motivo.

## F2 — Acceso

Base de todo lo que abre lectura o escritura sensible (F3). Diseño de sesiones
y cuentas: [PLAN-DETALLADO](docs/PLAN-DETALLADO.md).

- [ ] **Login propio** (TEAM-1). Sustituye el diálogo Basic del navegador sobre
  las cuentas con rol que ya existen (lector, analista, administrador):
  - pantalla de inicio de sesión;
  - sesión con cookie `HttpOnly`, `Secure` y `SameSite=Strict`, caducidad por
    inactividad y cierre de sesión;
  - bloqueo temporal tras varios fallos;
  - protección de sesión (SEC-4): CSRF, fijación de sesión, `frame-ancestors`
    y HSTS detrás de HTTPS.
- [ ] **MFA opcional por TOTP**, con códigos de recuperación y obligatorio por
  rol si se configura. Sin servicios externos.
- [ ] **Cuentas desde la consola** (TEAM-2): alta, baja, rol, deshabilitar y
  restablecer contraseña, con cambio obligatorio en el primer acceso. Solo
  administradores y auditado. Hoy se edita a mano `CONSOLE_USERS_FILE`.
- [ ] **ACL de máquinas y servicios:**
  - grupos y etiquetas de equipos (sede, departamento, OU de AD, servidores o
    puestos);
  - permisos por grupo: qué equipos ve cada operador y qué puede hacer en ellos;
  - por concretar: auditar en los endpoints los servicios de Windows con
    permisos débiles (escritura para usuarios no administradores).
- [ ] **Login con cuentas del dominio** (AD-7): bind LDAPS con las credenciales
  del usuario y grupos de AD que dan cada rol; las cuentas locales siguen como
  respaldo.

## F3 — Funciones

- [ ] **Asignar alertas** (TEAM-3): responsable en el ciclo de vida del motor,
  vista «Mis alertas», cola sin asignar, reasignación y asignación en lote desde
  la barra de selección.
- [ ] **Respuesta ampliada, opt-in al instalar** (hoy solo `kill_process` en el
  propio servidor del motor). Diseño: [PLAN-DETALLADO §6](docs/PLAN-DETALLADO.md).
  - Opción del instalador, apagada por defecto, y niveles por grupo de equipos:
    observar, recomendar, prevenir en auditoría, prevenir y responder.
  - Acciones cerradas: aislar el equipo (dejando solo la conexión con el
    servidor) y liberarlo, terminar un proceso por PID y hash, cuarentena de un
    fichero por ruta y hash, recoger un paquete forense bajo demanda.
  - Canal del servidor al sensor que hoy no existe: cada orden firmada, con
    caducidad y protección frente a repeticiones.
  - Aprobación por una o dos personas según la política, equipos protegidos
    (los controladores de dominio nunca se aíslan solos), límite de acciones por
    hora e interruptor general que devuelve todo a «observar».
  - Playbooks de respuesta automática solo donde el SOC los active, y simulación
    previa («qué habría pasado en los últimos 30 días»).
- [ ] **YARA:**
  - escaneo en el sensor Rust con `yara-x`: ficheros escritos y bajo demanda;
    memoria después;
  - reglas guardadas en el motor y distribuidas firmadas a los sensores;
  - en la consola: ver, añadir y eliminar reglas con validación al compilar,
    solo administradores y con auditoría;
  - la web ya anuncia «YARA memory scanning»: alinearla con lo que se entregue.
- [ ] **Editor de reglas en la consola** (IDEA-5): reglas YAML con validación,
  el probador que ya existe e historial de versiones; importar Sigma desde la
  consola (hoy solo por CLI).
- [ ] **Consulta de la base de datos:** solo lectura (la evidencia es
  append-only), límites de tiempo y filas, solo administradores y cada consulta
  auditada. Puede apoyarse en el lenguaje de búsqueda (IDEA-4: `campo:valor`,
  `AND`/`OR`/`NOT`, rangos).
- [ ] **Active Directory:**
  - recibir el registro de Seguridad de controladores de dominio y servidores
    por WEF, sin instalarles nada, con su guía de suscripción;
  - detecciones: rociado de contraseñas (4625), Kerberoasting (4769 con RC4),
    DCSync (4662), altas en grupos privilegiados (4728/4732/4756), servicios
    nuevos (7045);
  - AD-3 inicios de sesión (fuera de horario, cuentas privilegiadas en puestos,
    primer inicio en un equipo) y AD-4 cambios (cuentas, grupos, GPO), con
    retención configurable y acceso por rol (RGPD).

## F4 — Diferenciadores

- [ ] **ML beta para el triaje:** modelo local y explicable que ordena las
  alertas por probabilidad de ruido aprendiendo de los veredictos de triaje,
  con la razón visible, detrás de `-ml-beta`. No sustituye a las reglas.
  Necesita historial de triaje (va después de asignar alertas).
- [ ] **Ediciones:** perfiles de instalación sobre un único código:
  - `lite`: motor, sensor y CLI, sin Node ni Bun;
  - `full`: consola, hub IA, SQLite, AD y SIEM.

## F5 — Escaparate

En este orden, para no rehacer capturas:

- [ ] Rediseño del dashboard a un aspecto más profesional, con el kit de
  componentes compartidos (POL-7: botón, campo, tabla, pestañas, insignia,
  diálogo) en todas las vistas.
- [ ] Terminar los idiomas (IDEA-10): el panel, el directorio, la validación y
  los ajustes siguen en español con la consola en inglés.
- [ ] Capturas de uso real en una VM de laboratorio, sin nombres de equipo,
  usuarios, SIDs ni dominios personales.
- [ ] Vídeo para el README.
- [ ] README actualizado con las imágenes nuevas.

## Pruebas en un Windows real

Detalle en [docs/PRUEBAS-PENDIENTES.md](docs/PRUEBAS-PENDIENTES.md).

- [ ] Prueba de uso de 24–48 horas con el sensor como servicio: memoria,
  reconexiones y pérdidas.
- [ ] Secciones 4 (segundo equipo), 7 (cuentas), 10 (sensor como servicio) y
  11 (alta de equipos) de la hoja de pruebas.
- [ ] Parar el motor un rato y volver a arrancar: el volcado del atasco no debe
  descontrolar el flujo, el grafo ni el riesgo (arreglo del PR #28).
- [ ] Suspensión del portátil: cerrar y abrir la tapa sin falsos «sin señal».
- [ ] Spool con caídas largas del motor (horas) y reinicios del equipo a mitad.
- [ ] CPU y memoria durante una semana, también con compilaciones y
  actualizaciones de Windows.
- [ ] Con todo lo anterior: entrada `[v1.0.0]` del CHANGELOG, insignia del
  README y etiqueta `v1.0.0`.

## Backlog

### Detección y ruido

- [ ] Agrupar arranques repetidos en el sensor (caso Lenovo Vantage, 43 % de los
  arranques en reposo): el primero completo y después un resumen con
  `repeat_count`.
- [ ] Separar la actividad de herramientas de administración en los análisis
  (etiquetar por árbol de procesos).
- [ ] Tasa de falsos positivos por regla en el informe de ruido, con datos de
  varios días.
- [ ] WPAD/LLMNR: consultas `wpad` respondidas por un equipo de la red local que
  no es el servidor DNS (medir antes el patrón normal).
- [ ] Agrupar en la cola la misma alerta en varios equipos (una fila con N
  equipos).

### Sensor

- [ ] Registro, raíz `?`: resolverla con el usuario del proceso (`HKU\<SID>`) o
  por las claves vistas bajo esa base.
- [ ] Registro, valor escrito: enviar `registry.value_data` para que reglas y
  supresiones puedan exigirlo (caso real: Chrome y Copilot en la clave Run).
- [ ] El latido informa de los eventos ETW perdidos (EventsLost, BuffersLost) y
  de los descartes del hilo de hashes.
- [ ] Aviso en Equipos de sensores desactualizados (la versión ya va en el
  latido).
- [ ] Credencial del sensor (`ingest.token`) cifrada con DPAPI (SEC-2).

### Forense

- [ ] Vista «Forense» en la barra lateral: todos los paquetes, búsqueda,
  filtros y enlaces a alerta e incidente.
- [ ] Árbol de procesos del paquete, con el componente de Equipos.
- [ ] Paquetes dentro del informe imprimible del incidente.
- [ ] Cadena de custodia: SHA-256 de cada paquete al congelarlo, registrado
  aparte y comprobado al exportar.
- [ ] Más contexto: firmante de los ejecutables, conexiones del proceso, claves
  de registro tocadas y ventana configurable.
- [ ] Retención configurable (`-forensic-retention`) en lugar del tope de 256.

### Despliegue

- [ ] Paquete instalador desde la consola (MSI o EXE) con servidor, CA y token
  de alta incluidos, firmado con Authenticode, visible en «Aplicaciones», y guía
  de despliegue por GPO e Intune.
- [ ] Motor, hub y consola como servicios en Windows Server, con HTTPS en la
  consola para entrar desde otros equipos.

### Plataforma

- [ ] Ajustes (SET-1): solo la sección de AD escribe; faltan general, ingesta,
  integraciones, notificaciones y cuentas.
- [ ] Copia de seguridad y restauración de `data/` y la configuración (SET-2).
- [ ] Informes programados con retención y envío opcional (REP-2) y página
  «Descargas» (REP-3).
- [ ] Gráficas: tendencias frente al periodo anterior (VIZ-4) y mapa de la flota
  por sede u OU (VIZ-5).
- [ ] Notificaciones con reglas de enrutado y silencios (IDEA-1); SLA de triaje
  y escalado (IDEA-2).
- [ ] Criticidad y propietario de cada equipo en el riesgo y la cola (IDEA-6).
- [ ] Software instalado y parches, solo lectura (IDEA-7); línea base por
  usuario (IDEA-8).
- [ ] Claves de API por integración con alcance y caducidad (IDEA-9).
- [ ] Tablas grandes: paginación en el servidor y listas virtualizadas (IDEA-12).
- [ ] Equipo SOC: quién está trabajando y traspaso de turno (TEAM-4), feed de
  actividad (TEAM-5) y métricas del SOC (TEAM-6).
- [ ] Memoria de la consola (node, 196 MB) con la consola abierta todo el día.

### Calidad

- [ ] Dividir ficheros grandes sin cambiar comportamiento (POL-1):
  `internal/api/api.go`, `cmd/engine/run.go`, `sensor/src/collector.rs`.
- [ ] Logs estructurados con `log/slog` en el motor (POL-2).
- [ ] Perfiles `pprof` del camino caliente en el benchmark nocturno (POL-3).
- [ ] OPERATIONS por capítulos y referencia de la API generada desde OpenAPI
  (POL-5).
- [ ] Release con SBOM (CycloneDX) y el sensor firmado entre los artefactos
  (POL-6).
- [ ] Entradas (SEC-3): rutas de descarga sin traversal, URLs de integraciones
  validadas y ningún `dangerouslySetInnerHTML` con datos de eventos.
- [ ] Cadena de suministro (SEC-6): auditar los componentes de terceros copiados
  en la consola.
- [ ] Privacidad (SEC-9): minimizar datos personales en inicios de sesión y
  líneas de tiempo, retención configurable y auditoría de quién consulta la
  ficha de un usuario.
- [ ] Informe de la prueba de uso (`sf-engine report soak`) y notas de
  limitaciones conocidas de la v1.0.

### Escala y varios motores

Diseño: [PLAN-DETALLADO §4 y §7](docs/PLAN-DETALLADO.md).

- [ ] Fase A: límite de eventos por segundo por sensor (con contador en el
  latido) y simulador de flota de 1.000 a 10.000 sensores en el CI nocturno.
- [ ] Fase B: pasarelas de ingesta sin estado, trabajadores de detección por
  equipo, correlación central, PostgreSQL para alertas e inventario y un almacén
  columnar para eventos.
- [ ] Fase C: vista de equipos por grupos con salud agregada, configuración de
  sensores por grupo (solo ajustes declarativos y firmados) y multi-cliente.
- [ ] Fase D: cola priorizada por riesgo y criticidad, incidentes automáticos
  por campaña, integración con Jira o ServiceNow.
- [ ] Varios tardígrados: identidad y alta de nodos, federación por sedes,
  configuración compartida y correlación entre nodos.
- [ ] Detección avanzada (ROADMAP H1): carga de DLL y drivers, firma de
  binarios, inyección real y selección curada de reglas Sigma.

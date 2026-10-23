# TODO — bluetardigrade

Lista de trabajo práctica: solo lo que falta. Lo entregado está en el
[CHANGELOG](CHANGELOG.md) y en el historial de git; la dirección a largo
plazo, en [docs/ROADMAP.md](docs/ROADMAP.md); lo que hay que probar en un
Windows real, en [docs/PRUEBAS-PENDIENTES.md](docs/PRUEBAS-PENDIENTES.md); el
diseño detallado de cada bloque, en [docs/PLAN-DETALLADO.md](docs/PLAN-DETALLADO.md).

Al terminar algo, se borra de aquí y queda en el CHANGELOG. Un PR pequeño por
punto, con el CI en verde (incluidos los jobs de Windows) antes de fusionar.

Última revisión: 21 de octubre de 2026 (con lo pedido tras las pruebas).

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

- [ ] Borrar ramas en GitHub (los agentes no pueden borrar ramas
  ajenas): `100agentes`, `audit/mejoras-2026-10-08` (cierra el PR #22) e
  `integracion/rondas-2-3`; más las ramas v1 ya fusionadas (`agent/*`,
  `console/*`, `claude/trusting-fermat-ffz98u`).
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

`sf-start`, `sf-stop`, `sf-status` y el instalador silencioso ya están en
`main` (PR #29); las acciones en lote sobre alertas ya existían.

- [ ] Probar en Windows real `sf-start` / `sf-stop` / `sf-stop -KeepSensor` /
  `sf-status`: UAC solo cuando el sensor cambia de estado y el sensor parado
  antes que el motor.
- [ ] Probar el instalador silencioso: salida en una pantalla, log en
  `%TEMP%\bluetardigrade-install.log`, `-ShowBuildOutput` y un fallo de
  compilación que siga mostrando el motivo.

## F2 — Acceso

Base de todo lo que abre lectura o escritura sensible (F3). Diseño de sesiones
y cuentas: [OPERATIONS](docs/OPERATIONS.md#console-accounts-roles-and-audit).

- [ ] Probar en Windows real el inicio de sesión y la verificación en dos
  pasos (sección 7 de PRUEBAS-PENDIENTES): primera cuenta desde `sf-start`,
  `sf-console -AddUser` y `-RemoveUser`, caducidad al cambiar la contraseña,
  activar la verificación con una app real, código de recuperación,
  `-RequireMfa` y `-ResetMfa`, y las cuentas desde Ajustes → Cuentas (crear,
  contraseña temporal, deshabilitar) y «Cambiar contraseña».
- [ ] **ACL de máquinas y servicios.** Ya existen los grupos de equipos
  (Ajustes → Grupos) y los permisos por grupo: una cuenta con grupos solo ve
  y toca sus equipos, filtrado en el motor; sin grupos ve todo; un incidente
  solo lo ve quien tiene todos sus equipos; el analista IA no está disponible
  para cuentas con grupos. Falta:
  - probar grupos y permisos en Windows real (secciones 7b y 7c de
    PRUEBAS-PENDIENTES);
  - el analista IA para cuentas con grupos (que el hub lea el motor con el
    alcance de quien pregunta);
  - auditar en los equipos los servicios de Windows con permisos débiles (el
    sensor, solo lectura: DACL del servicio, del ejecutable y rutas sin
    comillas), con alerta y su sección en la ficha del equipo.

## F3 — Funciones

- [ ] **Avisos al correo y al móvil.** *(Entregado: canales editables en
  Ajustes → Avisos externos sin reiniciar el motor, «Enviar prueba», push con
  ntfy y el enlace a la alerta en cada aviso.)* Falta: enrutado y silencios
  en IDEA-1 (Plataforma).
- [ ] **Móvil:** administración reducida desde el teléfono.
  - La consola como aplicación web instalable (PWA), con una vista para
    pantalla pequeña: alertas críticas, reconocer o cerrar, incidentes abiertos
    y estado de los equipos.
  - Emparejar el móvil escaneando un QR que muestra la consola (Ajustes →
    Móvil): sesión propia del dispositivo, con verificación en dos pasos,
    caducidad y revocación desde la consola.
  - Respuesta desde el móvil solo cuando exista la respuesta ampliada, con la
    misma aprobación.
  - Necesita la consola accesible fuera del servidor (HTTPS, o la VPN de la
    empresa): documentar cómo hacerlo sin exponerla a internet.
- [ ] **Reglas de SigmaHQ:** una selección revisada del repositorio SigmaHQ,
  convertida con `sf-engine sigma` e incluida en el repositorio (licencia DRL
  1.1, con la atribución que pide).
  - Cada regla con su evidencia sintética de disparo y de silencio, como las
    propias, y agrupadas en bloques que se activan por separado.
  - Se actualizan a mano con un script que ejecuta el operador: nada se
    descarga solo.
  - Ampliar el conversor con lo que hoy omite (modificadores de codificación,
    negaciones, paréntesis) según lo que necesiten las reglas elegidas.
- [ ] **Antiphishing.** Hoy los correos `.eml` se importan a mano
  (`sf-collector -source eml`) y se evalúan seis indicadores. Falta:
  - entrada continua: un buzón de reporte leído por IMAP en solo lectura, o una
    carpeta vigilada;
  - más indicadores: Reply-To distinto del remitente, dominio parecido a uno
    propio, resultado SPF/DKIM/DMARC de las cabeceras `Authentication-Results`,
    enlaces acortados y códigos QR en el cuerpo o en imágenes (*quishing*),
    mostrando a dónde lleva cada QR sin abrirlo;
  - un panel propio: correos analizados, indicadores más vistos, remitentes y
    dominios, tendencia, y cada correo con sus alertas.
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
- [ ] **YARA:** (el sensor ya escanea ficheros escritos, bajo demanda y la
  memoria de los procesos con `yara-x`; queda:)
  - reglas guardadas en el motor y distribuidas firmadas a los sensores (el
    sensor ya carga un directorio de reglas con manifiesto y lo recalca cada
    minuto: contrato S-2↔M-3 en docs/agentes);
  - en la consola: ver, añadir y eliminar reglas con validación al compilar,
    solo administradores y con auditoría;
  - la web ya anuncia «YARA memory scanning»: alinearla con lo que se entregue.
- [ ] **Editor de reglas en la consola** (IDEA-5): reglas YAML con validación,
  el probador que ya existe e historial de versiones; importar Sigma desde la
  consola (hoy solo por CLI).
- [ ] **Active Directory:**
  - mejorar la vista Directorio: ficha de usuario y de equipo (grupos, OU,
    último inicio de sesión, estado de la cuenta), árbol de OU, cobertura
    (equipos del dominio sin sensor) y cada hallazgo de la postura explicado:
    riesgo, objetos afectados, cómo corregirlo y su tendencia;
  - recibir el registro de Seguridad de controladores de dominio y servidores
    por WEF, sin instalarles nada, con su guía de suscripción;
    *(detecciones entregadas el 2026-10-22: mitad endpoint en
    `rules/windows/active-directory.yaml` y mitad WEF (M-7, contrato
    `windows.event`) en `rules/windows/wef-security.yaml` con el
    rociado por umbral en `thresholds.yaml`; ver
    `changelog.d/wef-ad-pack.md`.)*
  - AD-3 inicios de sesión (fuera de horario, cuentas privilegiadas en puestos,
    primer inicio en un equipo) y AD-4 cambios (cuentas, grupos, GPO), con
    retención configurable y acceso por rol (RGPD).

## F4 — Diferenciadores

- [ ] **Ediciones:** perfiles de instalación sobre un único código:
  - `lite`: motor, sensor y CLI, sin Node ni Bun;
  - `full`: consola, hub IA, SQLite, AD y SIEM.
- [ ] **Tienda de plugins:** paquetes de reglas, colectores, integraciones de
  aviso y paneles que el administrador instala desde Ajustes.
  - Paquetes firmados, con los permisos que piden a la vista antes de
    instalar, y desinstalación limpia.
  - Nada de código arbitrario dentro del motor: contenido declarativo (reglas,
    paneles) o extensiones en un proceso aparte (o WASM) con una API acotada.
  - Catálogo local o un repositorio que el administrador añade a mano: nada se
    descarga solo.
- [ ] **Machine learning** (lo último):
  - beta para el triaje: modelo local y explicable que ordena las alertas por
    probabilidad de ruido aprendiendo de los veredictos de triaje, con la razón
    visible, detrás de `-ml-beta`. No sustituye a las reglas y necesita
    historial de triaje (va después de asignar alertas);
  - después, anomalías de comportamiento por equipo y usuario (horarios,
    procesos, conexiones) como señal que suma al riesgo, siempre con su
    explicación y nunca como alerta sola.

## F5 — Escaparate

En este orden, para no rehacer capturas:

- [ ] **Rediseño de la consola** a un aspecto más profesional, con el kit de
  componentes compartidos (POL-7: botón, campo, tabla, pestañas, insignia,
  diálogo) en todas las vistas. *(Paleta, superficies, barra lateral y tema
  claro ya siguen el estilo de la página de inicio de sesión; queda lo de
  abajo.)*
  - fuera de Panel y Estado las vistas se ven vacías o poco cuidadas: cabecera
    con los indicadores de cada vista, estados vacíos que digan qué hacer e
    información densa pero ordenada (Alertas, Incidentes, Equipos, Directorio,
    Informes, Detección, Respuesta y Ajustes);
  - adaptable a la pantalla: móvil, portátil, monitor grande y modo NOC, sin
    desbordes ni tablas cortadas;
  - temas a elegir en Ajustes además de claro y oscuro (alto contraste y
    algunas paletas), guardados por cuenta;
  - grafo de entidades más fácil de leer: menos nodos a la vez (agrupar y
    desplegar), etiquetas legibles, leyenda, filtros por tipo y una vista en
    lista como alternativa.
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
- [ ] Inicio de sesión con una cuenta del dominio real (AD-7): un
  usuario de cada grupo mapeado, uno sin grupo, contraseña errónea y el
  DC apagado, con `tools\config\domain-auth.yaml`.
- [ ] Avisos reales desde Ajustes → Avisos externos: un correo por SMTP de
  la empresa, Telegram y ntfy en un móvil (prioridad y toque que abre la
  alerta).
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

### Documentación

- [ ] Guía para añadir equipos, paso a paso y con capturas: requisitos, crear
  el token de alta en la consola, instalar el sensor (a mano, por script o por
  GPO), aprobarlo, comprobarlo en Equipos y qué mirar si no aparece
  (cortafuegos, TLS, hora del equipo, credencial). Hoy está repartido entre
  OPERATIONS y FLOTA-REMOTA.
- [ ] Ordenar la documentación:
  - un índice por perfil: quien instala, quien opera el SOC y quien desarrolla;
  - una guía de la consola vista por vista;
  - cada documento en un solo idioma, con su traducción;
  - OPERATIONS por capítulos (POL-5, en Calidad).

### Calidad

- [ ] Logs estructurados con `log/slog` en el motor (POL-2).
- [ ] OPERATIONS por capítulos y referencia de la API generada desde OpenAPI
  (POL-5).
  *(referencia de la API ya entregada el 2026-10-22: índice generado con
  guard de deriva `scripts/dev-tests/check_api_reference.py`; quedan los
  capítulos de OPERATIONS.)*
- [ ] Release con SBOM (CycloneDX) y el sensor firmado entre los artefactos
  (POL-6).
- [ ] Cadena de suministro (SEC-6): auditar los componentes de terceros copiados
  en la consola.
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
- [ ] **Varios tardígrados: un maestro y nodos.** El maestro guarda la
  configuración, las cuentas, la consola y la correlación global; los nodos
  reciben a los sensores de su sede y detectan.
  - Alta de nodos con certificado propio y aprobación en el maestro; reparto de
    sensores entre nodos.
  - Disponibilidad: si cae un nodo, sus sensores pasan a otro sin perder
    eventos (el spool del sensor aguanta mientras tanto), y un maestro de
    reserva toma el relevo si cae el principal.
  - Federación por sedes, configuración compartida y una sola vista de todo en
    la consola.
- [ ] Objetivo de empresa grande, medido: miles de equipos y de alertas al día
  en el simulador de flota (Fase A), con la consola fluida (paginación en el
  servidor, IDEA-12) y las cifras publicadas en OPERATIONS.
- [ ] Detección avanzada (ROADMAP H1): carga de DLL y drivers, firma de
  binarios e inyección real (las reglas de SigmaHQ están en F3).

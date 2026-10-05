# TODO — bluetardigrade

Lista de trabajo práctica. La dirección a largo plazo está en
[docs/ROADMAP.md](docs/ROADMAP.md); lo ya entregado, en el
[CHANGELOG](CHANGELOG.md); lo que falta probar en un Windows real, en
[docs/PRUEBAS-PENDIENTES.md](docs/PRUEBAS-PENDIENTES.md).

Marca `[x]` al terminar y deja una línea con el commit o la prueba que lo cierra.

**Diseño detallado** de cada punto (cómo funciona por dentro, cuándo está hecho, de qué depende, el
esfuerzo y los riesgos) y orden de los hitos v1.0 → v2.x: [docs/PLAN-DETALLADO.md](docs/PLAN-DETALLADO.md).

---

## Etapa 0 — cerrar la v1.0

- [ ] Abrir el PR de `fix/ci-and-host-guard` contra `main` y fusionarlo con el CI en verde. La rama ya
  está subida y pasa en local todos los pasos del CI de Linux. Lleva:
  - los arreglos del CI del PR #15;
  - el filtro anti DNS rebinding;
  - la suspensión del portátil;
  - la preparación de la `v1.0.0-rc1`.
- [x] Limpiar ramas ya integradas: en GitHub solo quedan `main`, las dos ramas de trabajo y la de
  Dependabot; en local se borraron las tres fusionadas (5 de octubre).
- [ ] Activar en GitHub (Settings → General → Pull Requests) «Automatically delete head branches».
- [x] Unificar versiones: motor, sensor, consola, servicio de la consola y API en `1.0.0`
  (commit `af75c91`).
- [x] Notas de la candidata con las limitaciones conocidas: entrada `[v1.0.0-rc1]` del CHANGELOG.
  Las etiquetas con sufijo (`-rc1`) se publican como pre-release, no como «Latest».
- [ ] Etiquetar `v1.0.0-rc1` en `main` después de fusionar el PR. La etiqueta lanza la release:
  binarios del motor y del colector, sumas de verificación y procedencia firmada.
- [ ] Prueba de uso real de 24–48 horas con el sensor en marcha. En curso desde el 5 de octubre,
  en clase; a las 10:09, unos 1.000 eventos desde las 9:00, 1 alerta conocida y sin huecos. Al
  terminar: analizar alertas, ruido, memoria, eventos perdidos y reconexiones.
- [ ] Secciones pendientes de la hoja de pruebas: 7 (cuentas) y 4 (segundo equipo).
- [ ] `v1.0.0`:
  - entrada `[v1.0.0]` del CHANGELOG con lo que salga de la prueba de uso y de las secciones 7 y 4;
  - insignia del README;
  - etiqueta.

## Mejoras de despliegue (en curso)

### 1. Sensor como servicio de Windows — en curso, rama `feat/sensor-service`

El ETW del kernel exige administrador, pero solo una vez, al instalar.

- [x] El sensor funciona como servicio de Windows. `--service` atiende al gestor de servicios:
  arranca, para y se apaga con el equipo, y cierra sus sesiones ETW al parar.
- [x] `--log <fichero>` para el modo servicio: sin consola, la salida va a un fichero con rotación.
- [x] `--token-file <fichero>`: el token no aparece en la línea de comandos del servicio.
- [x] El sensor manual se niega a arrancar si el servicio ya está en marcha, porque si no le
  quitaría sus sesiones ETW.
- [x] El latido declara cómo corre (`run_mode`: servicio o ventana) y Equipos lo muestra.
- [x] Comando `sf-etw`:
  - `-Install` pide administrador (UAC) una sola vez;
  - copia el binario a `Program Files`, porque un servicio SYSTEM no puede ejecutar algo que el
    usuario pueda modificar;
  - deja los datos en `ProgramData` con permisos solo para SYSTEM y Administradores;
  - configura reinicio automático si falla;
  - además: `-Uninstall`, `-Status` y `-Restart`.
- [x] El desinstalador quita también el servicio.
- [x] Documentación (OPERATIONS) y sección 10 en la hoja de pruebas. FLOTA-REMOTA pasa al punto 3:
  los equipos remotos solo tienen el ejecutable, y el servicio les llegará con el instalador.
- [ ] Prueba real en el portátil: sección 10 de la hoja de pruebas. Se hace al terminar la prueba de la
  jornada.

### 2. Alta de equipos con token de un solo uso y aprobación — hecho, falta la prueba real

Diseño: [PLAN-DETALLADO §1.2](docs/PLAN-DETALLADO.md). Rama `feat/enrollment`.

- [x] El servidor emite tokens de alta (un uso por defecto, hasta 10.000), con caducidad y patrón
  opcional de aprobación automática. Se crean desde la consola (Equipos → «Añadir equipos»).
- [x] El sensor nuevo canjea el token por una identidad propia, ligada a su nombre de equipo
  (`ENROLL <token> <equipo>`). Solo por TLS o desde el propio servidor.
- [x] En Equipos aparece como «pendiente» hasta que un administrador lo aprueba o lo rechaza. Sus
  eventos esperan en el disco del equipo. Las aprobaciones quedan en la auditoría.
- [x] Revocar un equipo: su identidad deja de valer al momento y se corta su conexión abierta.
- [x] Un equipo cuyo nombre ya usa otro sensor nunca entra solo: es una reinstalación o una
  suplantación.
- [x] `sf-etw -Install -EnrollToken`. El lanzador de Windows activa el alta junto con TLS.
- [x] Probado de punta a punta en el laboratorio, con la consola y el motor reales:
  - token creado desde el asistente;
  - el equipo queda pendiente y un segundo uso del token se rechaza;
  - se aprueba y entrega eventos;
  - al revocarlo se corta su conexión.
- [ ] Prueba real en el portátil: sección 11 de la hoja de pruebas, junto con la 10.

### 3. Paquete instalador desde la consola

Diseño: [PLAN-DETALLADO §1.3](docs/PLAN-DETALLADO.md)

- [ ] El asistente genera un instalador (MSI o EXE) con la dirección del servidor, el certificado
  de la CA y un token de alta ya incluidos.
- [ ] Instala el servicio de la mejora 1 y se da de alta solo (mejora 2). Se ve en «Aplicaciones»
  y se desinstala desde ahí.
- [ ] Firmado con Authenticode (`scripts/release/sign-windows.ps1`).
- [ ] Guía de despliegue en el dominio por GPO e Intune.
- Límite a propósito: la consola no ejecuta ni instala nada en los equipos a distancia. El
  software llega por los canales del dominio (GPO, Intune o alguien con administrador).

### 4. Ver el dominio: Windows Event Forwarding y detecciones de AD

Diseño: [PLAN-DETALLADO §1.4](docs/PLAN-DETALLADO.md)

- [ ] El motor recibe el registro de Seguridad reenviado por los controladores de dominio y los
  servidores (WEF), sin instalarles nada.
- [ ] Detecciones de Active Directory:
  - rociado de contraseñas (4625);
  - Kerberoasting (4769 con RC4);
  - DCSync (4662);
  - altas en grupos privilegiados (4728/4732/4756);
  - servicios nuevos (7045).
- [ ] Guía de suscripción WEF.

### 5. Servidor central como servicios

Diseño: [PLAN-DETALLADO §1.5](docs/PLAN-DETALLADO.md)

- [ ] Motor, hub y consola como servicios en Windows Server.
- [ ] HTTPS en la consola, para que los analistas entren desde su equipo con sus cuentas.

## v1.1 — fiabilidad en uso real

Sale de las pruebas en un equipo real (4 y 5 de octubre). Datos de la prueba de la jornada:
- en 27 minutos, 645 eventos, 0 perdidos, 0 rechazados y 0 al spool;
- el 100 % de los procesos llevan ruta y SHA-256, y el 90 % de las consultas DNS llevan su IP;
- recursos: sensor 15 MB, motor 33 MB, consola 196 MB.

### Ruido: que lo normal no ahogue lo importante

Diseño: [PLAN-DETALLADO §2.1–2.4](docs/PLAN-DETALLADO.md)

El caso real es Lenovo Vantage: lanza sus 4 complementos cada minuto, que son el 43 % de los
arranques de proceso de un portátil en reposo. Un SOC no puede guardar ni mirar eso en cada equipo.

- [ ] **Agrupar arranques repetidos en el sensor.** El mismo ejecutable, con el mismo padre,
  comando, usuario y hash, dentro de una ventana (por ejemplo 10 minutos):
  - se envía el primero completo;
  - después, un resumen periódico con `repeat_count`.

  Así no se pierde la primera aparición ni el hash, y lo repetido baja más de un 90 %. Tests con la
  secuencia real de Vantage.
- [ ] **Lista de software conocido por organización** (`known-software.yaml`): ejecutable, ruta,
  hash o firmante.
  - No borra eventos: los marca como conocidos, los saca de la línea base y de las reglas de
    poca confianza, y la consola los atenúa.
  - Recarga en caliente, como las supresiones, con validación y auditoría.
- [ ] **Supresiones con condiciones**, no solo regla y equipo: proceso padre, línea de comandos
  exacta o ruta. Caso real: la regla del portapapeles saltó por un asistente de desarrollo
  (`powershell -NonInteractive -Command "... Get-Clipboard -Raw"`). Se debe poder suprimir ese uso
  concreto sin apagar la regla.
- [ ] **Informe de ruido** en la consola: procesos, dominios y reglas que más eventos o alertas
  generan, por equipo y en toda la flota, para saber qué ajustar.
- [ ] **Separar la actividad de herramientas de administración** en los análisis (en las pruebas,
  mis compilaciones y comprobaciones se mezclaron con el uso real). Etiquetar por árbol de procesos.
- [ ] Revisar las reglas con datos de varios días: tasa de falsos positivos por regla en el informe.

### Sensor

- [ ] **Registro, raíz `?`:** resolverla con el usuario del proceso (`HKU\<SID>`) o deduciendo la
  colmena por las claves vistas bajo esa base.
- [ ] **Registro, valor escrito:** llega vacío. Activar la captura de datos del proveedor o leer el
  valor tras la escritura.
- [ ] **El latido informa de los eventos ETW perdidos** (EventsLost y BuffersLost de la sesión)
  y de los descartes del hilo de hashes. «No lo vi» nunca debe ser silencioso.
- [ ] **Versión del sensor en el latido** y aviso en Equipos de sensores desactualizados.
- [ ] Probar el spool con caídas largas del motor (horas) y con reinicios del equipo a mitad.
- [ ] Medir CPU y memoria durante una semana, también con la carga de compilaciones y actualizaciones
  de Windows.

### Motor y consola

- [ ] Cuotas por equipo en la memoria del motor, para que un equipo ruidoso no expulse a los demás.
- [ ] Agrupar en la cola la misma alerta en varios equipos (una fila con N equipos).
- [ ] Revisar la memoria de la consola (node, 196 MB) y el consumo con la consola abierta todo el día.
- [ ] Comprobar en uso real el arreglo de la suspensión del portátil (cerrar y abrir la tapa sin
  falsos «sin señal»).

### Detecciones nuevas que salieron de los datos

- [ ] **WPAD/LLMNR:** consultas `wpad` respondidas por un equipo de la red local que no es el
  servidor DNS (envenenamiento en redes compartidas). Hoy hay consultas `wpad` normales: medir
  primero el patrón normal.

### Herramientas y documentación

- [ ] **Informe de la prueba de uso:** `sf-engine report soak` (o un script) que saque el resumen que
  hoy hice a mano:
  - salud de la recogida y recursos;
  - huecos (suspensiones);
  - procesos y dominios más frecuentes;
  - alertas por regla.
- [ ] Actualizar `docs/ROADMAP.md`: red, registro, DNS y hashes del sensor ya están entregados.
- [ ] Notas de limitaciones conocidas de la v1.0 (raíz `?`, valor del registro, ruido de software
  de fabricante).

## Escala SOC: miles de equipos

Diseño: [PLAN-DETALLADO §4](docs/PLAN-DETALLADO.md)

Hoy hay un motor con SQLite y una consola. Funciona para un equipo, un laboratorio o unas decenas
de equipos. Para un SOC con miles de equipos y varios analistas hace falta lo siguiente, por fases.
Las cifras se miden con un simulador, no se suponen.

**Cálculo de partida.** Medido hoy: unos 24 eventos por minuto en un portátil en reposo.
- 5.000 equipos → unos 2.000 eventos por segundo, y unos 170 millones de eventos al día.
- Un solo motor procesa eso (FieldMap 1,7 µs por evento; SQLite por lotes, unos 23.000 eventos/s),
  pero **SQLite no puede guardar 72 horas** de esa flota, y una consola que lista equipos uno a uno
  no sirve con 5.000.

### Fase A — reducir en origen (va con el ruido de la v1.1)

- [ ] Agrupar repeticiones en el sensor, más la lista de software conocido: el objetivo es dividir el
  volumen por 5 o más antes de que salga del equipo.
- [ ] Límite de eventos por segundo por sensor, con contador de recortes en el latido (nunca
  recortar en silencio).
- [ ] Simulador de flota (ampliar `fleet-sim.py`): 1.000, 5.000 y 10.000 sensores sintéticos con
  perfiles reales (portátil en reposo, servidor, controlador de dominio), en CI nocturno.

### Fase B — separar ingesta, detección y almacenamiento

- [ ] **Pasarelas de ingesta** sin estado detrás de un balanceador TCP/TLS: validan la identidad del
  sensor y publican en una cola (NATS o Kafka). Pueden crecer en número.
- [ ] **Trabajadores de detección repartidos por equipo** (hash consistente del nombre del equipo).
  Todo el estado por equipo vive en el trabajador de ese equipo: correlador, beacons, umbrales y
  línea base.
- [ ] **Correlación entre equipos en un nivel central:** recibe los aciertos de reglas, no los eventos
  en bruto (cadenas por cuenta en varios equipos, la misma alerta en muchos equipos).
- [ ] **Almacenamiento por niveles:**
  - alertas, incidentes, inventario y cuentas en PostgreSQL;
  - eventos en un almacén columnar (ClickHouse u OpenSearch) con retención por días y compresión;
  - SQLite se queda para el modo de un solo equipo.
- [ ] **Identidades en la base de datos central:** altas y revocaciones al momento en todas las
  pasarelas (enlaza con la mejora 2 de despliegue).

### Fase C — operar la flota

- [ ] **Grupos y etiquetas de equipos** (sede, departamento, unidad organizativa de AD, servidores o
  puestos). Las supresiones, la lista de software conocido y las alertas pueden ir por grupo.
- [ ] **Equipos a escala:**
  - vista por grupos con paginación y búsqueda en el servidor;
  - salud agregada: cuántos sin señal, desactualizados o con eventos perdidos;
  - ya no una lista plana.
- [ ] **Configuración de sensores por grupo:** qué capturar y qué filtros de ruido aplicar. El sensor
  la descarga firmada y la valida.
  - Límite a propósito: solo ajustes declarativos (capturas y filtros), nunca comandos ni
    ejecutables. Las actualizaciones del sensor siguen llegando por GPO o Intune.
- [ ] **Permisos por grupo:** cada analista ve y gestiona solo sus equipos.
- [ ] **Multi-cliente** (para un proveedor de servicios de seguridad): datos separados por cliente
  de punta a punta.

### Fase D — triaje a escala

- [ ] **Cola priorizada por riesgo:** severidad, criticidad del equipo (un controlador de dominio
  pesa más que un portátil) y acumulación.
- [ ] **Incidentes automáticos** por campaña (misma técnica en N equipos y misma cuenta).
- [ ] **Integración con tickets:** Jira o ServiceNow, además de los conectores SIEM que ya existen.
- [ ] **Métricas del SOC:** tiempo hasta el triaje y el cierre, falsos positivos por regla y carga
  por analista.

## Forense: vista propia en la consola

Diseño: [PLAN-DETALLADO §5](docs/PLAN-DETALLADO.md)

Hoy el forense existe, pero escondido. El motor congela un paquete de evidencia (la alerta y la
línea de tiempo del equipo de los 5 minutos anteriores) en cada alerta alta o crítica, y la consola
solo lo enseña dentro del detalle de esa alerta («Evidencia forense», exportable a JSON o JSONL).

- [ ] **Vista «Forense»** en la barra lateral:
  - todos los paquetes con su equipo, regla, severidad y fecha;
  - búsqueda y filtros;
  - enlace a la alerta y al incidente.
- [ ] **Árbol de procesos del paquete** (ROADMAP H2): ya lleva PID y PPID, así que se puede pintar
  con el mismo componente de árbol de Equipos.
- [ ] **Paquetes dentro del incidente:** las evidencias de sus alertas, en el informe imprimible.
- [ ] **Cadena de custodia:** hash SHA-256 de cada paquete al congelarlo, registrado aparte, y
  comprobación al exportar (que nadie lo haya cambiado).
- [ ] **Más contexto en el paquete:**
  - hashes y firmante de los ejecutables;
  - conexiones del proceso y sus dominios;
  - claves de registro tocadas;
  - ventana configurable (no solo 5 minutos).
- [ ] **Retención configurable** (`-forensic-retention`) en lugar del tope fijo de 256 paquetes.

## Prevención y respuesta en los equipos

Diseño: [PLAN-DETALLADO §6](docs/PLAN-DETALLADO.md)

Hoy los equipos solo envían datos. La única respuesta, `kill_process`, actúa en el propio servidor
del motor, con credencial por operador y auditoría. Actuar sobre los equipos de la flota cambia la
línea que trazamos («el dashboard observa»), así que se hace como una decisión explícita y con estos
límites de diseño:
- un conjunto **cerrado** de acciones predefinidas, nunca «ejecutar un comando» ni subir programas;
- cada orden **firmada** por el servidor y comprobada por el sensor;
- autorizada por un operador con credencial propia (opcionalmente por dos personas);
- auditada en el servidor y en el equipo;
- desactivable por grupo o por equipo, con una lista de procesos y equipos protegidos.

### Política de protección: la decide el equipo SOC

Cada SOC elige hasta dónde llega la herramienta, por grupo de equipos. Unos solo quieren observar
y otros quieren respuesta automática. Nada de lo de abajo se activa sin que la política lo diga.

- [ ] **Niveles de protección por grupo** (un grupo puede ser la sede, el departamento, la unidad
  organizativa de AD o servidores frente a puestos):

  | Nivel | Qué hace |
  |---|---|
  | 0. Observar | Telemetría y postura, sin cambiar nada. Es el valor por defecto. |
  | 1. Recomendar | Además, genera políticas para GPO o Intune y alerta si la postura empeora. |
  | 2. Prevenir en auditoría | El sensor registra lo que habría bloqueado, sin bloquear. |
  | 3. Prevenir | El sensor para los procesos con hash en la lista de bloqueo. |
  | 4. Responder | Activa las acciones remotas (aislar, matar, cuarentena, recoger evidencia). |

- [ ] **Quién aprueba cada acción:** por política, una persona o dos (cuatro ojos), y qué roles
  pueden pedirla y aprobarla (enlaza con las cuentas de analista).
- [ ] **Respuesta automática** (playbooks) solo donde el SOC la active. Cada playbook es:
  - un disparador: regla, cadena o severidad, más la confianza mínima;
  - una acción;
  - el alcance (qué grupos);
  - límites: como mucho N acciones por hora, para que un falso positivo no aísle media empresa.

  Ejemplo: «cadena de ransomware → aislar el equipo, sin esperar a nadie, solo en puestos de
  trabajo».
- [ ] **Equipos protegidos y excepciones:** controladores de dominio y servidores críticos nunca se
  aíslan solos, aunque la política del grupo lo permita. Software o equipos exentos.
- [ ] **Ventanas de mantenimiento:** en horario de parches o despliegues, la prevención pasa a modo
  auditoría.
- [ ] **Interruptor general:** un botón que devuelve toda la flota a «Observar» al momento, para
  emergencias o falsos positivos masivos.
- [ ] **Simulación antes de activar:** «qué habría pasado con esta política en los últimos 30
  días»: cuántos aislamientos y bloqueos y en qué equipos, con las alertas reales guardadas.
- [ ] **La política es un fichero versionado** (YAML, revisable en Git) y la consola tiene un editor.
  - Cada cambio queda en la auditoría: quién, cuándo y la diferencia.
  - Se distribuye a los sensores firmada.
  - Los sensores solo aceptan ajustes declarativos: niveles, listas y límites, nunca código.
- [ ] **Panel de la política en la consola:** nivel de cada grupo, acciones pendientes de aprobar,
  acciones hechas y deshechas, y el contador de los límites.

### Escalones técnicos

Por orden de riesgo, de menor a mayor:

- [ ] **Postura de seguridad (solo lectura, sin cambiar nada).** El sensor informa en el latido de:
  - si Defender está activo y sus firmas, al día;
  - cortafuegos, BitLocker y actualizaciones pendientes;
  - protección de LSA (RunAsPPL), SMBv1, RDP con NLA y administradores locales.

  Equipos lo muestra con una puntuación y recomendaciones, y hay alertas cuando algo se desactiva
  (por ejemplo, alguien apaga Defender).
- [ ] **Políticas recomendadas para el dominio:** la consola genera la configuración lista para
  aplicar por GPO o Intune (reglas ASR de Defender, WDAC o AppLocker en modo auditoría, cortafuegos).
  La aplica el dominio, no nosotros.
- [ ] **Prevención local por política.** El sensor termina al instante un proceso cuyo hash está en
  una lista de bloqueo de la organización (las mismas listas de `intel/`, marcadas como «bloquear»).
  - Empieza en modo «solo avisar», con registro de lo que habría parado.
  - Límite real: desde modo usuario solo se puede parar un proceso ya arrancado, no impedir que
    arranque. Bloquear antes de la ejecución es trabajo de WDAC, AppLocker o un driver.
- [ ] **Acciones de respuesta remotas,** cada una con su confirmación:
  - aislar el equipo de la red, dejando solo la conexión con el servidor, y liberarlo;
  - terminar un proceso por PID y hash;
  - poner un fichero en cuarentena por ruta y hash;
  - recoger un paquete forense del equipo bajo demanda.

  Necesitan un canal del servidor al sensor que hoy no existe: se diseña con firma, caducidad de
  cada orden y protección frente a repeticiones.

## Varios tardígrados: nodos que se comunican

Diseño: [PLAN-DETALLADO §7](docs/PLAN-DETALLADO.md)

Si se levantan varios motores (sedes, redes separadas o capacidad), que formen nodos que se conocen
y comparten trabajo, en lugar de islas.

- [ ] **Identidad de nodo y alta de nodos:** como los sensores, cada nodo tiene una identidad propia y
  se une con un token de un solo uso. Comunicación con TLS mutuo entre nodos.
- [ ] **Federación por sedes (primero):** cada sede tiene su tardígrado con sus sensores, y los nodos
  de sede reenvían alertas, inventario y salud a un nodo central. Así:
  - la consola central ve toda la organización y puede consultar el detalle en el nodo de cada sede;
  - si el enlace se corta, la sede sigue detectando sola y reenvía al volver.
- [ ] **Compartir configuración entre nodos:** listas de inteligencia, software conocido,
  supresiones, reglas y cuentas, versionadas y firmadas desde el nodo central.
- [ ] **Correlación entre nodos:** cadenas por cuenta que cruzan sedes (la misma cuenta en equipos de
  dos sedes).
- [ ] **Clúster en una misma red (después):** varios nodos se reparten los equipos (fase B de escala:
  hash por equipo). Pertenencia por gossip o un registro central, y si cae un nodo, sus equipos
  pasan a otro.
- [ ] **Salud de los nodos en la consola:** mapa de nodos, latencia, cola de reenvío y versión.

## Plan de trabajo por carriles

A partir de aquí el trabajo se reparte en seis carriles. Cada uno trabaja en su propia rama y
el responsable del repositorio fusiona por PR.

| Carril | Rama | Se ocupa de |
|---|---|---|
| Implementación A | `carril/implementacion-a` | Motor y backend: Go, API, conectores, informes, sensor Rust |
| Implementación B | `carril/implementacion-b` | Consola: vistas, gráficas, flujos, ajustes |
| Pulimiento A | `carril/pulimiento-a` | Calidad del backend: refactor, rendimiento, CI, documentación técnica |
| Pulimiento B | `carril/pulimiento-b` | Calidad de la consola: diseño, tema claro/oscuro, accesibilidad, README |
| Seguridad A | `carril/seguridad-a` | Bugs funcionales en todo el proyecto |
| Seguridad B | `carril/seguridad-b` | Vulnerabilidades, dependencias, secretos, cadena de suministro |

Cada tarea lleva un identificador (`AD-1`, `VIZ-2`…) y el carril que la hace. Un carril anuncia
en su plan de ronda los identificadores que coge. Así nadie los repite.

Las secciones de arriba también tienen dueño:

| Sección | Carril |
|---|---|
| Despliegue 3 (instalador MSI) | Implementación A. La firma necesita el certificado del responsable: el carril deja el paso preparado |
| Despliegue 4 (WEF y detecciones de AD) y 5 (servidor como servicios, HTTPS) | Implementación A |
| v1.1 Ruido: agrupación en el sensor, software conocido, supresiones con condiciones | Implementación A |
| v1.1 Ruido: informe de ruido en la consola | Implementación B |
| v1.1 Sensor, Motor y consola, Detecciones nuevas | Implementación A (B en lo visible) |
| Escala SOC, fase A (simulador de flota, límites por sensor) | Implementación A; las mediciones, Pulimiento A |
| Forense: vista propia | Implementación B (vista); Implementación A (índice, cadena de custodia, retención) |
| Prevención §6.2 (postura de solo lectura), §6.1 y §6.3 (política, recomendar, simular) | Implementación A y B |
| Prevención §6.4 (canal de respuesta y acciones) | Nadie, hasta que el responsable lo decida |
| Varios tardígrados (nodos) | Después de la v1.2 |

Límites del proyecto que ningún carril cruza:
- La consola **observa**: no ejecuta nada en los equipos ni en el dominio.
- Las acciones de respuesta (§6.4, niveles 3–4) necesitan una decisión explícita del
  responsable antes de empezar.
- Active Directory se lee, no se administra.
- La validación de detecciones usa telemetría sintética e inerte.
- No se descargan feeds ni herramientas de terceros de forma automática.

### Active Directory (solo lectura)

- [ ] **AD-1 Conector LDAP de solo lectura** — Implementación A
  - Conexión LDAPS obligatoria (o StartTLS), con la CA configurable y una cuenta de servicio
    **sin privilegios**: basta un usuario del dominio.
  - Sincroniza cada N minutos a SQLite:
    - usuarios, grupos, equipos y OUs;
    - membresías anidadas;
    - los atributos de seguridad: `userAccountControl`, `pwdLastSet`, `lastLogonTimestamp`,
      `adminCount`, presencia de SPN, tipos de cifrado admitidos y SO del equipo.
  - Paginación (RFC 2696) y límite de objetos.
  - La contraseña de la cuenta va en un fichero solo para el servicio y nunca se devuelve por
    la API.
  - Tests contra un servidor LDAP de pruebas (fixture en CI, sin dominio real).
- [ ] **AD-2 Postura del dominio** — Implementación A (cálculo), Implementación B (vista)
  - Hallazgos clásicos de auditoría defensiva:
    - miembros efectivos de los grupos privilegiados (Domain/Enterprise/Schema Admins,
      Administrators, Account/Backup/Server/Print Operators);
    - cuentas inactivas más de N días y cuentas habilitadas sin uso;
    - contraseñas que no caducan;
    - cuentas sin preautenticación Kerberos;
    - cuentas de usuario con SPN y RC4 permitido;
    - delegación sin restricciones;
    - `krbtgt` con contraseña antigua;
    - `adminCount` huérfano;
    - equipos con un SO sin soporte;
    - equipos del dominio **sin sensor** (cobertura).
  - Cada hallazgo lleva su severidad, los objetos afectados y la remediación en lenguaje
    claro. Puntuación de 0 a 100 con historial.
- [ ] **AD-3 Auditoría de inicios de sesión** — Implementación A. Depende de WEF (§4 de despliegue).
  - Inicios de sesión correctos y fallidos por usuario y equipo, bloqueos (4740) y RDP (tipo 10).
  - Fuera del horario laboral configurable.
  - Cuentas privilegiadas que inician sesión en puestos normales.
  - Primer inicio de sesión de un usuario en un equipo.
  - Es para seguridad, no para medir la productividad de nadie:
    - la retención se puede configurar;
    - solo ven los datos los roles autorizados;
    - la documentación recuerda informar a la plantilla (RGPD).
- [ ] **AD-4 Auditoría de cambios** — Implementación A
  - Altas y bajas de cuentas (4720/4726), cambios de grupo (4728/4732/4756), cambios de cuenta
    (4738), restablecimientos de contraseña por un administrador (4724), desbloqueos (4767) y
    cambios en objetos del directorio y en GPO (5136).
  - Alerta cuando el cambio toca un grupo privilegiado.
- [ ] **AD-5 Sección «Active Directory» en la consola** — Implementación B. Pestañas:
  - **Resumen:** donut de hallazgos por severidad, puntuación con tendencia y cobertura de
    sensores.
  - **Usuarios:** tabla con búsqueda. La ficha de usuario muestra grupos, equipos donde inicia
    sesión, alertas y línea de tiempo.
  - **Grupos privilegiados:** **árbol** de membresía anidada.
  - **Equipos:** dominio frente a inventario de sensores.
  - **Inicios de sesión:** mapa de calor hora × día, fallos por usuario y bloqueos.
  - **Cambios:** lista filtrable con enlace a la alerta.
- [ ] **AD-6 Ajustes de Active Directory** — Implementación B (pantalla) y A (API)
  - Servidor, puerto, base DN, CA, cuenta de servicio, intervalo de sincronización, OUs
    incluidas y excluidas, horario laboral y umbral de inactividad.
  - Botón «Probar conexión», que muestra qué se puede leer.
  - Solo administradores y con auditoría. La contraseña se escribe pero nunca se muestra.
- [ ] **AD-7 Inicio de sesión en la consola con cuentas del dominio** — Implementación A y B
  - Bind LDAPS con las credenciales del usuario.
  - Grupos de AD que dan cada rol (por ejemplo, `GG-SOC-Admins` → administrador).
  - Las cuentas locales siguen funcionando como respaldo.

### Informes y descargas

- [ ] **REP-1 Catálogo de informes** — Implementación A (datos y API), Implementación B (pantalla)
  - Resumen ejecutivo (semanal o mensual), incidente, postura de AD, inicios de sesión,
    cobertura de la flota, ruido y actividad del equipo SOC.
  - Cada uno descargable en PDF, para imprimir o guardar desde el navegador con estilos de
    impresión, y en CSV y JSON.
- [ ] **REP-2 Informes programados** — Implementación A
  - Diarios, semanales o mensuales, guardados en `data/reports` con retención.
  - Lista y descarga en la consola.
  - Envío opcional por correo (SMTP) o webhook, con el destino configurado por un
    administrador.
- [ ] **REP-3 Página «Descargas»** — Implementación B
  - El sensor firmado (exe y, cuando exista, MSI) con su SHA-256.
  - El certificado de ingesta para el alta por token.
  - Las guías.
  - Los equipos **descargan**; la consola nunca empuja nada.
- [ ] **REP-4 Gráficas en los informes** — Implementación B. Las mismas gráficas de la consola,
  exportables a PNG o SVG.

### Validación de detecciones (simulación de adversario segura)

- [ ] **SIM-1 Escenarios de telemetría sintética** — Implementación A
  - Ficheros YAML que describen secuencias de eventos inertes (los mismos campos que envía el
    sensor), cada una con su técnica ATT&CK y las alertas que se esperan.
  - Un reproductor las envía a un motor de laboratorio con la etiqueta `simulation`, para que
    nunca se mezclen con alertas reales.
  - **No se ejecuta nada en ningún equipo.**
- [ ] **SIM-2 Biblioteca de escenarios** — Implementación A. Uno por cada regla o cadena del paquete,
  partiendo de los fixtures que ya existen. En CI, un escenario que deja de detectarse rompe el
  build: así se cazan regresiones de detección.
- [ ] **SIM-3 Matriz ATT&CK en la consola** — Implementación B
  - Tácticas × técnicas, coloreadas según la técnica tenga regla, esté validada por un
    escenario o haya saltado en los últimos 30 días.
  - Al hacer clic se ven las reglas y los escenarios de cada técnica.
- [ ] **SIM-4 Ejecución bajo demanda y su historial** — Implementación A y B
  - Desde la consola se lanza la batería contra el motor de laboratorio (nunca el de producción).
  - Se guarda el resultado: detectado o no y latencia.
  - Una gráfica muestra la tendencia.
- Las pruebas con herramientas de emulación sobre equipos reales (purple team) se hacen en un
  laboratorio aislado y autorizado, fuera del proyecto. El proyecto no incluye ni descarga
  herramientas ofensivas.

### Gráficas y visualización

Hay que seguir las reglas de visualización (paleta validada, leyenda, vista en tabla, tooltips)
en los dos temas.

- [ ] **VIZ-1 Donuts («gráfica de queso»)** — Implementación B
  - Alertas por severidad, por táctica y por fuente.
  - Flota por estado; hallazgos de AD por severidad.
  - Como mucho 6 porciones más «Otros», con etiqueta, leyenda y total en el centro.
- [ ] **VIZ-2 Mapa de calor hora × día** — Implementación B (alertas, inicios de sesión, eventos por
  equipo).
- [ ] **VIZ-3 Flujo del triaje** — Implementación B. Fuente → táctica → estado (nuevo, en
  investigación, cerrado, falso positivo).
- [ ] **VIZ-4 Tendencias** — Implementación B. Comparación con el periodo anterior y minigráficas en
  las tarjetas de KPI.
- [ ] **VIZ-5 Mapa de la flota** — Implementación B. Grafo de equipos por sede u OU con su estado;
  al hacer clic, la ficha.
- [ ] **VIZ-6 Exportar cualquier gráfica** — Implementación B (PNG, SVG o los datos en CSV).

### Tema claro y oscuro

- [ ] **THEME-1 Tokens de diseño** — Pulimiento B
  - Colores definidos como variables en `:root`, con versión clara y oscura (base zinc).
  - Selector en la cabecera: sistema, claro u oscuro. Se recuerda por usuario.
  - Respeta `prefers-color-scheme`. El modo NOC sigue oscuro.
- [ ] **THEME-2 Migrar los colores fijos** — Pulimiento B
  - Hoy muchas clases suponen fondo oscuro (`text-zinc-100`, `bg-white/[0.03]`); deben pasar a
    los tokens.
  - Contraste AA comprobado en los dos temas.
- [ ] **THEME-3 Paletas de gráficas por tema** — Pulimiento B. Validadas con la herramienta de
  paletas, sin repintar las series al cambiar de tema.

### Gestión del equipo SOC

- [ ] **TEAM-1 Página de inicio de sesión propia** — Implementación A (sesiones) y B (pantalla)
  - Sustituye el diálogo Basic del navegador.
  - Sesión con cookie `HttpOnly`, `Secure` y `SameSite=Strict`, caducidad por inactividad y
    cierre de sesión.
  - Bloqueo temporal tras varios fallos.
  - Segundo factor TOTP opcional.
- [ ] **TEAM-2 Cuentas desde la consola** — Implementación A y B
  - Alta, baja, rol, deshabilitar y restablecer contraseña de las cuentas **de la consola**
    (no del dominio). Cambio obligatorio en el primer acceso.
  - Solo administradores y auditado. Hoy se edita a mano `CONSOLE_USERS_FILE`.
- [ ] **TEAM-3 Asignación** — Implementación A y B
  - Alertas e incidentes con responsable, una vista «Mis alertas», la cola sin asignar y la
    reasignación.
- [ ] **TEAM-4 Quién está trabajando** — Implementación B
  - Sesiones activas («en línea ahora») y qué alerta o incidente tiene abierto cada analista.
  - Turno de guardia y traspaso de turno con notas.
- [ ] **TEAM-5 Actividad del equipo** — Implementación B. Feed de quién hizo qué, sacado de la
  auditoría, con enlaces y filtros por persona y acción.
- [ ] **TEAM-6 Métricas del SOC** — Implementación A (cálculo) y B (gráficas)
  - Tiempo hasta el triaje y hasta el cierre, carga por analista y falsos positivos por regla.
  - Son métricas del servicio, visibles para administradores, no un control de productividad.

### Ajustes

- [ ] **SET-1 Sección «Ajustes»** — Implementación B (pantalla), Implementación A (API y
  persistencia con recarga en caliente). Una sola página con:
  - **General:** organización, zona horaria e idioma.
  - **Ingesta:** TLS, alta de equipos y tokens.
  - **Active Directory:** AD-6.
  - **Integraciones:** webhook, SMTP, Teams y Slack, Elastic y Splunk.
  - **Notificaciones**, **Cuentas** (TEAM-2) y **Apariencia** (tema).
  - Cada cambio se valida, queda auditado y solo lo hacen administradores.
- [ ] **SET-2 Copia de seguridad y restauración** — Implementación A. `data/` y la configuración
  con un comando y desde Ajustes. Se verifica la integridad al restaurar.
- [ ] **SET-3 Página «Estado de la plataforma»** — Implementación B
  - Motor, ingesta, colas, latencias, tamaño del almacén y versión.
  - Certificados que caducan y último informe programado.

### Más ideas relevantes

- [ ] **IDEA-1 Notificaciones con reglas de enrutado** — Implementación A. Por severidad, grupo u
  hora; correo, Teams o Slack; con silencios temporales.
- [ ] **IDEA-2 SLA de triaje y escalado** — Implementación A y B. Temporizador por severidad,
  aviso al vencer y escalado al responsable de turno.
- [ ] **IDEA-3 Plantillas de incidente** — Implementación B. Ransomware, phishing, cuenta
  comprometida: listas de comprobación manuales, evidencias, cronología y exportación.
- [ ] **IDEA-4 Lenguaje de búsqueda** — Implementación A y B
  - `campo:valor`, `AND`/`OR`/`NOT`, rangos y comodines.
  - Búsquedas guardadas compartidas y «cacerías» programadas que crean alertas.
- [ ] **IDEA-5 Editor de reglas en la consola** — Implementación B
  - Validación, el probador (ya existe) e historial de versiones.
  - Importar Sigma desde la consola (hoy solo por CLI).
- [ ] **IDEA-6 Criticidad y propietario de cada equipo** — Implementación A y B. Pesan en el riesgo
  y en la cola de triaje (va con los grupos de la escala SOC, fase C).
- [ ] **IDEA-7 Software instalado y parches** — Implementación A. Lectura de las claves
  `Uninstall` y del último parche, solo lectura, con un hallazgo cuando hay software sin
  soporte (va con la postura §6.2).
- [ ] **IDEA-8 Línea base por usuario** — Implementación A. Horas y equipos habituales; alerta de
  baja severidad ante lo nunca visto.
- [ ] **IDEA-9 Claves de API por integración** — Implementación A. Con alcance (lectura, escritura
  de triaje), caducidad y auditoría, en lugar de un único token.
- [ ] **IDEA-10 Idiomas** — Implementación B. Español e inglés en la consola.
- [ ] **IDEA-11 Asistente de primer arranque** — Implementación B. Crear el administrador, el
  certificado de ingesta, el primer token de alta y comprobar el sensor local.
- [ ] **IDEA-12 Tablas grandes** — Implementación B. Paginación en el servidor y listas
  virtualizadas para miles de equipos o alertas.

### Pulimiento

Backend: Pulimiento A.

- [ ] **POL-1 Ficheros demasiado grandes:**
  - `internal/api/api.go` (más de 1.300 líneas);
  - `cmd/engine/run.go`;
  - `sensor/src/collector.rs` (más de 1.000 líneas).

  Se dividen por responsabilidad, sin cambiar su comportamiento.
- [ ] **POL-2 Logs** estructurados (`log/slog`) con niveles y campos coherentes en el motor.
- [ ] **POL-3 Rendimiento:**
  - perfiles `pprof` del camino caliente;
  - asignaciones de memoria en la ingesta y en las reglas;
  - lotes del almacén.

  Los resultados van al benchmark nocturno.
- [ ] **POL-4 Restos del nombre antiguo:** `SECURITY-FRAMEWORK ENGINE` en el banner y
  `security-framework local API` en OpenAPI pasan a bluetardigrade.
- [ ] **POL-5 Documentación:**
  - OPERATIONS dividido por capítulos;
  - referencia de la API generada desde OpenAPI;
  - `CONTRIBUTING.md`, `SECURITY.md`, plantillas de issue y PR.
- [ ] **POL-6 Release:**
  - SBOM (CycloneDX) en cada release;
  - el sensor compilado y firmado entre los artefactos;
  - un fragmento de changelog por cambio (`changelog.d/`) para evitar conflictos.

Consola: Pulimiento B.

- [ ] **POL-7 Kit de componentes compartidos:** botón, campo, tabla, pestañas, insignia y diálogo,
  con sus variantes. Las vistas pasan a usarlo.
- [ ] **POL-8 Accesibilidad WCAG 2.2 AA:**
  - foco visible y teclado completo;
  - gráficas con `aria` y vista en tabla;
  - comprobación axe en el CI del navegador.
- [ ] **POL-9 Rendimiento de la consola:** tamaño del bundle, memoización de las vistas pesadas e
  informe de Lighthouse.
- [ ] **POL-10 README y capturas:**
  - capturas nuevas en los dos temas;
  - árbol de carpetas actualizado;
  - se mantienen el logo y la cabecera originales.
- [ ] **POL-11 Microinteracciones con React Bits y Motion,** sutiles y con
  `prefers-reduced-motion` respetado.

### Seguridad y bugs

- [ ] **SEC-1 Modelo de amenazas** de las superficies nuevas: alta de equipos, conector de AD,
  inicio de sesión, informes, ajustes y descargas. STRIDE en `docs/`. — Seguridad B
- [ ] **SEC-2 Secretos en reposo:**
  - credenciales de AD, SMTP y webhooks en ficheros con ACL;
  - en Windows, cifrados con DPAPI;
  - nunca devueltos por la API ni escritos en logs.

  — Seguridad B
- [ ] **SEC-3 Entradas** — Seguridad B:
  - filtros LDAP escapados (RFC 4515);
  - rutas de descarga sin traversal;
  - exportaciones CSV sin inyección de fórmulas (`=`, `+`, `-`, `@`);
  - URLs de integraciones validadas;
  - ningún `dangerouslySetInnerHTML` con datos de eventos.
- [ ] **SEC-4 Sesiones de la consola:**
  - CSRF;
  - fijación de sesión;
  - caducidad;
  - bloqueo por fallos;
  - cabeceras (CSP, `frame-ancestors`, HSTS detrás de HTTPS).

  — Seguridad B
- [ ] **SEC-5 Dependencias** en el CI: `govulncheck`, `cargo audit` y `osv-scanner` para bun, con
  una política para las alertas. Decidir el PR #8 de Dependabot. — Seguridad B
- [ ] **SEC-6 Cadena de suministro** — Seguridad B
  - Auditar los componentes de terceros copiados en la consola (React Bits) y cualquier skill o
    paquete que instalen los carriles de diseño.
  - Sin scripts `postinstall` nuevos.
- [ ] **SEC-7 Fuzzing** (Go) de las superficies de entrada — Seguridad A:
  - decodificador de la ingesta;
  - líneas `ENROLL` y `AUTH`;
  - cargadores YAML;
  - parser de los ficheros de inteligencia.
- [ ] **SEC-8 Bugs conocidos** — Seguridad A:
  - el mensaje «ingest auth: ENABLED (… -token/SF_INGEST_TOKEN)» confunde cuando la
    autenticación la activa el alta de equipos;
  - casos borde del alta (equipo renombrado, reloj desfasado, registro lleno);
  - repasar lo marcado como pendiente en la hoja de pruebas.
- [ ] **SEC-9 Privacidad** — Seguridad B
  - Minimizar datos personales en los inicios de sesión y en las líneas de tiempo de usuario.
  - Retención configurable.
  - Acceso por rol y auditoría de quién consulta la ficha de un usuario.

## Más adelante (ver ROADMAP)

- v1.2, detección: carga de DLL y drivers (`image.load`), firma de binarios, inyección real,
  selección curada de reglas Sigma.
- v1.3, investigación: árbol de procesos en las evidencias, analista IA sobre un incidente
  completo, retención configurable.
- v2, escala: cuotas por equipo en el motor y pruebas con decenas de sensores.

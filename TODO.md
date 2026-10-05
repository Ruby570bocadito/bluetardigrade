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

- [ ] Subir la rama `fix/ci-and-host-guard`, abrir el PR y fusionarlo con CI en verde.
  Lleva los arreglos del CI del PR #15, el filtro anti DNS rebinding y la suspensión del portátil.
- [ ] Limpiar ramas ya integradas (comandos en la conversación del 5 de octubre) y activar en GitHub
  «Automatically delete head branches».
- [ ] Etiquetar `v1.0.0-rc1`.
- [ ] Prueba de uso real de 24–48 horas con el sensor en marcha. En curso desde el 5 de octubre,
  en clase. Al terminar: analizar alertas, ruido, memoria, eventos perdidos y reconexiones.
- [ ] Secciones pendientes de la hoja de pruebas: 7 (cuentas) y 4 (segundo equipo).
- [ ] Unificar versiones: motor `0.2.0` y sensor `0.1.0` → `1.0.0`.
- [ ] Notas de la versión con las limitaciones conocidas, y etiqueta `v1.0.0`.

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

### 2. Alta de equipos con token de un solo uso y aprobación

Diseño: [PLAN-DETALLADO §1.2](docs/PLAN-DETALLADO.md)

- [ ] El servidor emite tokens de alta de un solo uso, con caducidad. Se crean desde la consola
  (asistente «Añadir equipo»).
- [ ] El sensor nuevo canjea el token por una identidad propia, ligada a su nombre de equipo.
- [ ] En Equipos aparece como «pendiente» hasta que un administrador lo aprueba o lo rechaza.
  Las aprobaciones quedan en la auditoría.
- [ ] Revocar un equipo: su identidad deja de valer al momento.

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
  exacta o ruta. Caso real: la regla del portapapeles saltó por la integración de Claude Code
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

## Más adelante (ver ROADMAP)

- v1.2, detección: carga de DLL y drivers (`image.load`), firma de binarios, inyección real,
  selección curada de reglas Sigma.
- v1.3, investigación: árbol de procesos en las evidencias, analista IA sobre un incidente
  completo, retención configurable.
- v2, escala: cuotas por equipo en el motor y pruebas con decenas de sensores.

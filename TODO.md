# TODO — bluetardigrade

Lista de trabajo práctica. La dirección a largo plazo está en
[docs/ROADMAP.md](docs/ROADMAP.md); lo ya entregado, en el
[CHANGELOG](CHANGELOG.md); lo que falta probar en un Windows real, en
[docs/PRUEBAS-PENDIENTES.md](docs/PRUEBAS-PENDIENTES.md).

Marca `[x]` al terminar y deja una línea con el commit o la prueba que lo cierra.

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

- [ ] El servidor emite tokens de alta de un solo uso, con caducidad. Se crean desde la consola
  (asistente «Añadir equipo»).
- [ ] El sensor nuevo canjea el token por una identidad propia, ligada a su nombre de equipo.
- [ ] En Equipos aparece como «pendiente» hasta que un administrador lo aprueba o lo rechaza.
  Las aprobaciones quedan en la auditoría.
- [ ] Revocar un equipo: su identidad deja de valer al momento.

### 3. Paquete instalador desde la consola

- [ ] El asistente genera un instalador (MSI o EXE) con la dirección del servidor, el certificado
  de la CA y un token de alta ya incluidos.
- [ ] Instala el servicio de la mejora 1 y se da de alta solo (mejora 2). Se ve en «Aplicaciones»
  y se desinstala desde ahí.
- [ ] Firmado con Authenticode (`scripts/release/sign-windows.ps1`).
- [ ] Guía de despliegue en el dominio por GPO e Intune.
- Límite a propósito: la consola no ejecuta ni instala nada en los equipos a distancia. El
  software llega por los canales del dominio (GPO, Intune o alguien con administrador).

### 4. Ver el dominio: Windows Event Forwarding y detecciones de AD

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

- [ ] Motor, hub y consola como servicios en Windows Server.
- [ ] HTTPS en la consola, para que los analistas entren desde su equipo con sus cuentas.

## v1.1 — fiabilidad en uso real

Sale de las pruebas en un equipo real (4 y 5 de octubre). Datos de la prueba de la jornada:
- en 27 minutos, 645 eventos, 0 perdidos, 0 rechazados y 0 al spool;
- el 100 % de los procesos llevan ruta y SHA-256, y el 90 % de las consultas DNS llevan su IP;
- recursos: sensor 15 MB, motor 33 MB, consola 196 MB.

### Ruido: que lo normal no ahogue lo importante

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

## Más adelante (ver ROADMAP)

- v1.2, detección: carga de DLL y drivers (`image.load`), firma de binarios, inyección real,
  selección curada de reglas Sigma.
- v1.3, investigación: árbol de procesos en las evidencias, analista IA sobre un incidente
  completo, retención configurable.
- v2, escala: cuotas por equipo en el motor y pruebas con decenas de sensores.

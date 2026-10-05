# Plan detallado — bluetardigrade

Desarrollo de cada punto de [TODO.md](../TODO.md): qué se construye, cómo funciona por dentro,
cuándo está hecho, de qué depende y qué esfuerzo lleva. El TODO es la lista de casillas; este
documento es el diseño. Una «sesión» es una tanda de trabajo como las de estos días (implementar,
probar y documentar).

Cada apartado sigue el mismo guion:
- **Objetivo:** el problema que resuelve.
- **Diseño:** cómo funciona por dentro.
- **Hecho cuando:** la prueba que lo cierra.
- **Depende de:** qué tiene que existir antes.
- **Esfuerzo:** en sesiones.
- **Riesgos:** qué puede salir mal y cómo se evita.

---

## 0. Hitos y orden

| Hito | Contenido | Depende de | Esfuerzo |
|---|---|---|---|
| **v1.0** | Etapa 0: CI en verde, prueba de uso de 24–48 h, secciones 4 y 7 de la hoja de pruebas, versiones unificadas | — | 1–2 |
| **v1.1** | Sensor como servicio (§1.1), ruido (§2.1–2.4), salud del sensor (§2.5), registro (§2.6), informe de la prueba de uso | v1.0 | 5–7 |
| **v1.2** | Alta de equipos (§1.2), instalador MSI (§1.3), postura de seguridad (§6.2), vista Forense (§5) | v1.1 | 6–8 |
| **v1.3** | Windows Event Forwarding y AD (§1.4), servidor como servicios (§1.5), política de protección en niveles 0–2 y simulación (§6.1, §6.3) | v1.2 | 6–8 |
| **v1.4** | Canal de respuesta (§6.4), niveles 3–4, playbooks y aprobación por dos personas | v1.3 | 5–7 |
| **v2.0** | Nodos federados (§7), escala fase B (§4.3), grupos y permisos por grupo (§4.4) | v1.3 | 10+ |
| **v2.x** | Clúster, multi-cliente, tickets y métricas del SOC (§4.5) | v2.0 | — |

Reglas de orden:
- La **prevención** (v1.4) llega después de que el **ruido** (v1.1) y la **simulación** (v1.3)
  estén resueltos. Una acción automática sobre una alerta ruidosa es un problema, no una protección.
- La **escala** (v2.0) llega después del **alta de equipos** (v1.2). Miles de equipos no se dan de
  alta a mano.

---

## 1. Despliegue

### 1.1 Sensor como servicio de Windows — hecho, falta la prueba real

Implementado en la rama `feat/sensor-service`: `--service`, `--log`, `--token-file`, el comando
`sf-etw` y `run_mode` en el latido.
- **Hecho cuando:** la sección 10 de la hoja de pruebas pasa en el portátil, incluido un reinicio de
  Windows sin abrir ninguna ventana de administrador.

### 1.2 Alta de equipos con token de un solo uso y aprobación

- **Objetivo:** que un equipo nuevo entre en la flota sin generar identidades a mano ni pegar YAML,
  y sin que nadie pueda colar un equipo sin permiso.
- **Diseño:**
  1. **Tokens de alta.** Se crean en Equipos → «Añadir equipos». Se guardan solo como hash, igual
     que hoy las identidades. Cada token tiene:
     - tipo **único** (un equipo) o **múltiple** (hasta N equipos, para un despliegue por GPO);
     - caducidad: 24 horas por defecto, 30 días como máximo;
     - un grupo destino;
     - una regla de **aprobación automática** opcional (por ejemplo, el nombre cumple `PC-CONTA-*`).
  2. **Protocolo.** La ingesta acepta, además de `AUTH <token>`, una primera línea
     `ENROLL <token-de-alta> <nombre-del-equipo>`.
     - El motor comprueba el token: que no haya caducado, que le queden usos y que el nombre sea
       válido.
     - Crea una **identidad pendiente** con un secreto propio de 256 bits y contesta
       `{"ack":"enrolled","identity":"…","secret":"…","state":"pending"}`.
     - El sensor guarda el secreto en `ProgramData\bluetardigrade\sensor\ingest.token` (los permisos
       de §1.1) y desde entonces abre siempre con `AUTH <secreto>`.
  3. **Estado pendiente.** Mientras no se aprueba, la ingesta acepta la conexión, pero sus eventos se
     **retienen** (un tope pequeño, 10.000) o se descartan con contador. No llegan a reglas, alertas
     ni almacén. El latido sí se procesa, para que Equipos muestre el equipo como «pendiente» con su
     sistema y su versión.
  4. **Aprobación.** En Equipos, pestaña «Pendientes»: aprobar, rechazar o aprobar en bloque. Las
     cuentas de la consola deciden quién puede (administrador por defecto). Aprobar pasa la identidad
     a activa; los eventos retenidos se procesan. Todo queda en la auditoría.
  5. **Revocar.** Desde la ficha del equipo: la identidad deja de valer en la siguiente conexión y la
     conexión abierta se corta. Hoy las identidades se recargan cada 15 s: las de alta irán en una
     tabla de SQLite con efecto inmediato.
  6. **Conflicto de nombre.** Si ya existe una identidad activa para ese nombre, la nueva queda
     pendiente con un aviso de «posible suplantación o reinstalación» y nunca se aprueba sola.
- **Hecho cuando:** en el laboratorio un sensor nuevo se da de alta con un token, aparece pendiente,
  se aprueba y sus eventos llegan. Además:
  - un segundo uso de un token único se rechaza;
  - un token caducado se rechaza;
  - una identidad revocada se corta en menos de 2 segundos;
  - hay tests de cada caso en la ingesta y E2E en el laboratorio.
- **Depende de:** §1.1 (el sensor guarda su secreto en `ProgramData`).
- **Esfuerzo:** 2 sesiones.
- **Riesgos y cómo se evitan:**
  - Un token múltiple filtrado permite colar equipos: caducidad corta, límite de usos y aprobación
    manual por defecto.
  - Fuerza bruta contra `ENROLL`: el mismo límite de conexiones y fallos que tiene hoy `AUTH`.

### 1.3 Paquete instalador desde la consola

- **Objetivo:** «ejecutar un archivo y que el equipo entre en el dashboard», también en todo el
  dominio por GPO o Intune.
- **Diseño:**
  1. **MSI con WiX Toolset v5** (libre), generado en el CI de release en un runner de Windows. Lleva:
     - `security-sensor.exe` en `Program Files\bluetardigrade\sensor`;
     - el servicio registrado con la tabla `ServiceInstall` de MSI (no hace falta PowerShell),
       arranque automático y recuperación con la tabla `MsiServiceConfigFailureActions`;
     - propiedades públicas `SERVER`, `ENROLL_TOKEN` y `CA` (opcional) que se escriben en la
       configuración;
     - un `UpgradeCode` fijo, para que instalar una versión nueva sea una actualización.
  2. **El propio sensor**, en modo servicio, crea `ProgramData\bluetardigrade\sensor` con permisos
     solo para SYSTEM y Administradores la primera vez. Así el MSI no necesita acciones personalizadas
     (la parte frágil de los MSI).
  3. **El asistente de la consola** entrega:
     - el enlace de descarga del MSI firmado;
     - la línea `msiexec /i bluetardigrade-sensor.msi SERVER=… ENROLL_TOKEN=… /qn`;
     - para GPO, un fichero de transformación (`.mst`) con esas propiedades.
  4. **Firma Authenticode** del exe y del MSI (`scripts/release/sign-windows.ps1`).
  5. **Desinstalación** desde «Aplicaciones»: quita el servicio y el binario y deja los datos (una
     propiedad `PURGE=1` los borra).
- **Hecho cuando:** en una VM limpia funcionan instalar, actualizar y desinstalar. En un dominio de
  prueba (un DC y un puesto), la GPO instala el sensor al reiniciar, se da de alta y queda pendiente.
  La firma es válida.
- **Depende de:** §1.1 y §1.2.
- **Esfuerzo:** 2 sesiones, más el laboratorio de dominio.
- **Riesgos y cómo se evitan:**
  - Un MSI sin firmar lo bloquea SmartScreen o Smart App Control: firma obligatoria en las releases.
  - La consola nunca empuja el MSI a los equipos: llega por los canales del dominio.

### 1.4 Ver el dominio: Windows Event Forwarding y detecciones de AD

- **Objetivo:** ver los controladores de dominio y los servidores sin instalarles nada.
- **Diseño:**
  1. **Suscripción WEF** iniciada por los equipos, configurada por GPO («Configure target
     Subscription Manager»). El servidor del motor activa el servicio Windows Event Collector y los
     eventos llegan al registro `ForwardedEvents`. Se incluye el XML de la suscripción y la guía.
  2. **Colector `sf-wec`** (Go, solo Windows): se suscribe a `ForwardedEvents` con `EvtSubscribe`
     (wevtapi, mediante `golang.org/x/sys/windows`, que ya es dependencia) y normaliza a eventos
     nuevos:

     | Evento de Windows | Tipo de evento |
     |---|---|
     | 4625 | `auth.failure` |
     | 4624 (tipos 3 y 10) | `auth.success` |
     | 4769 | `kerberos.service_ticket` |
     | 4662 | `directory.access` |
     | 4728/4732/4756 | `group.member_added` |
     | 7045 | `service.installed` |
     | 1102 | `log.cleared` |

  3. **Detecciones:**

     | Detección | Señal |
     |---|---|
     | Rociado de contraseñas | Desde un mismo origen, 10 o más cuentas distintas con 4625 en 10 minutos, estado `0xC000006A` (contraseña mala) o `0xC0000064` (usuario inexistente). Va con el detector de umbrales, que ya existe |
     | Kerberoasting | 4769 con cifrado `0x17` (RC4) para cuentas de servicio que no son de equipo; 5 o más SPN distintos en 5 minutos pedidos por la misma cuenta |
     | DCSync | 4662 con los GUID de replicación `1131f6aa-9c07-11d1-f79f-00c04fc2dcd2` / `1131f6ad-…` hecho por una cuenta que no es un controlador de dominio |
     | Privilegios | Altas en Domain Admins, Enterprise Admins o Administradores (4728/4732/4756) |
     | Persistencia | Servicio nuevo (7045) en un controlador de dominio o un servidor |
     | Antiforense | Registro de seguridad borrado (1102) |

- **Hecho cuando:** hay tests de reglas con eventos reales exportados (EVTX convertidos a fixtures),
  y en un dominio de laboratorio se reproducen spraying y kerberoasting con herramientas de prueba
  autorizadas. Las alertas salen con la cuenta y el origen.
- **Depende de:** nada nuevo; es mejor después de §1.5 (el servidor del dominio).
- **Esfuerzo:** 3 sesiones.
- **Riesgos y cómo se evitan:**
  - El volumen del registro de seguridad de un DC es alto: la suscripción filtra por ID de evento en
    origen.
  - Los nombres de evento cambian con el idioma: se usa el ID y los campos XML, nunca el texto.

### 1.5 Servidor central como servicios

- **Objetivo:** un Windows Server con todo arrancando solo y los analistas entrando desde su equipo.
- **Diseño:**
  1. El **motor como servicio nativo** con `golang.org/x/sys/windows/svc` (ya es dependencia), con el
     mismo patrón que el sensor: `--service`, `--log` y `sf-engine -InstallService`.
  2. **Hub y consola** (bun y node no son servicios de Windows por sí mismos): un pequeño supervisor
     en Go (`sf-service`), que sí es servicio, los arranca, vigila y reinicia.
  3. **HTTPS para la consola:** un proxy inverso (Caddy, con certificado propio o de la empresa)
     delante de la consola. Junto con las cuentas (`CONSOLE_USERS_FILE`), cada analista entra desde
     su navegador.
  4. Los **scripts de modo servidor** (tareas programadas) se mantienen para quien ya los usa, y se
     documenta cómo pasar de tareas a servicios.
- **Hecho cuando:** tras reiniciar el servidor, todo arranca sin sesión iniciada; un analista entra
  por HTTPS con su cuenta desde otro equipo; `sf-engine doctor` lo verifica.
- **Depende de:** nada.
- **Esfuerzo:** 1–2 sesiones.

---

## 2. v1.1 — fiabilidad en uso real

### 2.1 Agrupar arranques repetidos en el sensor

- **Objetivo:** el caso de Lenovo Vantage, 4 complementos cada minuto, el 43 % de los arranques de
  proceso.
- **Diseño:**
  1. **Clave:** SHA-256 del ejecutable, más la ruta del padre, la línea de comandos exacta y el
     usuario.
  2. **Ventana:** 10 minutos, configurable.
  3. **La primera aparición** sale completa, como hoy.
  4. **Las repeticiones** dentro de la ventana solo cuentan. Al cerrarse la ventana sale un
     `process.create` resumen con los atributos `repeat_count`, `repeat_first` y `repeat_last`.
     Si no hubo repeticiones, no sale nada más.
  5. **Nunca se agrupan** los binarios que las reglas vigilan: powershell, pwsh, cmd, rundll32,
     regsvr32, mshta, wmic, certutil, bitsadmin, schtasks, sc, reg, net, net1, wscript y cscript.
     Tampoco nada que no tenga hash.
  6. Hasta 4.096 claves. Si se llena, se vuelve a enviar todo, sin perder nada, y se avisa en el
     latido.
  7. Al apagarse el sensor, los resúmenes pendientes se envían.
- **Hecho cuando:** hay un test con la secuencia real de Vantage. En el portátil, los arranques de
  proceso bajan más del 40 % y ninguna regla deja de saltar en la batería de pruebas.
- **Esfuerzo:** 1 sesión.
- **Riesgos y cómo se evitan:** perder un evento que una regla necesitaba. Por eso se usa la lista
  de exclusiones, la clave exacta (un argumento distinto ya es otra clave) y el resumen al cerrar la
  ventana.

### 2.2 Lista de software conocido por organización

- **Diseño:** el fichero `known-software.yaml` se recarga en caliente y se valida, como las
  supresiones:

  ```yaml
  version: 1
  software:
    - name: Lenovo Vantage
      image: 'C:\Program Files (x86)\Lenovo\VantageService\*\LenovoVantage-*.exe'
      # opcionales; con firmante cuando exista el campo signer (v1.2)
      sha256: []
      signer: 'Lenovo'
  ```

  - **Efectos:** el evento lleva `enrichment.known_software=<nombre>`. La línea base no lo cuenta
    como nuevo. Las reglas de confianza baja o media se pueden excluir. La consola lo muestra
    atenuado.
  - **Nunca se borra el evento:** el software conocido también se compromete.
- **Hecho cuando:** con la lista puesta, el ruido de Vantage desaparece de la línea base y del
  informe de ruido, pero sigue buscable en el flujo.
- **Esfuerzo:** 1 sesión.

### 2.3 Supresiones con condiciones

- **Diseño:** las supresiones de hoy (regla y equipo, con caducidad) aceptan condiciones sobre
  campos del evento:

  ```yaml
  - rule_id: f0de8115-78c7-4ebd-add3-a1ac994d6a1c   # Lectura del portapapeles
    host: DESKTOP-1T9I3SH
    when:
      - field: process.command_line
        operator: eq
        value: 'powershell.exe -NoProfile -NonInteractive -Command "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw"'
    reason: integración de portapapeles de Claude Code
    expires: 2026-12-31
  ```

  - Se usan los mismos operadores que las reglas.
  - Desde el detalle de una alerta: «Suprimir esto exactamente», que rellena las condiciones con los
    campos del evento.
- **Hecho cuando:** el caso real del portapapeles se suprime sin apagar la regla, y un
  `Get-Clipboard` distinto sigue saltando.
- **Esfuerzo:** 1 sesión.

### 2.4 Informe de ruido

- **Diseño:** `GET /api/noise?window=24h` devuelve, por equipo y para toda la flota:
  - procesos que más arrancan;
  - dominios más consultados;
  - reglas con más alertas y su porcentaje cerrado como falso positivo (sale del triaje).

  La consola lo muestra en una pestaña de Detección, con botones directos: «añadir a software
  conocido» y «crear supresión».
- **Esfuerzo:** 1 sesión.

### 2.5 Salud del sensor en el latido

- **Diseño:**
  - Cada minuto, `ControlTraceW(EVENT_TRACE_CONTROL_QUERY)` sobre las dos sesiones da `EventsLost`
    y `RealTimeBuffersLost`. El latido los envía (`etw_events_lost`, `etw_buffers_lost`) junto con
    los descartes del hilo de hashes y la versión del sensor.
  - El motor avisa (severidad baja) cuando los perdidos suben, y Equipos los muestra.
  - Equipos marca los sensores con una versión anterior a la del servidor.
- **Esfuerzo:** 1 sesión.

### 2.6 Registro: raíz y valor

- **Raíz `?`:**
  - Al ver un `OpenKey` con base desconocida, se consulta el usuario del proceso que escribe
    (`OpenProcessToken` y `GetTokenInformation(TokenUser)`).
  - Si la ruta relativa empieza por claves que solo existen en la colmena de usuario
    (`Software\Microsoft\Windows\CurrentVersion\Run` existe en las dos), se resuelve como
    `HKU\<SID>`. Si no se puede decidir, se queda `?`.
  - Además, se aprende la colmena de cada base por las claves que se abren bajo ella:
    `Control Panel`, `Environment` o `Volatile Environment` solo existen en una de usuario, y
    `SYSTEM` o `HARDWARE`, en la de máquina.
- **Valor escrito:** se prueba la captura de datos del proveedor. Si no llega, se lee el valor con
  `RegGetValueW` justo después de la escritura, como mejor esfuerzo y marcado como tal
  (`value_source=read-after-write`).
- **Esfuerzo:** 1 sesión.

---

## 3. Detecciones nuevas que salieron de los datos

- **WPAD/LLMNR:**
  - Primero se mide el patrón normal: hoy hay consultas `wpad` corrientes.
  - Alerta cuando `wpad` se resuelve a una IP de la red local que no es el DNS configurado, o cuando
    aparece una respuesta LLMNR o NBT-NS a nombres de servidores internos. El sensor necesitaría el
    evento de respuesta LLMNR (proveedor DNS-Client, eventos de LLMNR).
- **Hecho cuando:** hay una regla con un fixture real del laboratorio (Responder o Inveigh en una
  red aislada y autorizada) y cero alertas en una semana de uso normal.

---

## 4. Escala SOC: miles de equipos

### 4.1 Punto de partida medido

- Portátil en reposo: unos 24 eventos por minuto. Con la agrupación de §2.1, se espera bajar a
  unos 12.
- 5.000 equipos: de 1.000 a 2.000 eventos por segundo, de 85 a 170 millones al día.
- Un motor procesa eso:
  - reglas: FieldMap a 1,7 µs por evento;
  - SQLite por lotes: unos 23.000 eventos por segundo.

  Lo que no aguanta es el **almacenamiento**: 72 horas en SQLite son cientos de millones de filas.
  Tampoco la consola, que hoy lista equipos uno a uno.

### 4.2 Fase A — un nodo, hasta unos 1.000 equipos

- §2.1 y §2.2 reducen el volumen en origen.
- **Límite por sensor:** eventos por segundo con una ráfaga permitida. El sobrante se cuenta en el
  latido y nunca se pierde en silencio.
- **Simulador de flota `cmd/fleetsim`** (Go):
  - reproduce perfiles grabados de pruebas reales (portátil, servidor, controlador de dominio) con
    variación, para 1.000, 5.000 o 10.000 sensores con sus latidos;
  - mide la latencia del evento a la alerta, la CPU y memoria del motor, los descartes y el tiempo
    de la consola;
  - CI nocturno con 1.000 sensores. Objetivo: alerta en menos de 2 segundos (p99) y 0 descartes.

### 4.3 Fase B — separar las piezas, hasta unos 10.000 equipos

```
sensores ──TLS──► pasarelas de ingesta (sin estado, N copias) ──► cola (NATS JetStream)
                                                                    │ partición por equipo
                                                                    ▼
                                               trabajadores de detección (N copias)
                                     reglas, cadenas por equipo, beacons, umbrales, línea base
                                                                    │ alertas y aciertos de reglas
                                                                    ▼
                                    nivel central: correlación entre equipos, incidentes, API
                                       │                                      │
                          PostgreSQL (alertas, incidentes,          ClickHouse (eventos, retención
                          inventario, identidades, cuentas)          por días, compresión ~10×)
```

- **NATS JetStream** antes que Kafka: un solo binario, réplicas, y suficiente para este volumen.
- Las **pasarelas** validan identidades contra PostgreSQL, con una caché que se invalida al revocar.
- Los **trabajadores** reciben siempre los mismos equipos (partición por nombre de equipo), así que
  el estado de correlador, beacons y línea base se queda en memoria local, con una copia periódica
  para recuperarse si cae uno.
- La **correlación entre equipos** solo recibe aciertos de reglas, no eventos en bruto: es poco
  volumen.
- **Modo de un solo equipo:** el binario actual con SQLite sigue existiendo para laboratorios y
  equipos pequeños. Es el mismo código con otro almacenamiento detrás de una interfaz.

### 4.4 Fase C — operar la flota

- **Grupos:** etiquetas manuales, unidad organizativa de AD (si el equipo la declara en el latido) y
  patrones de nombre. Las supresiones, el software conocido, la política de protección (§6) y los
  permisos van por grupo.
- **Equipos a escala:**
  - vista por grupos, con contadores (en línea, sin señal, desactualizados, con eventos perdidos);
  - búsqueda y paginación en el servidor;
  - la ficha de equipo, como hoy.
- **Configuración de sensores por grupo:** capturas, agrupación y límites. El sensor la descarga
  firmada al conectar y en cada latido si cambió. Solo ajustes declarativos.
- **Permisos por grupo:** el rol de analista se acota a uno o varios grupos.

### 4.5 Fase D — triaje a escala

- **Cola por riesgo:** severidad, criticidad del equipo (configurable por grupo; los controladores
  de dominio arriba) y repetición.
- **Incidentes automáticos:** la misma técnica en N equipos en una ventana, o la misma cuenta en
  varios equipos.
- **Tickets:** Jira y ServiceNow, con ida y vuelta de estado.
- **Métricas del SOC:** tiempo hasta el triaje y el cierre, falsos positivos por regla y carga por
  analista.

---

## 5. Forense: vista propia

- **Objetivo:** que las evidencias se puedan buscar, revisar y entregar, no solo abrir desde una
  alerta.
- **Diseño:**
  1. **Índice de paquetes** (en SQLite, o en PostgreSQL en la fase B): id, alerta, equipo, regla,
     severidad, fecha, tamaño y hash. Se expone con `GET /api/forensics?host=&rule=&since=&limit=`.
  2. **Vista «Forense»** en la barra lateral:
     - tabla con filtros;
     - al abrir un paquete: línea de tiempo, **árbol de procesos** (mismo componente que Equipos),
       conexiones y registro;
     - botones de exportar y de «añadir al incidente».
  3. **Cadena de custodia:**
     - al congelar el paquete se calcula su SHA-256 y se firma con una clave Ed25519 del motor
       (generada en la instalación, en `tools\config`);
     - el hash y la firma van a un registro de solo escritura (`forensics-custody.jsonl`);
     - al exportar se verifica, y la consola muestra «íntegro» o «alterado».
  4. **Más contexto:** firmante y hashes de los ejecutables, dominios de las conexiones, claves de
     registro tocadas y ventana configurable (`-forensic-window`, 5 minutos por defecto).
  5. **Retención:** `-forensic-retention 30d` con un limpiador periódico, además del tope de ficheros.
  6. **En el informe del incidente:** un anexo con los paquetes de sus alertas, con sus hashes.
- **Hecho cuando:** desde la vista se encuentra el paquete de una alerta crítica del laboratorio, se
  ve su árbol, se exporta y la verificación da «íntegro». Si se modifica un byte del fichero, da
  «alterado».
- **Esfuerzo:** 2 sesiones.

---

## 6. Prevención y respuesta

### 6.1 Política de protección (la decide el SOC)

Fichero versionado con editor en la consola. Ejemplo:

```yaml
version: 1
kill_switch: false            # true devuelve toda la flota a "observe" al momento
groups:
  - name: puestos
    match: { hostname: 'PC-*' }          # o { ou: 'OU=Puestos,DC=empresa,DC=local' } o { tag: puestos }
    level: prevent-audit                 # observe | recommend | prevent-audit | prevent | respond
    approvals: 1                         # personas que deben aprobar una acción manual
    approvers: [admin]                   # roles de la consola
  - name: servidores
    match: { hostname: 'SRV-*' }
    level: recommend
protected:
  hosts: ['DC-*']                        # nunca se aíslan ni se bloquea nada en ellos sin aprobación
  processes: [lsass.exe, csrss.exe, wininit.exe, services.exe, smss.exe]
playbooks:
  - name: ransomware-aislar
    when: { sequence: 'Preparacion de ransomware', min_severity: critical }
    action: isolate
    scope: [puestos]
    approval: none                       # automática; con 1 o 2 espera aprobación
    limit: { per_hour: 3 }               # pasado el límite, se convierte en una petición manual
maintenance:
  - groups: [servidores]
    every: 'sat 02:00'
    duration: 2h                         # durante la ventana, la prevención pasa a auditoría
```

- **Evaluación:**
  - Cada alerta se compara con los playbooks de su grupo.
  - Una acción automática solo sale si se cumplen todas las condiciones: nivel `respond`, equipo no
    protegido, fuera de mantenimiento, límite no alcanzado y sin interruptor general.
  - Si no se cumplen, queda como **petición** en la consola, con el motivo.
- **Auditoría de la política:** cada versión guardada con autor, fecha y diferencia. Volver a una
  versión anterior es un clic.
- **Distribución a los sensores:** la parte que les toca (nivel, listas de bloqueo y límites),
  firmada con la clave del servidor. El sensor la valida y la guarda en `ProgramData`. Si no puede
  validarla, se queda en el último nivel válido o en `observe`.

### 6.2 Postura de seguridad (nivel 0, solo lectura)

El sensor (en modo servicio, como SYSTEM) comprueba cada hora:

| Comprobación | Cómo se lee | Peso |
|---|---|---|
| Defender activo y en tiempo real | Estado del servicio `WinDefend` (SCM); `HKLM\SOFTWARE\Microsoft\Windows Defender\Real-Time Protection` y la clave de políticas | alto |
| Firmas de Defender al día | WMI `MSFT_MpComputerStatus.AntivirusSignatureAge` | medio |
| Cortafuegos activo en los 3 perfiles | `HKLM\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\*Profile\EnableFirewall`, más las políticas | alto |
| BitLocker en el disco del sistema | WMI `Win32_EncryptableVolume.ProtectionStatus` | medio |
| Actualizaciones | Fecha del último parche (`Win32_QuickFixEngineering`) | medio |
| LSA protegida (RunAsPPL) | `HKLM\SYSTEM\CurrentControlSet\Control\Lsa\RunAsPPL` | medio |
| Credential Guard | WMI `Win32_DeviceGuard.SecurityServicesRunning` | bajo |
| SMBv1 desactivado | `HKLM\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters\SMB1` y la característica opcional | alto |
| RDP con NLA (si RDP está activo) | `…\Terminal Server\fDenyTSConnections` y `…\WinStations\RDP-Tcp\UserAuthentication` | medio |
| UAC activo | `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\EnableLUA` | alto |
| Registro de scripts de PowerShell | `HKLM\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging` | bajo |
| Administradores locales | Miembros de `S-1-5-32-544` (`NetLocalGroupGetMembers`) | informativo |

- La puntuación de 0 a 100 es la suma ponderada.
- Equipos muestra la postura, con historial y recomendaciones en lenguaje claro.
- Hay alerta cuando una comprobación pasa de bien a mal: alguien desactiva Defender o el
  cortafuegos.
- **Hecho cuando:** en el portátil la postura sale correcta. Al desactivar el tiempo real de
  Defender, salta la alerta y la puntuación baja; al reactivarlo, vuelve.
- **Esfuerzo:** 2 sesiones (las lecturas de WMI desde Rust son la parte laboriosa).

### 6.3 Recomendar y simular (niveles 1 y 2)

- **Recomendar.** Desde la postura y las alertas, la consola genera:
  - reglas ASR de Defender en modo auditoría;
  - una política WDAC o AppLocker en modo auditoría (a partir del software visto y conocido);
  - ajustes de cortafuegos.

  Se entregan como ficheros para GPO o Intune, con instrucciones.
- **Simular.** «¿Qué habría pasado?»:
  - se aplica la política a las alertas guardadas de los últimos 30 días (o lo que haya);
  - el informe dice cuántas acciones, en qué equipos, cuáles bloqueadas por equipos protegidos y
    cuáles por el límite por hora;
  - es obligatorio antes de subir un grupo a `prevent` o `respond`: la consola no lo permite sin una
    simulación reciente.
- **Prevenir en auditoría (nivel 2):** el sensor registra «habría parado X» como evento, sin pararlo.

### 6.4 Canal de respuesta y acciones (niveles 3 y 4)

- **Canal:**
  - Hoy el sensor nunca lee después de `AUTH`. Se añade un hilo lector en la misma conexión TLS.
  - El motor envía **órdenes firmadas**:

    ```json
    {"v":1,"id":"…","host":"PC-CONTA-01","action":"isolate","args":{},
     "not_before":"…","expires":"…","nonce":"…","approved_by":["ana","jefa"],"sig":"<ed25519>"}
    ```

  - El sensor comprueba antes de actuar:
    - la firma, con la clave pública del servidor que recibió al darse de alta (§1.2);
    - que la orden va dirigida a él;
    - que no ha caducado (5 minutos como máximo);
    - que no es una repetición (caché de nonces);
    - que su nivel local la permite.

    Si pasa, ejecuta y responde con un evento `response.result`.
- **Acciones, un conjunto cerrado:**

  | Acción | Cómo se hace | Deshacer |
  |---|---|---|
  | `isolate` | Primera versión: perfiles del cortafuegos con bloqueo por defecto de entrada y salida, más permitir el servidor (IP y puerto), DHCP y DNS. Se guardan los valores anteriores. Después, con WFP (subcapa propia), más robusto | `release` restaura los valores guardados. Si el equipo pierde el contacto con el servidor más de X horas (configurable), se libera solo, para no dejar un equipo incomunicado para siempre |
  | `terminate` | `OpenProcess(PROCESS_TERMINATE)` solo si la imagen y el hash coinciden con la orden. Nunca sobre procesos protegidos | — |
  | `quarantine` | Mover el fichero a `ProgramData\bluetardigrade\quarantine` con permisos solo SYSTEM, si el hash coincide; queda registrado | `restore` |
  | `collect` | Paquete forense del equipo: últimos eventos del sensor, procesos en marcha y conexiones | — |

- **Prevenir (nivel 3):** el sensor termina al instante los procesos cuyo hash esté en la lista de
  bloqueo firmada. Desde modo usuario, el proceso alcanza a arrancar unos milisegundos: se documenta
  el límite y se recomienda WDAC para impedirlo antes de ejecutar.
- **Hecho cuando:** en el laboratorio se aísla un equipo, se comprueba que solo habla con el
  servidor y se libera. Además:
  - una orden con firma mala, caducada, repetida o para otro equipo se rechaza y queda registrada;
  - el límite por hora corta un playbook desbocado;
  - el interruptor general lo para todo en menos de 5 segundos.
- **Depende de:** §1.2 (clave del servidor fijada al darse de alta), §6.1 y §6.3.
- **Esfuerzo:** 4–5 sesiones.
- **Riesgos y cómo se evitan:**
  - **Que el servidor comprometido se use contra la flota:** acciones cerradas, aprobación por dos
    personas configurable, límites por hora, equipos protegidos y auditoría en el equipo y el
    servidor.
  - **Aislar un equipo por un falso positivo:** simulación previa, límites y liberación automática.

---

## 7. Varios tardígrados: nodos que se comunican

### 7.1 Federación por sedes (primero)

- **Objetivo:** organizaciones con varias sedes o redes separadas. Cada sede detecta sola y la
  central lo ve todo.
- **Diseño:**
  1. **Identidad de nodo:**
     - cada motor tiene una clave Ed25519 y un certificado de nodo;
     - un nodo de sede se une al central con un token de alta de nodo (como §1.2, pero para nodos);
     - todo el tráfico entre nodos va por HTTPS con TLS mutuo.
  2. **Bandeja de salida:**
     - el nodo de sede escribe en una tabla `outbox` (SQLite) lo que la central debe recibir:
       alertas, cambios de inventario, salud y, opcionalmente, paquetes forenses;
     - lo empuja por lotes a `POST /api/federation/v1/push`;
     - la central descarta duplicados por (nodo, secuencia);
     - si el enlace cae, la sede sigue funcionando y la bandeja se vacía al volver.
  3. **Consulta del detalle:** la consola central lista alertas y equipos de todas las sedes (con
     columna «nodo»). Para ver eventos en bruto o el flujo de una sede, pide al nodo de esa sede
     (`GET /api/federation/v1/nodes/{id}/…`), solo lectura. Si no hay conexión hacia la sede, se dice.
  4. **Configuración compartida:**
     - la central publica versiones firmadas de inteligencia, software conocido, supresiones,
       reglas, política (§6.1) y cuentas;
     - los nodos las piden (`GET /api/federation/v1/config?since=<versión>`) y las aplican si la
       firma es válida;
     - en conflicto gana la central, y lo local queda solo como excepción explícita.
  5. **Correlación entre sedes:** la central recibe los aciertos de reglas de las sedes (para las
     cadenas por cuenta en varios equipos, §cadenas) y las alertas de campaña salen en la central.
  6. **Salud de nodos en la consola:** mapa o lista de nodos con su versión, latencia, tamaño de la
     bandeja, último contacto y equipos.
- **Hecho cuando:** en el laboratorio, con dos motores de sede y uno central:
  - las alertas de ambas sedes se ven en la central;
  - cortar el enlace 10 minutos no pierde nada;
  - un cambio de inteligencia en la central llega a las sedes;
  - la misma cuenta en las dos sedes dispara la cadena entre equipos en la central.
- **Esfuerzo:** 4–5 sesiones.

### 7.2 Clúster en una misma red (después)

- Varios nodos en la misma red se reparten los equipos (es la fase B de §4.3 sin cola externa, para
  instalaciones medianas):
  - pertenencia por un registro en la base de datos central, o por gossip;
  - partición por equipo con hash consistente;
  - si cae un nodo, sus equipos pasan al resto en el siguiente latido;
  - el estado (cadenas, línea base) se reconstruye desde la copia periódica.
- **Riesgo:** dos nodos que creen tener el mismo equipo (red partida). Se evita con un registro
  central con concesiones de tiempo limitado.

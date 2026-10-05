# Flota remota: vigilar varios equipos desde un servidor

bluetardigrade puede recibir la telemetría de los equipos Windows de tu red en
un único servidor (el que ejecuta el motor y la consola). Cada equipo ejecuta el
sensor ETW y envía sus eventos y un **latido** cada minuto. La consola, en
**Equipos**, muestra el inventario: qué equipos informan, desde qué IP, con qué
sensor y sistema, y su estado:

- **En línea**: el latido o la telemetría son recientes.
- **Sin señal**: el sensor envió latidos y dejó de hacerlo. Puede ser un equipo
  apagado o sin red, o un sensor detenido a propósito (lo primero que hace un
  atacante para trabajar sin ser visto). El motor levanta **una alerta «Sensor sin
  señal»** por corte (severidad alta, ATT&CK T1562.001).
- **Inactivo**: equipos sin latido (importaciones, sensores antiguos) que no han
  enviado nada en 10 minutos. Nunca generan alerta.

La relación es solo de ida: los equipos envían datos al servidor. La consola no
se conecta a los equipos ni ejecuta nada en ellos.

> Usa esto solo en equipos que administras. Cada sensor recoge procesos con su
> línea de comandos, conexiones de red y cambios de registro del equipo.

## Cómo se protege la conexión

| Capa | Qué hace |
|---|---|
| Identidad por sensor | Cada equipo tiene su propia credencial, atada a su nombre. Un sensor que intente enviar eventos de otro equipo es rechazado y contado como posible compromiso |
| Aprobación | Un equipo que se da de alta con un token queda **pendiente**: el motor no acepta sus eventos hasta que un administrador lo aprueba en la consola (el sensor los guarda en su disco mientras tanto) |
| Escucha en red solo con autenticación | El lanzador solo abre el motor a la red (`0.0.0.0:7777`) cuando existe el certificado de ingesta o `tools\config\ingest-identities.yaml`; sin ellos, solo escucha en `127.0.0.1` |
| TLS | Con `tools\config\ingest-cert.pem` e `ingest-key.pem` el canal va cifrado, el sensor solo confía en ese certificado y se activa el alta por token. El alta solo se acepta por TLS (o desde el propio servidor): la credencial que entrega no viaja en claro |
| Cortafuegos | Abre el puerto 7777 solo a los perfiles de dominio y privado |

## Alta por token (recomendado)

Sin crear identidades a mano ni copiar YAML:

1. **Una vez, en el servidor:**
   - crea el certificado de ingesta ([más abajo](#certificado-tls-del-servidor));
   - reinicia con `sf-console -Stop; sf-console`.

   El motor escucha en la red con TLS y con el alta por token activada.
2. **En la consola**, ve a **Equipos → Añadir equipos → Con token de alta**:
   - pon para qué es (por ejemplo «Aula 3»);
   - indica cuántos equipos pueden usarlo: uno por defecto, o varios para un despliegue;
   - elige cuánto dura: 24 horas, 7 días o 30 días;
   - opcionalmente, un patrón de nombres que entran sin aprobación, como `PC-CONTA-*`.

   El token se muestra **una sola vez**, con los comandos ya preparados.
3. **En el equipo nuevo**, en un PowerShell de administrador:
   - copia `security-sensor.exe` e `ingest-cert.pem`;
   - crea la carpeta de datos, solo para SYSTEM y Administradores;
   - arranca el sensor con `--enroll-token`.

   Si el equipo tiene bluetardigrade instalado, basta con:

   ```powershell
   sf-etw -Install -Addr 192.168.1.10:7777 -EnrollToken <token> -TlsCa <ruta>\ingest-cert.pem
   ```

   Así queda como servicio de Windows.
4. **Primer arranque del sensor:**
   - cambia el token por una credencial propia;
   - la guarda en `C:\ProgramData\bluetardigrade\sensor\ingest.token`;
   - borra el token de su disco.

   El equipo aparece en **Equipos → Pendientes de aprobación** con su IP y la
   hora del último intento.
5. **Aprueba o rechaza.** Al aprobarlo, el sensor entrega lo que tenía guardado
   y empieza a enviar en directo.

Detalles:

- Un token de un solo uso no sirve para un segundo equipo. Un token caducado,
  agotado o revocado se rechaza y el sensor dice por qué.
- Si ya hay otro sensor informando con el mismo nombre de equipo, el alta nunca
  se aprueba sola, aunque el patrón coincida: es una reinstalación o alguien
  haciéndose pasar por ese equipo. La consola lo avisa.
- **Revocar** un equipo, desde su ficha en Equipos, deja de aceptar su
  credencial al momento y corta su conexión abierta.
- **El sensor del propio servidor** también necesita credencial cuando el motor
  escucha en la red. Dalo de alta igual, con un token y
  `sf-etw -Install -EnrollToken <token>`; en el propio servidor no hace falta
  `-TlsCa`.
- Solo un **administrador** de la consola crea tokens y aprueba equipos. Cada
  acción queda en la auditoría de la consola y en el log del motor.

## Alta manual con identidad en fichero

En la consola, **Equipos → Añadir equipos → Manual** genera estos comandos ya
rellenados con el nombre del equipo y la IP del servidor.

### En el servidor (PowerShell normal)

1. Crea la identidad del equipo. El token se muestra **una sola vez**: cópialo.

   ```powershell
   sf-engine ingest-identity --name pc-conta-01 --host PC-CONTA-01
   ```

2. Pega la entrada YAML que imprime en el fichero de identidades. La primera vez,
   el fichero empieza así:

   ```yaml
   version: 1
   identities:
     - name: pc-conta-01
       token_sha256: <la huella que imprimió el comando>
       hosts: ["PC-CONTA-01"]
   ```

   ```powershell
   notepad "$env:LOCALAPPDATA\bluetardigrade\tools\config\ingest-identities.yaml"
   ```

   El motor recarga el fichero solo cada 15 s. Comprueba que está bien escrito
   antes de reiniciar: si el fichero está mal, el motor no arranca.

   ```powershell
   sf-engine doctor
   ```

   Debe decir «Identidades de sensores: 1 identidad de sensor valida».

3. **Solo la primera vez**, reinicia para que el motor escuche a la red:

   ```powershell
   sf-console -Stop; sf-console
   ```

   A partir de este momento también el sensor del propio servidor necesita
   credencial: crea una identidad para el servidor o deja el token compartido en
   `tools\config\ingest.token`.

### En el servidor (PowerShell de administrador, solo la primera vez)

4. Abre el puerto 7777 a la red local:

   ```powershell
   New-NetFirewallRule -DisplayName "bluetardigrade ingest" -Direction Inbound -Protocol TCP -LocalPort 7777 -Action Allow -Profile Domain,Private
   ```

### En el equipo remoto (PowerShell de administrador)

5. Copia del servidor el archivo `bin\security-sensor.exe` (y, con TLS,
   `tools\config\ingest-cert.pem`) a `C:\Program Files\bluetardigrade\` en el
   equipo, por ejemplo con una carpeta compartida.

   ```powershell
   New-Item -ItemType Directory -Force "C:\Program Files\bluetardigrade"
   ```

6. Arranca el sensor apuntando al servidor con el token de su identidad:

   ```powershell
   & "C:\Program Files\bluetardigrade\security-sensor.exe" --addr 192.168.1.10:7777 --token "<token>" --tls-ca "C:\Program Files\bluetardigrade\ingest-cert.pem" --spool "C:\ProgramData\bluetardigrade\sensor-spool.ndjson"
   ```

   Sin TLS, quita `--tls-ca ...`. En menos de un minuto el equipo aparece en
   **Equipos** como «en línea», con su sistema operativo y su IP.

### Que el sensor arranque con el equipo

Para un servicio permanente, crea una tarea programada que arranque el sensor
como SYSTEM al iniciar el equipo (PowerShell de administrador en el equipo
remoto). La definición de la tarea, con su token, solo la pueden leer los
administradores del equipo.

```powershell
$sensorArgs = '--addr 192.168.1.10:7777 --token "<token>" --tls-ca "C:\Program Files\bluetardigrade\ingest-cert.pem" --spool "C:\ProgramData\bluetardigrade\sensor-spool.ndjson"'
$action = New-ScheduledTaskAction -Execute 'C:\Program Files\bluetardigrade\security-sensor.exe' -Argument $sensorArgs
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'bluetardigrade sensor' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest
Start-ScheduledTask -TaskName 'bluetardigrade sensor'
```

Si el sensor se detiene, la tarea lo reinicia, y mientras tanto el servidor
avisa con «Sensor sin señal».

## Certificado TLS del servidor

El motor necesita un certificado y su clave en PEM. Con el `openssl` que trae Git
para Windows (PowerShell normal en el servidor, cambiando la IP por la del
servidor):

```powershell
$cfg = "$env:LOCALAPPDATA\bluetardigrade\tools\config"
& "C:\Program Files\Git\usr\bin\openssl.exe" req -x509 -newkey rsa:3072 -sha256 -days 825 -nodes -keyout "$cfg\ingest-key.pem" -out "$cfg\ingest-cert.pem" -subj "/CN=bluetardigrade-ingest" -addext "subjectAltName=IP:192.168.1.10,IP:127.0.0.1" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign" -addext "extendedKeyUsage=serverAuth"
```

- `IP:127.0.0.1` deja que el sensor del propio servidor conecte también por TLS:
  con el certificado puesto, el motor ya no acepta conexiones sin cifrar.
  `sf-etw -Install` en el servidor confía en ese certificado sin más.
- Reinicia el motor (`sf-console -Stop; sf-console`) para que use TLS.
- Copia **solo** `ingest-cert.pem` a los equipos; la clave (`ingest-key.pem`) no
  sale nunca del servidor.
- El motor recarga el certificado en caliente si lo renuevas con el mismo nombre.

## Mantenimiento

- **Dar de baja un equipo dado de alta por token**: en su ficha de Equipos,
  «Revocar identidad». Para volver a darlo de alta hace falta un token nuevo.
- **Dar de baja un equipo**: borra su entrada del fichero de identidades (se aplica
  sola) y detén su tarea. El inventario lo olvida a los 7 días sin noticias o al
  reiniciar el motor.
- **Mantenimiento planificado**: para que un equipo que se apaga a propósito no
  alerte, crea una supresión de la regla `fleet-sensor-silent` para ese equipo,
  con caducidad (consola: Detección → Supresiones, o desde la propia alerta).
- **Rotar un token**: genera una identidad nueva con el mismo nombre de equipo,
  sustituye la entrada y actualiza el token en la tarea del equipo.

## API

`GET /api/fleet` devuelve el inventario (equipos, estado, último latido, sensor,
IPs de conexión e identidad). Para el alta por token:
- `GET /api/enroll` da los tokens (sin su secreto) y los equipos dados de alta,
  con su estado;
- las escrituras son `POST /api/enroll/tokens`, `POST /api/enroll/tokens/{id}/revoke`
  y `POST /api/enroll/hosts/{nombre}/approve|reject|revoke`. Exigen el token de la
  API. Los latidos (`sensor.heartbeat`) los consume el
motor y no llegan a las reglas, a los búferes ni al almacenamiento.

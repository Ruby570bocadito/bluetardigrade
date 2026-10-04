# Pruebas pendientes en Windows (rama `feat/soc-dashboard-readme`)

Comprobado automáticamente:
- pruebas de Go, de la consola, del hub y del sensor (Linux y Windows), con clippy limpio;
- DOM, Chromium y analista;
- lanzador y sintaxis de PowerShell.

En el laboratorio local, con motor real y navegador, se probó además:
- la inteligencia (IP, rango, dominio con subdominio y hash);
- la línea base (aprender, avisar y recordar tras reiniciar);
- la pestaña Inteligencia, las cadenas entre equipos y el informe del incidente;
- las cuentas con roles: el lector es rechazado y el triaje queda firmado con la
  cuenta, no con «consola».

Lo de esta lista necesita **tu Windows real**: privilegios de administrador,
Sysmon o un segundo equipo. Marca cada casilla al terminar.

Notación: **[normal]** = PowerShell normal; **[admin]** = PowerShell abierta como
administrador; **[otro equipo]** = el equipo remoto. Pega los comandos de uno en uno.

## 0. Antes de empezar

- [ ] **[normal]** La consola responde y el motor es el nuevo:
  `sf-console -Status`, luego abre <http://localhost:3000>.
- [ ] La barra lateral tiene: Panel, Flujo en vivo, Alertas, Incidentes, Equipos,
  Detección, Respuesta activa y Analista IA.

## 1. Consola: funciones nuevas

- [ ] **Selección múltiple (Alertas):**
  - Marca 2 o 3 casillas: aparece la barra «N seleccionadas».
  - Prueba Reconocer con una nota: las alertas pasan a «reconocida».
- [ ] **Añadir a incidente:**
  - Desde la barra, crea un incidente nuevo y pulsa «Abrir incidente».
  - Se ve el caso con sus alertas, el grafo y la línea de tiempo.
- [ ] **Incidentes:**
  - Cambia el estado a «Investigando» y pon responsable y resumen.
  - Añade una nota: aparece en la línea de tiempo.
  - Recarga la página: sigue igual, porque se guarda en el motor.
- [ ] **Suprimir:**
  - En el detalle de una alerta, pulsa «Suprimir en este equipo», con motivo y 24 horas.
  - Aparece en Detección → Supresiones con su caducidad.
- [ ] **Probador** (Detección → Probador): el ejemplo «Descarga con certutil» debe
  devolver la regla «Descarga con certutil o bitsadmin».
- [ ] **Avisos:**
  - Pulsa la campana de la cabecera, activa «Notificación del navegador» y acepta el permiso.
  - Pulsa «Probar sonido».
  - Con una alerta crítica nueva (paso 2), debe salir el aviso de Windows.
- [ ] **Modo NOC:**
  - Pulsa el botón del monitor en la cabecera (o `Ctrl+K` y escribe «noc»).
  - Debe ir a pantalla completa y rotar cada 20 s.
  - Las flechas cambian de pantalla, Espacio pausa y Esc sale.
- [ ] **Chip de sesión (cabecera):**
  - Muestra «local · Administrador».
  - Al pulsarlo se abre un panel con tus permisos y «Auditoría de la consola».
  - Tras reconocer una alerta, pulsa «Actualizar»: la acción aparece como «Triaje de alerta · Hecho».
- [ ] **Informe del incidente:**
  - En un incidente, pulsa «Informe .md» y luego «Informe imprimible».
  - Abre el `.html` descargado: se ve el caso con el grafo y la línea de tiempo.
  - El botón «Imprimir / guardar PDF» abre el diálogo de impresión.
  - El grafo del incidente solo muestra los equipos del caso, no los demás.
- [ ] **Detección → Inteligencia:** la pestaña existe (también `g l` o `Ctrl+K` «inteligencia»).
  Sin listas, dice cómo añadirlas. La tarjeta «Equipos en línea base» cuenta al menos 1.
- [ ] **Chip «detectores» (cabecera):**
  - Al pulsarlo se abre un panel completo, no recortado, con Correlador, Beaconing, Umbrales y Línea base.
  - Inteligencia solo aparece si hay listas cargadas.
  - Pulsar la fila «Correlador» lleva a Detección → Cadenas.
  - El panel de la campana de avisos también se ve entero.
- [ ] **Detección → Cadenas:**
  - Aparecen «Credenciales y ejecucion remota en varios equipos» y «Cuenta saltando entre equipos».
  - Ambas con la etiqueta «misma cuenta en N equipos o más».
  - Cada paso muestra sus alternativas (por ejemplo, «5 alternativas»).

## 2. Sensor ETW con red, registro y latido

- [ ] **[admin]** Arranca el sensor (déjalo abierto):

  ```powershell
  & "$env:LOCALAPPDATA\bluetardigrade\bin\security-sensor.exe" --addr 127.0.0.1:7777 --spool "$env:LOCALAPPDATA\bluetardigrade\spool\sensor.ndjson"
  ```

  La primera línea debe terminar en `capture=process+sha256+network+dns+registry`.
- [ ] **[normal]** Red: `Test-NetConnection example.com -Port 443`. En Flujo en vivo
  aparece un `network.connect` de `powershell.exe` hacia el puerto 443. **Nuevo:** en
  su detalle, `domain` debe ser `example.com`, porque el sensor recuerda la respuesta DNS.
- [ ] **[normal]** DNS: `Resolve-DnsName example.org`. Aparece un `network.connect`
  con protocolo `dns`, dominio `example.org`, una IP de respuesta y `dns_status` 0.
  Si repites el comando en menos de un minuto, no sale otro: es intencionado.
  Si esperas más de un minuto sin repetirlo, la siguiente vez sí sale.
- [ ] **[normal]** Ruta y hash del ejecutable. Ejecuta `whoami` y luego:

  ```powershell
  (Get-FileHash C:\Windows\System32\whoami.exe).Hash.ToLower()
  ```

  En Flujo en vivo, el `process.create` de `whoami.exe` debe tener
  `image = C:\Windows\System32\whoami.exe` y `hashes.sha256` igual al valor del comando.
- [ ] Nombres largos: busca en Flujo en vivo un `RuntimeBroker.exe` o `SearchProtocolHost.exe`.
  El nombre debe salir completo, no cortado a 14 letras (`RuntimeBroker.`).
- [ ] Con el sensor en marcha, el Administrador de tareas no debe mostrar más de un
  par de % de CPU para `security-sensor.exe` en reposo.
- [ ] **[normal]** Registro (inofensivo). Debe saltar «Persistencia en clave Run via registro».
  Si la ventana de PowerShell ya estaba abierta antes de arrancar el sensor, la clave sale como
  `?\Software\Microsoft\Windows\CurrentVersion\Run`: el `?` indica que la raíz (HKCU) no se pudo
  resolver, y es normal.

  ```powershell
  New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'bt-prueba' -Value 'C:\Windows\notepad.exe' -PropertyType String -Force
  ```

- [ ] **[normal]** Borra la prueba:

  ```powershell
  Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'bt-prueba'
  ```

- [ ] **Latido (Equipos):**
  - Tu equipo aparece «en línea», con el sensor `etw`, tu versión de Windows y
    «Último latido hace menos de 1 min».
- [ ] **Sensor sin señal:**
  - Cierra la ventana del sensor (Ctrl+C) y espera 3 o 4 minutos.
  - En Equipos tu equipo pasa a «sin señal», con un contador rojo en la barra
    lateral, y en Alertas aparece «Sensor sin señal» (alta).
  - Vuelve a arrancar el sensor: el equipo vuelve a «en línea».
- [ ] **El inventario sobrevive a un reinicio del motor (con el sensor en marcha):**
  - **[normal]** `sf-console -Stop; sf-console`
  - Equipos muestra tu equipo enseguida, sin esperar al siguiente latido.
  - Durante los 3 minutos siguientes **no** debe aparecer «Sensor sin señal».
- [ ] **Tras Ctrl+C no queda ninguna sesión ETW abierta:**
  - **[admin]** Ejecuta `logman query -ets`.
  - En la lista no deben aparecer `bluetardigrade-sensor` ni `bluetardigrade-sensor-netreg`.

## 3. Sensor de Sysmon (corregido)

Su bucle en vivo llamaba a un método que .NET no tiene. Se ha cambiado por una
lectura por número de registro, y ahora también envía latido.

- [ ] **[admin]** Si no tienes Sysmon: `sf-sensor -SetupSysmon`.
- [ ] **[normal]** Ejecuta `sf-sensor`:
  - Los eventos salen al momento.
  - **No** debe repetirse «stream interrupted» cada 5 segundos.
- [ ] En Equipos, tu equipo muestra también la fuente `sysmon`.
- [ ] **[normal]** Con `sf-sensor` en marcha, `Resolve-DnsName example.org`. En Flujo en vivo,
  el `network.connect` con protocolo `dns` debe llevar también una IP de destino (antes
  salía vacía).

## 4. Flota remota (con un segundo equipo)

Guía completa: [FLOTA-REMOTA.md](FLOTA-REMOTA.md). En la consola: Equipos → «Añadir
equipo remoto», que genera todos los comandos.

- [ ] **[normal]** Identidad: `sf-engine ingest-identity --name pc-prueba --host <NOMBRE-DEL-OTRO-EQUIPO>`.
  Guarda el token.
- [ ] **[normal]** Pega la entrada en `tools\config\ingest-identities.yaml` (el
  asistente lo abre con notepad).
- [ ] **[normal]** `sf-engine doctor` dice «Identidades de sensores: 1 identidad de sensor
  valida». Si dice «El motor no arrancaria», corrige el fichero antes de seguir.
- [ ] **[normal]** `sf-console -Stop; sf-console`
- [ ] **[normal]** Comprueba que el motor escucha en la red: `netstat -ano | findstr :7777`
  debe mostrar `0.0.0.0:7777`.
- [ ] El sensor de **este** equipo necesita ahora token: crea también una identidad
  para él, o arráncalo con `--token`.
- [ ] **[admin]** Cortafuegos:

  ```powershell
  New-NetFirewallRule -DisplayName "bluetardigrade ingest" -Direction Inbound -Protocol TCP -LocalPort 7777 -Action Allow -Profile Domain,Private
  ```

- [ ] **[otro equipo, admin]** Copia allí `security-sensor.exe` y arráncalo con
  `--addr <IP-del-servidor>:7777 --token "<token>"`. Debe aparecer en Equipos «en
  línea», con la IP del otro equipo en «Conexión desde».
- [ ] **Seguridad:** en el otro equipo, arranca el sensor con un token falso. Debe ser
  rechazado y el equipo no debe aparecer.
- [ ] **TLS (opcional):**
  - Crea el certificado con el comando de FLOTA-REMOTA.md y reinicia.
  - Copia `ingest-cert.pem` al otro equipo y añade `--tls-ca` al sensor.
  - Debe conectar igual. Sin `--tls-ca` debe fallar.
- [ ] **Tarea programada** (FLOTA-REMOTA.md): reinicia el otro equipo; el sensor debe
  arrancar solo y el equipo volver a «en línea».

## 5. Inteligencia offline (listas locales)

El motor no descarga listas: lee los ficheros que dejes en la carpeta `intel`.
Formato en `intel\README.md`. Con el sensor ETW en marcha:

- [ ] **[normal]** Crea una lista de prueba con un dominio y el hash de `charmap.exe`:

  ```powershell
  Set-Content -Path "$env:LOCALAPPDATA\bluetardigrade\intel\prueba.txt" -Value @('# lista de prueba', 'example.net', (Get-FileHash C:\Windows\System32\charmap.exe).Hash)
  ```

- [ ] En unos 15 s, Detección → Inteligencia muestra la lista `prueba` con «Dominios 1» y «Hashes 1».
- [ ] **[normal]** `Resolve-DnsName www.example.net`: salta «Indicador de amenaza conocido»
  (alta, regla `intel-match-prueba`) por el dominio, aunque la lista diga solo `example.net`.
- [ ] **[normal]** `Start-Process charmap`: salta otra alerta, esta vez por el hash.
  Cierra el Mapa de caracteres.
- [ ] Las coincidencias aparecen en «Últimas coincidencias y procesos nuevos».
- [ ] **[normal]** `sf-engine doctor` muestra «Inteligencia: 2 indicadores en 1 lista».
- [ ] El chip «detectores» de la cabecera se pone ámbar y su fila Inteligencia cuenta las coincidencias.
- [ ] **[normal]** Borra la lista. La pestaña vuelve a «Sin listas» en unos 15 s:

  ```powershell
  Remove-Item "$env:LOCALAPPDATA\bluetardigrade\intel\prueba.txt"
  ```

## 6. Línea base: proceso nunca visto

Por defecto aprende durante 24 horas. Para probarlo, se acorta a 3 minutos y luego
se deja como estaba.

- [ ] **[normal]** Acorta el aprendizaje y reinicia:

  ```powershell
  Set-Content "$env:LOCALAPPDATA\bluetardigrade\tools\config\baseline.learn" '3m'; sf-console -Stop; sf-console
  ```

- [ ] Detección → Inteligencia, tarjeta «Equipos en línea base»: dice «periodo 3 min».
- [ ] Con el sensor en marcha, usa el equipo 3 o 4 minutos y luego ejecuta `winver`.
  Debe salir «Proceso nunca visto en este equipo» (baja), con la ruta
  `C:\Windows\System32\winver.exe`. Si ya habías ejecutado `winver`, prueba con `msinfo32`.
- [ ] Ejecuta `winver` otra vez: **no** sale otra alerta (solo la primera vez).
- [ ] En Equipos, abre tu equipo. La tarjeta «Línea base de procesos»:
  - dice «Activa»;
  - lista los procesos conocidos (escribe `winver` en el filtro);
  - muestra arriba el proceso nuevo, que al pulsarlo abre su alerta.
- [ ] **[normal]** `sf-engine doctor` muestra «Linea base: Aprendizaje de 3m0s
  (tools/config/baseline.learn)».
- [ ] **[normal]** Vuelve a las 24 horas:

  ```powershell
  Remove-Item "$env:LOCALAPPDATA\bluetardigrade\tools\config\baseline.learn"; sf-console -Stop; sf-console
  ```

## 7. Cuentas de analista y roles en la consola (opcional)

Sin el fichero de cuentas, la consola sigue como siempre. Con él, cada persona entra con su
usuario y queda registrado quién hace cada cosa.

- [ ] **[normal]** Crea una cuenta de administrador y otra de solo lectura. Cada comando
  pide una contraseña de al menos 12 caracteres e imprime una línea que empieza por `{"user"`:

  ```powershell
  & "$env:LOCALAPPDATA\bluetardigrade\tools\bun.exe" "$env:LOCALAPPDATA\bluetardigrade\web\console\scripts\console-user.mjs" jefa admin
  ```

  ```powershell
  & "$env:LOCALAPPDATA\bluetardigrade\tools\bun.exe" "$env:LOCALAPPDATA\bluetardigrade\web\console\scripts\console-user.mjs" luis viewer
  ```

- [ ] **[normal]** Abre el fichero de cuentas:
  `notepad "$env:LOCALAPPDATA\bluetardigrade\tools\config\console-users.json"`.
  Escribe `{"users": [LINEA1, LINEA2]}`, cambiando LINEA1 y LINEA2 por las dos líneas
  anteriores. Guarda el fichero.
- [ ] **[normal]** `sf-engine doctor` debe decir «Cuentas de la consola: 2 cuentas
  (administradores 1, analistas 0, lectores 1)». Si dice «la consola quedaria bloqueada»,
  corrige lo que indique antes de seguir.
- [ ] **[normal]** `sf-console -Stop; sf-console`
- [ ] El navegador pide usuario y contraseña. Con una contraseña mala no entra.
- [ ] Entra como `luis`:
  - La cabecera dice «luis · Lector» y debajo sale «Modo lectura…».
  - Al intentar reconocer una alerta sale «Tu cuenta (luis, lector) no puede hacer esto…».
- [ ] Entra como `jefa` (ventana de incógnito):
  - Reconoce una alerta. En su detalle, en «Ciclo de vida», junto al id sale `· jefa`, no `· consola`.
  - En el chip de sesión, la auditoría muestra el intento denegado de `luis` y la acción de `jefa`.
- [ ] El fichero `"$env:LOCALAPPDATA\bluetardigrade\data\console-audit.jsonl"` tiene esas líneas.
- [ ] **[normal]** Para volver a la consola sin cuentas, borra el fichero y reinicia:

  ```powershell
  Remove-Item "$env:LOCALAPPDATA\bluetardigrade\tools\config\console-users.json"; sf-console -Stop; sf-console
  ```

- [ ] En la misma ventana de PowerShell, la consola vuelve a abrir sin pedir contraseña
  y la cabecera dice «local · Administrador».

## 8. Reputación por hash (solo si tienes clave de VirusTotal)

- [ ] Con `SF_VT_API_KEY` configurada, abre una alerta de un proceso del sensor ETW.
  En «Reputación» aparece una fila «SHA-256» con el hash y su botón «Consultar».

## 9. Al terminar

- [ ] Si algo falla, copia lo que muestre la ventana del sensor o la consola y pégamelo.
- [ ] Subir a GitHub (WSL):
  `cd /mnt/c/Users/rby/Desktop/Proyectos/Testing/bluetardigrade && git push origin feat/soc-dashboard-readme`.
  Después, PR con «Create a merge commit».
- [ ] Revocar el token de GitHub que se pegó en el chat al principio.

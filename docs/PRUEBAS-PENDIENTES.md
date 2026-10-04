# Pruebas pendientes en Windows (rama `feat/soc-dashboard-readme`)

Lo que ya está comprobado automáticamente: pruebas de Go, de la consola, del hub,
del sensor (Linux y Windows), DOM, Chromium y del lanzador. Se probó además en un
laboratorio local con motor real.

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

## 2. Sensor ETW con red, registro y latido

- [ ] **[admin]** Arranca el sensor (déjalo abierto):

  ```powershell
  & "$env:LOCALAPPDATA\bluetardigrade\bin\security-sensor.exe" --addr 127.0.0.1:7777 --spool "$env:LOCALAPPDATA\bluetardigrade\spool\sensor.ndjson"
  ```

  La primera línea debe terminar en `capture=process+network+registry`.
- [ ] **[normal]** Red: `Test-NetConnection example.com -Port 443`. En Flujo en vivo
  aparece un `network.connect` de `powershell.exe` hacia el puerto 443.
- [ ] **[normal]** Registro (inofensivo). Debe saltar «Persistencia en clave Run via registro»:

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

## 4. Flota remota (con un segundo equipo)

Guía completa: [FLOTA-REMOTA.md](FLOTA-REMOTA.md). En la consola: Equipos → «Añadir
equipo remoto», que genera todos los comandos.

- [ ] **[normal]** Identidad: `sf-engine ingest-identity --name pc-prueba --host <NOMBRE-DEL-OTRO-EQUIPO>`.
  Guarda el token.
- [ ] **[normal]** Pega la entrada en `tools\config\ingest-identities.yaml` (el
  asistente lo abre con notepad), y luego `sf-console -Stop; sf-console`.
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

## 5. Al terminar

- [ ] Si algo falla, copia lo que muestre la ventana del sensor o la consola y pégamelo.
- [ ] Subir a GitHub (WSL):
  `cd /mnt/c/Users/rby/Desktop/Proyectos/Testing/bluetardigrade && git push origin feat/soc-dashboard-readme`.
  Después, PR con «Create a merge commit».
- [ ] Revocar el token de GitHub que se pegó en el chat al principio.

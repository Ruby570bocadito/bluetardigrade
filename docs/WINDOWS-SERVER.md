# Despliegue sin sesión interactiva en Windows Server

El modo `-Server` usa el **Programador de tareas integrado**, con arranque del sistema y cuenta SYSTEM. No registra `engine.exe` como servicio SCM: el motor no implementa todavía ese protocolo. [Microsoft permite que las tareas con principal de servicio se ejecuten sin sesión iniciada](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal?view=windowsserver2025-ps).

Este despliegue necesita Windows de 64 bits, PowerShell 5.1 o posterior, una consola elevada y un directorio dedicado bajo `%ProgramData%`. Windows Server 2022/2025 son los objetivos de validación; el proyecto no certifica todavía su ejecución en una VM Server limpia. En Server Core no se necesita navegador: la consola web se consulta desde un cliente autorizado.

La política persistente de la máquina debe autorizar los PS1 usados por las tareas. El registrador detecta `Restricted`, exige firmas válidas con `AllSigned` y conserva los marcadores de Internet con `RemoteSigned`. No hereda ni añade un `ExecutionPolicy` temporal del instalador. Que las firmas sean válidas no demuestra autorización bajo una política App Control corporativa; el administrador debe aprobar el editor.

Si la máquina no tiene una política definida, se aplica el [valor predeterminado documentado por Microsoft](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1): `Restricted` en Windows cliente y `RemoteSigned` en Windows Server. Server Core puede presentar limitaciones adicionales de validación de zona sin Windows Shell; valida un paquete firmado y su política `AllSigned` con el administrador, sin cambiar protecciones desde el instalador.

## Instalar y arrancar

Descarga/revisa una distribución que tu política de aplicación permita. Si Windows bloquea sus archivos, resuelve la firma/autorización mediante [SMART-APP-CONTROL.md](SMART-APP-CONTROL.md) antes de continuar. El instalador de fuentes genera binarios sin firma.

En PowerShell **elevado**, desde una copia aprobada del proyecto:

```powershell
# Motor, hub y consola; no instala Sysmon ni genera eventos.
.\install.ps1 -Server -InstallDir C:\ProgramData\bluetardigrade

# Alternativa para servidor sin consola web.
.\install.ps1 -Server -NoConsole -InstallDir C:\ProgramData\bluetardigrade

$serverRoot = 'C:\ProgramData\bluetardigrade'
& "$serverRoot\scripts\server.ps1" -InstallDir $serverRoot -Action Start
& "$serverRoot\scripts\server.ps1" -InstallDir $serverRoot -Action Status
& "$serverRoot\bin\engine.exe" doctor -root $serverRoot
```

Se registran tareas `bluetardigrade-server-engine`, `-hub` y `-console` según los componentes construidos. Arrancan 30 segundos después del inicio del sistema. Cada acción mantiene su proceso en primer plano; el Programador de tareas [reintenta fallos](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset?view=windowsserver2025-ps) hasta diez veces, cada minuto, sin un límite de tres días para su ejecución. Consulta el estado y el resultado de la tarea si deja de estar en ejecución; no hay supervisión infinita.

El modo Server exige runtimes Node/Bun portables dentro del directorio protegido; no depende del PATH o del perfil de un usuario. Antes de crear tareas SYSTEM restringe código, estado y credenciales a **Administrators y SYSTEM**. Rechaza junctions/symlinks para evitar que un directorio modificable por otro usuario sustituya código privilegiado. Los operadores necesitan una sesión autorizada para administrar esos archivos.

## Telemetría, estado y acceso

Las conexiones permanecen en loopback: ingesta `127.0.0.1:7777`, API `127.0.0.1:7778`, hub `127.0.0.1:3003` y consola `127.0.0.1:3000`. No se abre el dashboard ni se publica en la red. Para acceso desde un cliente usa un túnel administrativo autorizado o un proxy con autenticación/TLS revisado por tu organización. El modo Server no convierte `-Firewall` en una configuración de captación remota.

El motor persiste eventos y alertas en `run\soc.db` con la retención de 72 horas del motor. Se generan credenciales aleatorias de 256 bits, si no existen, en `tools\config\ingest.token` y `api.token`; motor, sensor, hub y consola leen los mismos archivos. Los valores no aparecen en los argumentos de las tareas. Las claves de proveedores IA deben configurarse explícitamente para la cuenta/proceso de servicio; no se heredan del perfil interactivo. La configuración de las tareas se conserva en `tools\config\server.json` durante una actualización.

Por defecto **no se registra un sensor local**. Para Sysmon, despliega primero el Sysmon firmado de Microsoft y una configuración autorizada; luego:

```powershell
.\install.ps1 -Update -Server -ServerSensor sysmon -InstallDir C:\ProgramData\bluetardigrade
# ETW opcional; requiere Rust/MSVC en el host de compilacion autorizado.
.\install.ps1 -Update -Server -WithSensor -ServerSensor etw -InstallDir C:\ProgramData\bluetardigrade
```

Registrar un sensor no certifica que capture todos los tipos de eventos. El sensor Rust actual captura creación de procesos; Sysmon depende de la configuración aplicada. Las validaciones de captación, reinicio, desconexión y carga requieren una VM Windows Server con actividad real y evidencias conservadas.

## Revisar, actualizar y retirar

```powershell
# Vista de acciones prevista: no cambia ACL, credenciales ni tareas.
& "$serverRoot\scripts\server.ps1" -InstallDir $serverRoot -Plan -WithConsole -Sensor sysmon
& "$serverRoot\scripts\server.ps1" -InstallDir $serverRoot -Action Stop
.\install.ps1 -Update -Server -InstallDir $serverRoot
& "$serverRoot\scripts\server.ps1" -InstallDir $serverRoot -Action Start
# Desinstalacion elevada: retira tareas antes de borrar el codigo.
& "$serverRoot\uninstall.ps1" -InstallDir $serverRoot
```

Una actualización detiene las tareas gestionadas antes de modificar sus fuentes; si la compilación falla, revisa el error antes de volver a arrancar. Se preservan las credenciales/configuración en `tools\config`. El nombre de tarea ya ocupado por otra instalación produce un error y no se sobrescribe.

Los lanzadores guardan transcripciones en `run\server-<componente>.log`. Al arrancar rotan un archivo de más de 20 MiB a `.previous`; una ejecución larga puede seguir ampliándolo, así que planifica almacenamiento/retención. No sustituyen la evidencia del motor. `scripts/windows/check-server-deployment.ps1` valida la definición de tareas y fallos mediante dobles aislados; no instala tareas, servicios, reglas de firewall ni Sysmon en el equipo que ejecuta las pruebas.

`scripts/windows/smoke-server-runner.ps1` también prueba el lanzador real con la cuenta actual y una instalación desechable dentro del workspace: comprueba el proceso en primer plano, rechazos de credenciales, un evento inerte identificado como prueba, SQLite, transcripción y salida que permite recuperación. Exige los puertos 7777/7778 libres y termina solo los procesos propios de esa fixture. Esta comprobación se ha ejecutado en PowerShell 5.1; no demuestra arranque al reiniciar un Server ni el contexto SYSTEM, que quedan para la validación en VM.

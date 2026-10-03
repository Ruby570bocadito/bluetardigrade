# Instalación, retirada de demo y estado SOC

Revisión del 2 de octubre de 2026. El incremento anterior está entregado;
el proyecto sigue en fase pre-1.0 para laboratorio y validación. No se
considera una plataforma SOC terminada ni certificada para producción.

## Fallos corregidos del instalador

- Se convierte la salida nativa de array a texto y se parsea con regex.
  `-match` sobre arrays no rellena `$Matches`: podía detectar mal Go/Node
  o reutilizar capturas anteriores. Se comprueba el exit code real y se
  mantiene la compatibilidad de stderr con PowerShell 5.1.
- Se comprueba que los portables puedan arrancar y cumplan Go 1.26+,
  Node 20.9+ y la versión mínima de Bun. Bun portable usa baseline
  para reducir requisitos de CPU; siguen aplicando los mínimos del proveedor.
- Los índices de hashes entregados como bytes HTTP se decodifican y se
  admiten finales CRLF, validando 64 dígitos hexadecimales. El fallo de esa
  lectura impedía instalar Bun en PowerShell 5.1. La verificación sigue obligatoria.
- `-NoConsole` omite Node/Bun. Los installs de consola usan lockfile
  congelado. Un fallo deja estado incompleto y error, sin activar autostart
  de la consola ni anunciar que se instaló correctamente.
- Git actualiza por fast-forward y rechaza cambios locales o divergencia
  antes de parar servicios. No ejecuta `reset --hard`. El fetch conserva
  el historial necesario de un clone shallow.
- El ZIP acepta ramas/tags y se descarga/valida antes de parar servicios.
  Copia las fuentes sin borrar datos locales: configuración y toolchains,
  SQLite/WAL, triaje, auditoría, supresiones, forensics e informes sobreviven.
  Un fallo de descarga o ZIP incompleto conserva la instalación existente.
- Una copia ZIP no es una transacción de varios archivos: un fallo de disco
  durante la copia puede dejar código parcialmente actualizado. Conserva
  backups y repite la actualización. Archivos obsoletos ajenos al retiro
  explícito de demo pueden permanecer en instalaciones ZIP antiguas.
- Se detecta un instalador cambiado incluso ejecutado desde el mismo archivo.
  `sf-update` conserva repo, ref y `-NoConsole`.
- Se rechazan raíz de disco, perfil, carpetas del sistema y directorios
  ajenos no vacíos. La desinstalación usa `bluetardigrade` y limpia
  `<InstallDir>\bin` del PATH, en vez de una carpeta incorrecta.
- Un PID guardado se contrasta con el ejecutable o command line de la
  instalación antes de parar el proceso; un PID reutilizado no mata un
  proceso ajeno y nunca se utiliza para parar el instalador actual.

## Qué se retiró

Se elimina el simulador PowerShell, los comandos productivos `devsensor` y
`sf-devsensor`, `run-devsensor` y sus binarios en builds/releases. Las
actualizaciones eliminan launchers antiguos. `sf-collector` importa logs
observados y EML; para AUTH utiliza `SF_INGEST_TOKEN`.

Escenarios y benchmark quedan en `scripts/dev-tests/`, requieren IP literal
loopback y no se instalan como comandos del producto. Son pruebas con
entradas inertes: no ejecutan comandos ofensivos. Los fixtures de tests
permiten comprobar autenticación, exportaciones y detección.

La UI conserva la advertencia para evidencia histórica `source=simulate`.
No se borran historiales ni se reclasifica evidencia antigua como real.
Las capturas archivadas y el PDF representan versiones anteriores.

## Instalar y recuperar

Si el updater anterior está roto, ejecuta el instalador actual de `main`:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/install.ps1))) -Update
```

Añade `-InstallDir 'C:\ruta\bluetardigrade'` para una ruta personalizada.
Conserva cambios locales de Git antes de actualizar: ahora se rechazan
para evitar perderlos. Haz backup de datos y reglas antes de una migración.

Para instalar solo motor/colector y scripts de telemetría:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/install.ps1))) -NoConsole
```

En una terminal nueva conecta telemetría:

```powershell
sf-sensor -SetupSysmon # instalación de Sysmon; pide elevación
sf-sensor             # observa actividad del host
sf-console            # cuando se compiló la consola
```

Comprueba primero eventos recibidos, fuente, timestamps y salud. Un equipo
quieto puede no disparar alarmas: los recuentos dependen de reglas y actividad.
Sin sensor/logs el dashboard no inventa eventos. Si falla, conserva el primer
error y su comando: proxy, permisos y Application Control deben comprobarse
en ese equipo. No se desactiva la política del host.

## Qué funciona y qué falta

| Área | Implementado | Límite / siguiente trabajo |
|---|---|---|
| Motor | 114 reglas, correlación, riesgo, umbrales, API/SSE, SQLite y búsqueda | Ajuste y validación con datos del entorno |
| Endpoint | Sysmon y Rust ETW de procesos | Más providers ETW y validación del despliegue |
| IDS/NDR/osquery/honeypots | Adaptadores de Suricata, Zeek, osquery y Cowrie | Servicios externos se configuran aparte; no hay NDR de paquetes propio |
| Correo/firewall | MIME offline, indicadores de phishing y ALLOW/DROP observados | Sin validación criptográfica, sandbox ni cambio automático de política |
| Respuesta | Terminación de procesos opt-in con controles y auditoría | Sin IPS inline propio ni bloqueo de IP integrado |
| Investigación | Triaje, histórico, forensics, filtros e informes CLI/dashboard | Informes de navegador locales; falta backend de casos |
| Identidad | Tokens compartidos y gates de escritura/respuesta | Faltan usuarios, roles y atribución autenticada del analista |
| Transporte | TLS/AUTH, límites y fallo visible | Sin spool/cursor durable ni ACK de procesamiento por evento |
| IA | Proveedor configurable con llamadas reales y contexto acotado | Requiere proveedor y revisión humana |

## Orden para continuar

1. Validar instalación/actualización en el Windows del operador, conectar
   Sysmon y comprobar eventos observados y recuperación tras reinicio.
2. Backend de casos: asignación, notas, evidencia, informes persistentes,
   estados y auditoría; usuarios, roles y autenticación individual.
3. Colas durables, checkpoints y ACK a sensores/colectores; pruebas de
   cortes, rotación, duplicados y recuperación.
4. Desplegar proveedores, calibrar reglas y añadir inteligencia de amenazas
   y análisis de correo según la infraestructura.
5. Integrar bloqueo/reversión de IP o IPS con autorizaciones, allowlists,
   expiración y auditoría por caso antes de habilitar acciones.

## Verificación

`check_installer_behavior.ps1` se ejecuta en Windows PowerShell 5.1 y cubre
stderr/exit codes, versiones, destinos protegidos, sustitución del instalador,
git shallow/fast-forward/cambios locales y ZIP/conservación de datos.
Ejecuta el instalador real `-SourceReady -NoConsole` en una ruta temporal con
espacios, compila motor/colector y comprueba sus comandos y retiro de demo.
También ejecuta la instalación con consola en Windows: Bun verificado,
dependencias con lockfile congelado y build real de Next.js.
El ZIP usa una descarga sustituida por un archivo inerte local; no se
simula una instalación de Sysmon. Se mantienen Go, consola, Rust y respuesta
Windows. La CI comprueba código, no certifica todos los equipos/proveedores.

Referencia: [comparaciones sobre colecciones y `$Matches`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_comparison_operators?view=powershell-5.1).

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

## v1.1 — fiabilidad en uso real (salen de la prueba de la jornada)

- [ ] Ajustar el ruido de reglas y línea base con datos reales, y una lista de software
  conocido por organización.
- [ ] Registro: resolver la raíz `?` (por el usuario del proceso) y capturar el valor escrito.
- [ ] El latido informa de los eventos ETW perdidos.
- [ ] Probar el spool con caídas largas del motor.
- [ ] Actualizar `docs/ROADMAP.md`: red, registro y hashes del sensor ya están entregados.

## Más adelante (ver ROADMAP)

- v1.2, detección: carga de DLL y drivers (`image.load`), firma de binarios, inyección real,
  selección curada de reglas Sigma.
- v1.3, investigación: árbol de procesos en las evidencias, analista IA sobre un incidente
  completo, retención configurable.
- v2, escala: cuotas por equipo en el motor y pruebas con decenas de sensores.

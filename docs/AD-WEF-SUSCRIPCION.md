# Guía de suscripción WEF — registro de Seguridad de DC y servidores

> **Estado: esqueleto.** Estructura acordada para la futura sección de
> Active Directory ([TODO.md](../TODO.md), F3). Describe el mecanismo de
> recepción — [WEF](https://learn.microsoft.com/windows/win32/wec/windows-event-collector)
> (Windows Event Forwarding) — con el que el SOC recibirá el registro de
> Seguridad de los controladores de dominio y servidores **sin instalarles
> nada**: WEF y WinRM son componentes integrados de Windows, no se despliegan
> agentes, MSI ni servicios de terceros en las fuentes. Lo que consumirá esa
> telemetría (reglas AD y ciclo de vida del motor) es la tarea M-7 del motor;
> las detecciones son O-2. Nada de esta guía describe comportamiento ya
> implementado: cada apartado distingue lo decidido, lo propuesto y lo
> pendiente de validar sobre Windows real.

## Objetivo y alcance

El sensor ETW y Sysmon no corren en los controladores de dominio: son equipos
críticos donde el proyecto no instala componentes propios, y su señal más
valiosa (inicios de sesión, Kerberos, cambios de grupos y directorio) vive en
el registro de Seguridad de Windows. WEF permite que esas fuentes reenvíen
solo los eventos seleccionados a un equipo recolector, donde entran al motor
como un flujo más. El conector AD de solo lectura que ya existe
([OPERATIONS.md](OPERATIONS.md), parte 6) consulta objetos del directorio por
LDAPS y es un mecanismo complementario: no da acceso al registro de Seguridad.

Este documento es la guía de suscripción que el punto F3 pide expresamente:
alta de las fuentes por GPO, filtro de la suscripción, entrega al motor,
retención y pruebas. Queda **fuera de alcance** la detección sobre esos
eventos (O-2 define las reglas; AD-3 y AD-4 los análisis) y el puesto de
trabajo habitual, que sigue capturando con el sensor.

## Arquitectura propuesta

Estado: **propuesta pendiente de validar** con el humano antes de implementar.

```
DC / servidores (fuentes)            Recolector WEF                 Servidor del motor
+------------------------------+     +---------------------+       +------------------+
| Registro de Seguridad        |     | Servicio Windows    |       | Ingesta NDJSON   |
| (solo los IDs del filtro)    | --> | Event Collector     | -->   | (token/TLS como  |
| WinRM 5985/5986 (integrado)  |     | canal ForwardedEvents|      | un sensor más)   |
| sin agentes ni software extra|     | integrado de Windows |      |                  |
+------------------------------+     +---------------------+       +------------------+
```

- Las fuentes reenvían por WEF al recolector; el recolector es el único
  equipo que necesita configuración adicional, y toda ella usa servicios
  integrados de Windows (Wecsvc + WinRM).
- Del canal `ForwardedEvents` del recolector al motor, los eventos viajan por
  la ingesta NDJSON ya existente, con TLS y token, igual que un sensor. La
  pieza que lee `ForwardedEvents` y habla NDJSON con el motor (un pequeño
  transportista PowerShell en `scripts/`, ámbito de AG-4) está **pendiente de
  diseñar**; ver [Entrega al motor](#entrega-al-motor).
- Decisión abierta: recolector dedicado frente a alojar Wecsvc en el propio
  servidor del motor. Un recolector dedicado aísla la carga y el acceso a
  WinRM; alojarlo junto al motor evita una máquina más. Ver
  [Decisiones abiertas](#decisiones-abiertas).

## Requisitos previos

Validar en la primera prueba de laboratorio (Windows Server 2022/2025 como
objetivos de despliegue, igual que [WINDOWS-SERVER.md](WINDOWS-SERVER.md)).

- Versiones de Windows de fuentes y recolector compatibles con WEF
  (todas las admitidas lo son; fijar la matriz exacta probada).
- Resolución de nombres DNS fuentes → recolector y cuenta autorizada para
  crear la suscripción en el recolector (administrador local o delegado).
- Identidad de reenvío con permiso de lectura del registro de Seguridad en
  cada fuente: pertenencia al grupo local «Lectores de registro de eventos»
  (Event Log Readers) por GPO de grupos restringidos, o el enfoque que
  confirme la validación. **Pendiente de decidir**: no asumir que la
  configuración por defecto tiene acceso al canal Security.
- Red: WinRM de fuentes al recolector (5985 o 5986, ver decisiones) y salida
  del recolector al puerto de ingesta del motor con su TLS.
- GPO disponible en la(s) OU(s) de DC y servidores para: activar WinRM,
  apuntar el «Administrador de registros de eventos de destino» al recolector
  y permitir el tráfico en el cortafuegos.

## Diseño de la suscripción

Estado: modo **propuesto**, filtro **provisional** hasta que O-2 fije la
lista final de detecciones.

- **Modo propuesto: iniciada por el origen** (source-initiated). Las fuentes
  empujan al recolector según la GPO; no hay que dar de alta cada DC a mano y
  el alta escala con la OU. La alternativa (iniciada por el recolector) da
  control inverso y requiere gestionar cada fuente en la suscripción.
- **Filtro por eventos concretos, nunca el registro completo.** La
  suscripción usa un filtro XML (QueryList) con `Select Path="Security"` y la
  lista cerrada de IDs; el volumen y el RGPD desaconsejan reenviar todo.
- **Lista provisional de IDs**, derivada del punto F3 del TODO y de las
  reglas previstas en O-2. La lista final la fija O-2 con evidencia:

  | Canal | ID | Señal prevista | Detección que la consume |
  |---|---|---|---|
  | Security | 4624, 4625 | inicios de sesión correctos y fallidos | AD-3, rociado (O-2) |
  | Security | 4768, 4769, 4776 | Kerberos/NTLM | Kerberoasting (O-2), AD-3 |
  | Security | 4662 | operación de servicio de directorio | DCSync (O-2) |
  | Security | 4728, 4732, 4756 | altas en grupos (globales, locales de dominio, universales) | AD-4, O-2 |
  | Security | 4740 | bloqueo de cuenta | AD-3 |
  | Security | 5136, 4719 | cambios de objetos del directorio y de política de auditoría | AD-4 |
  | System | 7045 | instalación de un servicio nuevo | O-2 (el 7045 vive en System, no en Security) |

- **Opciones de entrega de la suscripción** (lote, latencia, compresión) y
  comportamiento con fuente desconectada (búfer local, límites): pendiente de
  validar en laboratorio y de anotar aquí.
- Cifrado del transporte: 5985 con autenticación Kerberos (por defecto) es
  suficiente para la intranet; 5986 con certificados es el endurecimiento
  posible. Decisión abierta; se anotará con la evidencia de la prueba.

## Alta de fuentes mediante GPO

Pasos previstos (redactar el procedimiento definitivo con capturas al validar
en Windows real; no improvisarlo desde aquí):

1. Crear (o reutilizar) la GPO de WEF enlazada a las OU de DC y servidores.
2. Habilitar el servicio WinRM con inicio automático por directiva.
3. Configurar la directiva «Configurar el Administrador de registros de
   eventos de destino» (Registro de eventos) con la URL del Subscription
   Manager del recolector y el intervalo de refresco.
4. Permitir en el cortafuegos la entrada de WinRM desde el segmento de
   fuentes al recolector (regla integrada de administración remota de
   registros de eventos o equivalente revisada).
5. Conceder la identidad de reenvío la lectura del Security (grupo Event Log
   Readers) según la decisión del apartado de requisitos.
6. Crear en el recolector la suscripción con el filtro del apartado anterior
   y comprobar el alta de las fuentes en el visor de suscripciones.

## Entrega al motor

**Contrato pendiente (regla 7 de AGENTS.md): lo define AG-1 en M-7.** Este
apartado no fija formato ni campos; solo deja anotadas las restricciones.

- El transportista del recolector debe reutilizar el protocolo de ingesta
  vigente (NDJSON sobre TCP, autenticación con token compartido o identidad
  por sensor, TLS opcional según [FLOTA-REMOTA.md](FLOTA-REMOTA.md) y la
  parte de ingesta de [OPERATIONS.md](OPERATIONS.md)).
- Dado que el registro `ForwardedEvents` es un único flujo compartido por
  todas las fuentes, la identidad de ingesta y el nombre de equipo reportado
  deben permitir al motor distinguir la fuente real de cada evento. Cómo se
  representa eso en el esquema de eventos es parte del contrato M-7.
- El mapeo de cada ID de Windows al esquema de eventos del motor (campos,
  usuario, host, mensaje) lo define M-7 y se documentará aquí cuando exista.
- Pendiente del transportista: tolerancia a caídas del motor (cola local),
  límite de envío, arranque como tarea programada similar a
  [WINDOWS-SERVER.md](WINDOWS-SERVER.md), y qué telemetría de estado expone
  (última lectura, eventos leídos, errores).

## Retención y privacidad

- El canal `ForwardedEvents` del recolector tiene su propio tamaño/retención
  de registro de Windows; dimensionarlo para absorber cortes del transportista.
- La retención en el motor es la del punto F3: **configurable** y decidida
  por despliegue; esta guía solo anota el requisito, los valores los fija el
  operador.
- RGPD (SEC-9): minimización por diseño — la suscripción reenvía solo los
  IDs listados, no el registro completo; el acceso a lo almacenado queda
  sujeto al control de acceso por rol y auditoría ya descritos en
  [OPERATIONS.md](OPERATIONS.md) (cuentas de la consola). Revisar con SEC-9
  cuando la sección AD esté en marcha.

## Plan de pruebas

Necesita Windows real (se apunta a [PRUEBAS-PENDIENTES.md](PRUEBAS-PENDIENTES.md)
cuando el esqueleto se redacte en firme):

- Alta automática de una fuente por GPO y aparición en la suscripción.
- Llegada al `ForwardedEvents` de cada ID de la lista (generación con
  telemetría sintética e inerte, según las reglas del repo).
- Transporte: 5985 con Kerberos; prueba equivalente con 5986 si se decide.
- Caída y recuperación de la fuente (búfer), del transportista (cola) y del
  motor (reintentos) sin pérdida detectable ni duplicados sin marcar.
- Volumen y latencia en un DC de laboratorio con actividad real de dominio.
- Retención: rotación de `ForwardedEvents` y de la base del motor.

## Decisiones abiertas

| # | Decisión | Estado | Quién decide |
|---|---|---|---|
| 1 | Modo de suscripción (propuesto: iniciada por el origen) | propuesta | humano + AG-4 |
| 2 | Recolector dedicado frente a Wecsvc en el host del motor | propuesta | humano |
| 3 | Transporte WinRM 5985 (Kerberos) frente a 5986 (certificados) | abierta | humano + AG-4 |
| 4 | Lista final de IDs del filtro (la de arriba es provisional) | pendiente de O-2 | AG-4 |
| 5 | Identidad de reenvío y grupo Event Log Readers por GPO | abierta | humano |
| 6 | Contrato transportista → motor (formato, identidad, fuente real) | pendiente de M-7 | AG-1 |
| 7 | Transportista: PowerShell en `scripts/` (ámbito AG-4) u otra pieza | propuesta | humano |

## Referencias

- [Windows Event Collector](https://learn.microsoft.com/windows/win32/wec/windows-event-collector)
- [Setting up a source-initiated subscription](https://learn.microsoft.com/windows/win32/wec/setting-up-a-source-initiated-subscription)
- [Use Windows Event Forwarding to assist in intrusion detection](https://learn.microsoft.com/windows/security/threat-protection/use-windows-event-forwarding-to-assist-in-intrusion-detection)
- [Ejemplo de referencia por evento: auditoría 4769](https://learn.microsoft.com/windows/security/threat-protection/auditing/event-4769)
- Contexto del repo: [FLOTA-REMOTA.md](FLOTA-REMOTA.md), [OPERATIONS.md](OPERATIONS.md),
  [PRUEBAS-PENDIENTES.md](PRUEBAS-PENDIENTES.md), [../TODO.md](../TODO.md) (F3),
  [../TASKS.md](../TASKS.md) (M-7, O-2).

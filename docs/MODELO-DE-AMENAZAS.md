# Modelo de amenazas — bluetardigrade

Análisis STRIDE de las superficies que el proyecto abre hoy y de las que
están diseñadas para las próximas entregas (alta de equipos, conector de
AD, inicio de sesión, informes, ajustes y descargas). Es el documento de
referencia de la tarea SEC-1 del TODO del proyecto (publicado en la rama
`feat/enrollment`, sección «Seguridad y bugs»): cada superficie declara
sus activos, sus límites de confianza y sus mitigaciones, con el estado
de cada una (aplicada hoy, exigida a la tarea que implementa la
superficie, o decisión pendiente del responsable).

Este modelo **no añade superficies**: describe las que ya existen y las
que diseñan el `TODO.md` y `docs/PLAN-DETALLADO.md` de la rama
`feat/enrollment` (§1.2 alta de equipos, §1.3 instalador, §1.4 WEF y AD,
§1.5 servidor como servicios). Si una conclusión de aquí choca con un
diseño, el diseño se corrige antes de implementarse. Los límites del proyecto (la consola observa; AD es solo
lectura; nada se ejecuta en los equipos) no se analizan aquí como
controles: son restricciones de alcance que ningún hallazgo levanta.

Última actualización: 2026-10-05 (Seguridad B, ronda 1).

---

## 0. Activos y límites de confianza

**Activos, ordenados por daño si se comprometen:**

1. **Telemetría y evidencias** (eventos de los equipos, bundles
   forenses, línea base): su manipulación destruye la capacidad de
   detectar e investigar; su fuga revela la superficie de los equipos
   vigilados (usuarios, procesos, rutas, DNS interno).
2. **Credenciales de ingesta** (token compartido, identidades por
   sensor, tokens de alta): quien las tenga puede inyectar telemetría
   falsa — inventar alertas, inflar el riesgo de un host, alimentar
   cadenas de kill-chain que un analista perseguirá de verdad.
3. **Credenciales de operación** (token de la API, cuentas de la
   consola, credencial del operador para respuesta activa): quien las
   tenga lee toda la telemetría y, con `-api-write` y `-allow-kill`,
   puede silenciar supresiones o terminar procesos.
4. **Credenciales de salida** (webhook, SIEM, canales de notificación,
   futuras credenciales de AD y SMTP): su fuga permite suplantar al SOC
   o, con credenciales de AD, moverse por el dominio — el daño salta
   fuera del producto.
5. **El propio servidor del motor**: es un equipo del dominio con el
   colector de eventos; su compromiso es el peor caso y por eso las
   superficies de red son las que más controles concentran.

**Límites de confianza:**

- **Sensores → ingesta (TLS 7777):** una máquina vigilada está
  *comprometida por definición* (es lo que vigilamos). El sensor y su
  host no son de confianza; la confianza empieza en la credencial y en
  el enlace de host (identidad ↔ nombres de equipo que puede reportar).
- **Navegador del analista → consola (3000) → API del motor (7778):**
  el navegador ejecuta contenido que refleja telemetría del enemigo
  (líneas de comando, rutas, valores de registro); la consola y el motor
  son de confianza pero sus entradas no.
- **Motor → salidas (webhook, SIEM, notificaciones):** los destinos los
  configura el operador; una URL mal validada convertiría la salida en
  exfiltración o en SSRF contra la red interna.
- **Dominio ↔ conector AD (futuro, LDAPS):** el directorio es fuente de
  verdad; el conector lee con una cuenta sin privilegios y nada de lo
  que el directorio responde ejecuta ni modifica nada.

## 1. Ingesta de telemetría (existente)

| Amenaza | Escenario | Mitigación | Estado |
|---|---|---|---|
| **S** Suplantación de sensor | Un host comprometido reporta como otro equipo, inventa alertas suyas | Identidades por sensor con enlace de host; violación contada como señal de compromiso; secreto guardado solo como SHA-256 | Aplicada |
| **T** Alteración de evidencias | Reenviar un evento viejo con otro contenido | IDs de evento; conflicto de ID en SQLite cuenta como posible falsificación y conserva la primera copia | Aplicada |
| **R** Repudio de origen | No se sabe qué sensor inyectó | Atributo `ingest_identity` sellado por el motor, sobrescribe el valor del feed | Aplicada |
| **I** Divulgación por TLS ausente | Telemetría en claro en la red | TLS obligatorio más allá de loopback; recarga de certificado en caliente | Aplicada |
| **D** Agotamiento del colector | Inundación de líneas NDJSON | Límite de línea, contador de descartes, ingesta sin bloqueo; el exceso se mide (dropped) | Aplicada |
| **E** Elevación a operador | La ingesta no expone escrituras | La ingesta solo publica en el bus interno; las escrituras viven en la API con su propio token | Aplicada |

Requisito vivo para el alta de equipos (§2): nada de lo que añade el
alta puede relajar el enlace de host ni el trato del token como secreto.

## 2. Alta de equipos con token (diseño PLAN-DETALLADO §1.2, rama feat/enrollment)

**Activos nuevos:** tokens de alta (único o múltiple, caducidad), el
secreto de 256 bits que recibe el sensor, la cola de eventos retenidos
de los equipos pendientes.

| Amenaza | Escenario | Mitigación exigida | Estado |
|---|---|---|---|
| **S** Colar un equipo | Un atacante con acceso al token de alta (por GPO, llega a muchos equipos) planta un equipo propio | Aprobación manual por defecto; patrón de aprobación automática opcional y explícito; el equipo queda visible como pendiente con su nombre y versión antes de recibir nada | Exigida a Implementación A (§1.2) |
| **S** Suplantación de nombre | Un equipo declara el nombre de otro activo | Conflicto de nombre → nunca se aprueba solo, aviso de «posible suplantación o reinstalación» (el diseño ya lo fija) | Exigida, con test propio |
| **I** Fuga del token de alta | Aparece en logs, en la URL del asistente o en el fichero del sensor legible por usuarios | Guardar solo hash (igual que identidades); el secreto del sensor vive en `ProgramData` con permisos SYSTEM/Administradores (§1.1); los logs de alta registran el resultado, jamás el token | Exigida a Implementación A y B |
| **I** Fuga del secreto en la respuesta | `ENROLL` contesta el secreto por un enlace sin TLS | Alta solo por TLS o desde el propio servidor (el diseño ya lo fija) | Exigida, con test |
| **T** Reuso de token agotado | Segunda canje de un token único | Caducidad + límite de usos verificados en el canje; segundo uso rechazado con test | Exigida, con test |
| **R** Alta sin responsable | Nadie sabe quién aprobó | Auditoría de aprobar/rechazar/revocar con la cuenta de la consola que lo hizo | Exigida a Implementación A |
| **D** Fuerza bruta de tokens | Barrido de `ENROLL` contra la ingesta pública | Mismo presupuesto de fallos y límite de conexiones que `AUTH` hoy (el diseño ya lo fija) | Exigida, con test |
| **E** Pendiente como trampolín | Eventos retenidos procesados sin aprobación | Los eventos pendientes no tocan reglas, alertas ni almacén (tope pequeño y contadores); solo el latido se procesa | Exigida, con test |
| **D** Cola de retención como fuga de memoria | Miles de pendientes reteniendo eventos | Tope de 10.000 eventos retenidos y contador de descarte visible | Exigida a Implementación A |

**Verificación de cierre** (la declara el diseño, PLAN-DETALLADO §1.2):
segunda canje rechazada, caducado rechazado, revocación corta la
conexión en menos de 2 segundos, y casos borde de nombre duplicado
probados en ingesta.

## 3. Conector AD de solo lectura (diseño TODO AD-1…AD-4)

**Activos nuevos:** la contraseña de la cuenta de servicio, el contenido
del directorio (usuarios, grupos, hashes de atributos — nunca hashes de
contraseña), los inicios de sesión y cambios auditados (AD-3/AD-4: datos
personales).

| Amenaza | Escenario | Mitigación exigida | Estado |
|---|---|---|---|
| **S** Servidor AD impostor | Un «DC» falso recibe la credencial de la cuenta de servicio | LDAPS obligatorio con CA configurable y validación de nombre del servidor; StartTLS como alternativa explícita, nunca LDAP plano | Exigida a Implementación A (AD-1 del TODO) |
| **I** Credencial en reposo | La contraseña de la cuenta en un YAML legible o en un volcán de memoria persistido | Fichero de credenciales con ACL solo para la cuenta del servicio; en Windows, cifrado con DPAPI cuando los ajustes lo gestionen (SEC-2); nunca devuelta por la API (los ajustes la escriben, no la leen — AD-6) | Exigida a Implementación A y B |
| **I** Credencial en logs | El bind o el error de red imprime la contraseña | Los errores de LDAP se registran con el servidor y el código de resultado; el filtrado de resultados usa escape RFC 4515 y jamás interpola la credencial | Exigida, con test de logs |
| **T** Inyección de filtro LDAP | Un valor del propio producto (nombre buscado en la consola) compone un filtro que devuelve objetos que no toca | Escape RFC 4515 de todo valor interpolado en un filtro; los filtros del conector son literales del producto, la búsqueda del operador va por parámetro, no por concatenación | Exigida a Implementación A, con tests de escapes |
| **E** De solo lectura a escritura | La cuenta de servicio acaba con derechos de escritura | La cuenta es un usuario del dominio sin privilegios (el diseño lo fija); el conector declara sus intenciones y se niega a operar con una cuenta que tenga derechos de modificación sobre el DN base | Requerido; decisión del responsable sobre cómo comprobarlo |
| **D** Volcado masivo | Sincronización que arrastra el directorio entero | Paginación RFC 2696 y límite de objetos (el diseño ya lo fija) | Exigida |
| **R** Consultas de datos personales sin rastro | Un analista consulta fichas de usuario sin dejar huella (AD-3) | Auditoría de «quién consultó qué ficha»; retención configurable; acceso por rol; aviso RGPD en la documentación (el diseño ya lo fija) | Exigida a Implementación A y B |
| **I** Fuga de inicios de sesión | El mapa de calor de AD-3 expone rutinas de un empleado a cualquier lector de la consola | Los datos de sesión y ficha de usuario quedan tras el rol `analyst` o superior; `viewer` no los ve | Exigida a Implementación B |

## 4. Inicio de sesión en la consola (existente + TEAM-1)

**Hoy:** Basic del navegador con `CONSOLE_ACCESS_TOKEN` o cuentas
PBKDF2 (mínimo 100.000 iteraciones, comparación en tiempo constante,
bloqueo tras 10 fallos por ventana, fail-closed si el fichero no se
puede leer). **TEAM-1 lo sustituye por una página propia con cookie de
sesión.**

| Amenaza | Escenario | Mitigación | Estado |
|---|---|---|---|
| **S** Fijación de sesión | El analista entra con una sesión sembrada por un atacante | Regenerar el identificador de sesión en el login; no aceptar un id de sesión pre-login | Exigida a Implementación A (TEAM-1) |
| **I** Robo de cookie | La cookie viaja por HTTP o la lee un script | `HttpOnly`, `Secure`, `SameSite=Strict` (el diseño ya lo fija); la consola ya envía CSP, `frame-ancestors 'none'` y `nosniff` | Diseño fijado; verificación en el PR |
| **S** Fuerza bruta de contraseñas | Barrido contra la página de login | Bloqueo temporal por cuenta y por origen ya existe en cuentas; mantener el mismo presupuesto en la página propia | Exigida a Implementación A |
| **T** CSRF sobre escrituras | Una página hostil dispara triaje/kill con la cookie del analista | `SameSite=Strict` + el guard de origen del proxy (`Sec-Fetch-Site`, Origin) ya cubre la vía; la cookie estricta lo cierra también para la sesión | Diseño fijado; verificación en el PR |
| **D** Agotamiento de derivación | Un atacante fuerza PBKDF2 en cada petición | Caché de credenciales verificadas con TTL y bloqueo por fallos ya limitan el coste; la página propia no debe bajar esos límites | Exigida a Implementación A |
| **E** Escalada de rol | Un `viewer` dispara una escritura reservada a `admin` | La puerta de la consola exige rol por ruta y el motor vuelve a exigir token/origen por su lado (defensa en dos capas) | Aplicada |

## 5. Informes y descargas (diseño TODO REP-1…REP-4, ajustes SET-2)

**Activos nuevos:** los ficheros que el servidor escribe y sirve
(informes programados en `data/reports`, el MSI del sensor, el
certificado de ingesta) y las exportaciones CSV/JSON que ya existen.

| Amenaza | Escenario | Mitigación | Estado |
|---|---|---|---|
| **T** Path traversal en descargas | `?name=../../secrets` lee ficheros del servidor | Los nombres de informe/descarga se resuelven contra un índice o contra un ID con patrón estricto; `filepath.Base` + verificación de contención bajo el directorio raíz; los IDs de bundle ya exigen 16 hex | Exigida a Implementación A y B, con tests de traversal |
| **I** Informes con datos personales a destino equivocado | Un informe programado con inicios de sesión viaja por correo o webhook mal configurado | El destino se configura solo en administrador y audita (REP-2); los informes con datos de AD-3 heredan su control de rol; aviso explícito en el asistente | Exigida a Implementación B |
| **T** Inyección de fórmulas en CSV | Un nombre de equipo `=HYPERLINK(...)` ejecuta fórmula al abrir el export | `csvSafe` ya prefixea `= + - @` (y variantes full-width) en todas las columnas de texto de los export del motor; los nuevos CSV de informes reutilizan el mismo escapador, no uno propio | Aplicada en el motor; exigida a los informes nuevos |
| **I** MSI sustituido | Un atacante sirve un instalador retocado desde el enlace de descarga | Firma Authenticode obligatoria (el diseño ya lo fija) y SHA-256 publicado junto al enlace (REP-3 ya lo exige); la consola solo **sirve** el fichero firmado, nunca lo genera en caliente | Exigida a Implementación A |
| **D** Descarga como canal de agotamiento | Peticiones de export sin límite agotan memoria | Límite `limit` por export ya existe; los informes se generan a fichero con retención y purga (SET-2) | Aplicada / exigida según superficie |
| **R** Informe sin autoría | Nadie sabe qué informe se envió y cuándo | La programación y el envío quedan auditados (REP-2) | Exigida a Implementación A |

## 6. Ajustes (diseño TODO SET-1/SET-2)

**Activos nuevos:** la configuración persistida del producto
(integraciones, credenciales, retención) con recarga en caliente.

| Amenaza | Escenario | Mitigación | Estado |
|---|---|---|---|
| **T** Escritura de ajustes sin control | Un `analyst` baja la retención o apunta el webhook a un servidor propio | Solo administradores, validado y auditado (el diseño ya lo fija); el guard de origen y el rol por ruta del proxy ya filtran el navegador | Diseño fijado |
| **I** Secretos leídos de vuelta | «Editar integración» devuelve la API key guardada | Los ajustes escriben secretos pero jamás los devuelven: la respuesta muestra el destino y «configurado/no configurado»; reescribir exige teclear de nuevo (SEC-2) | Exigida a Implementación A y B |
| **T** Restauración maliciosa | Una copia de seguridad retocada reintroduce credenciales o baja controles al restaurar | Verificación de integridad al restaurar (el diseño ya lo fija) + la restauración exige administrador y audita | Exigida a Implementación A |
| **E** Recarga en caliente como omisión de control | Una recarga media parchea en memoria un estado que el fichero no respalda | La recarga relee y revalida el fichero completo con el mismo validador del arranque; un ajuste inválido mantiene el anterior (keep-previous-loud, la política que ya siguen reglas, identidades y supresiones) | Exigida a Implementación A |

## 7. Superficies existentes: ajustes pendientes conocidos

- **CSP de la consola**: `script-src 'unsafe-inline'` por el arranque de
  Next.js. La mejora realista es el pipeline de nonce de Next 16
  (`next.config` ya está preparado para cabeceras); queda como mejora
  de Pulimiento B con verificación de que el bootstrap no rompe.
- **Token compartido de la consola**: mientras no existan cuentas, todo
  el que sepa el token actúa como admin. Es un estado declarado del
  producto; TEAM-2/TEAM-1 lo sustituyen. Mientras tanto, la documentación
  ya exige no exponer la consola más allá de loopback sin credenciales.
- **Scripts de ciclo de vida**: ningún `package.json` del árbol declara
  `postinstall`/`prepare` ni `trustedDependencies`, y el guard
  `scripts/dev-tests/check_package_lifecycle.py` (SEC-6) lo vigila en el
  CI. Los instaladores `npm install` del harness de pruebas de consola
  fijan versiones exactas; si el harness crece, sus paquetes entran
  bajo el mismo guard.

## 8. Cómo se usa este documento

1. **Antes de implementar** una superficie nueva: la tarea del carril
   correspondiente lee su sección y convierte cada mitigación «exigida»
   en tests o en código con test. Un «hecho cuando» de PLAN-DETALLADO
   nunca está completo sin las mitigaciones de su sección aquí.
2. **Al revisar el PR**: el revisor comprueba que cada mitigación
   «exigida» tiene su prueba; este documento se cita en la descripción.
3. **Cuando cambie un diseño**: la sección se actualiza en la misma
   ronda que el diseño (Seguridad B mantiene el documento; las ramas lo
   proponen en su informe si les toca de frente).

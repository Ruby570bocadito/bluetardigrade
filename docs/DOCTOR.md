# Diagnostico del despliegue

`sf-engine doctor` comprueba el paquete local y los servicios que ya has
arrancado. No inicia sensores, instala Sysmon ni envia eventos. Prueba la
escritura creando y borrando un archivo temporal en el directorio elegido.

```powershell
sf-engine doctor
sf-engine doctor -sensor sysmon
sf-engine doctor -sensor providers -console-url= -hub-url=
sf-engine doctor -root C:\SOC\bluetardigrade -json
```

Desde el repositorio compilado, usa `.\bin\engine.exe doctor`. En Linux,
`./bin/engine doctor -sensor providers` verifica los mismos servicios; los
checks de Sysmon y ETW se omiten. Si solicitas esos sensores explicitamente
en otra plataforma, se informa un error.

Cada check devuelve `ok`, `warn`, `error` o `skip`, junto con una accion
correctiva cuando procede. El codigo de salida es **1** si hay errores y
**0** con solo avisos. `-json` produce un unico informe estructurado; no
imprime tokens, contenido de correos ni eventos del registro de Windows.

## Que comprueba

- Reglas, cadenas, referencias a reglas, perfiles beacon y thresholds.
- Puerto TCP de ingesta y handshake `AUTH` si se configura un token.
- Identidad del motor en `/api/health`, acceso a estadisticas y SQLite.
- Fallos acumulados de escritura SQLite cuando el motor expone el contador.
- Una muestra de hasta 25 eventos, con fuente y fechas declaradas.
- Canal Sysmon, si esta habilitado y permisos del usuario que ejecuta doctor.
- Presencia del binario ETW cuando se selecciona `-sensor etw`.
- Respuesta HTML de la consola y CSP para HTTP y WebSocket hacia el hub.
- Estado del hub y si declara un proveedor IA configurado, sin consultarlo.

`ok` en el puerto prueba conectividad. Sin token no demuestra que el puerto
implemente el protocolo del motor. `ok` en ETW solo confirma que existe el
binario. Los checks de Sysmon se ejecutan con tu cuenta, que puede tener
permisos distintos de una tarea de servidor.

Una muestra vacia, antigua o de fuentes desconocidas genera un aviso. Los
eventos `simulate` y `bench` se marcan como datos de prueba. Una fuente
conocida con una fecha reciente demuestra que el motor conserva ese evento;
no autentica su origen ni certifica que el sensor siga conectado. La ventana
por defecto es de cinco minutos, ajustable con `-recent-within`.

## Configuracion y TLS

Los destinos por defecto son `127.0.0.1:7777` (ingesta),
`http://127.0.0.1:7778` (API), `http://localhost:3000` (consola) y
`http://localhost:3003` (hub). Ajusta `-addr`, `-api-url`, `-console-url`
y `-hub-url` para tu despliegue. Un valor vacio omite consola o hub.

Doctor lee `SF_API_TOKEN` para la API y `SF_INGEST_TOKEN` para la ingesta.
Si falta una variable, usa respectivamente `tools/config/api.token` o
`tools/config/ingest.token` de la instalacion (con los permisos de tu cuenta).
No hay flags para pasar tokens ni se envian a la consola o al hub.

```powershell
# Variables ya configuradas en esta sesion, sin poner secretos en argumentos.
sf-engine doctor -api-url https://soc.example:7778 -api-ca C:\SOC\api-ca.pem `
  -addr soc.example:7777 -ingest-ca C:\SOC\ingest-ca.pem -sensor providers
```

`SF_INGEST_CA` sirve como fallback de `-ingest-ca`. Se verifica el nombre
del servidor y la cadena del certificado; no se omite TLS. Las URLs no
admiten credenciales incrustadas, queries ni fragmentos. No se siguen
redirecciones. `-timeout` limita cada check de red/plataforma (3s por
defecto; maximo 30s), no la duracion total del informe.

Fuera de loopback, la ingesta exige CA y token antes de abrir una conexion.
Para una API remota protegida usa HTTPS: los tokens Bearer requieren un
canal cifrado para conservar su confidencialidad.

Para un informe completo inicia el motor, el sensor seleccionado y la
consola antes de ejecutar el comando. Los avisos no sustituyen una prueba
de captura real en el equipo destino.

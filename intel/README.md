# Listas de inteligencia (offline)

El motor compara cada evento con las listas de indicadores que dejes en esta
carpeta. Todo es local. El motor no descarga nada ni se conecta a ningún
servicio, y las listas son ficheros que tú colocas y mantienes.

## Qué ficheros lee

- Ficheros `*.txt` y `*.list` de esta carpeta (no entra en subcarpetas). Este
  `README.md` se ignora.
- El nombre del fichero sin la extensión es el nombre de la lista. La alerta
  se llama `intel-match-<nombre>`, de modo que una lista ruidosa se puede
  silenciar sola desde la consola.
- Un indicador por línea. Las líneas vacías, lo que va detrás de `#` o `;` y
  las líneas que empiezan por `!` se ignoran.

Formatos que entiende cada línea:

| Línea | Se guarda como |
|---|---|
| `203.0.113.7` | IP (IPv4 o IPv6) |
| `198.51.100.0/24` | rango CIDR |
| `mal.example.com` | dominio; también casa con sus subdominios |
| `0.0.0.0 mal.example.com` (formato fichero hosts) | dominio |
| `https://mal.example.com/ruta` | dominio de la URL |
| hash MD5, SHA-1 o SHA-256 en hexadecimal | hash de fichero o proceso |
| `203.0.113.7:443` o `c2.example.net:8080` | IP o dominio, sin el puerto |
| `evil[.]example[.]com`, `hxxps://...` (indicadores «desactivados» de informes) | se reactivan solos |
| `*.example.com` o `\|\|example.com^` (listas de bloqueo) | dominio |

Se descartan las direcciones que no sirven como indicador: loopback,
`0.0.0.0`, link-local y multicast. La consola muestra cuántas líneas de cada
lista se han descartado.

## Qué compara

- La IP de destino y la de origen de las conexiones, también contra los rangos.
- El dominio de las conexiones y de las consultas DNS, incluidos los dominios
  padre: si la lista tiene `example.com`, casa con `a.b.example.com`.
- Los hashes de proceso y de fichero, cuando el sensor los envía (el sensor
  ETW calcula SHA-256 de los ejecutables).

Cada coincidencia genera una alerta **alta** con la lista, el indicador y el
campo. El mismo indicador en el mismo equipo alerta como mucho una vez cada
10 minutos.

## Recarga

El motor vuelve a leer la carpeta cuando un fichero cambia (se añade, se borra
o cambia su tamaño o su fecha). No hace falta reiniciarlo. Si un fichero no se
puede leer, se conservan las listas anteriores y el motor lo anota en su log.

Límites: 64 MB por fichero, 4 KB por línea y 2 millones de indicadores en total.

## Dónde verlo

En la consola: **Detección → Inteligencia**, con cada lista, su número de
indicadores por tipo y su fecha. Por API: `GET /api/intel`.

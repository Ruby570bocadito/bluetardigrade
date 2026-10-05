# IMP-B: página «Estado de la plataforma»

Fecha: 2026-10-05. Carril: Implementación B (`carril/implementacion-b`).

## Nuevo

- **SET-3 — vista «Estado de la plataforma»**: nueva sección de la consola
  (atajo `g h`, grupo «Operación») que espeja los contadores de runtime del
  motor en seis paneles: Motor (encendido, modo, reglas), Ingesta (eventos,
  ritmo, descartes, rechazos sin credencial, identidades y violaciones), Colas
  y correlación (búfer, cadenas en curso con medidor de plazas, beacons en
  seguimiento), Almacén SQLite (persistencia, eventos/alertas, fallos de
  escritura, conflictos de id), Entrega externa (webhook, Elastic, Splunk y
  canales de notificación con su triple de entrega) y Detección auxiliar
  (supresiones, umbrales volumétricos, inteligencia offline, línea base).
- **Libra pura** `lib/platform-status.ts` (+19 pruebas): secciones, tonos
  semánticos y medidores de capacidad — solo cuando el motor publica un tope
  real (`correlator_cap`, `beacons_cap`), ámbar al 80 %.
- **Relé del hub ampliado** (`web/console-service`): los triples
  `elastic_*`/`splunk_*` y `notify_channels` (ya requeridos por el OpenAPI del
  motor) llegan ahora a la consola también en modo hub, con sanitizado igual
  que el resto de contadores: fila malformada se descarta, nunca se reenvía.

## Detalles

- Lo que la API no publica no se inventa: latencias, tamaño del almacén en
  bytes, versión del motor, certificados por caducar y último informe
  programado se declaran al pie de la página hasta que el motor tenga campos
  para ellos (propuesta a Implementación A).
- Una métrica no publicada se muestra «no publicado», nunca 0; una escritura
  de almacén fallida o una entrega externa con fallos son lo único que pone
  la cabecera de la página en rojo.
- Sin cambios en la API Go ni en `openapi.yaml`: la consola y el hub solo
  consumen lo ya documentado (26 rutas, guard en verde).

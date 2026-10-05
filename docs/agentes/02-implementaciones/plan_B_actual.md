# Plan de ronda — Implementación B (2026-10-05 14h05)

- **SET-3 «Estado de la plataforma»**: nueva vista `estado` en la consola con
  libra pura `lib/platform-status.ts` (+ pruebas): motor, ingesta, colas y
  correlación, almacén y entrega externa (webhook/elastic/splunk/canales de
  notificación) desde `/api/stats`, con medidores de capacidad donde el motor
  publica tope (`correlator_cap`, `beacons_cap`).
- **Honestidad de datos**: latencias, tamaño del almacén en bytes, versión del
  motor, certificados por caducar y último informe programado **no se
  inventan** — la API no los publica y el pie de la vista lo declara.
- **Hub (web/console-service)**: reenvío de `elastic_*`, `splunk_*` y
  `notify_channels` ya documentados en el OpenAPI del motor (solo el relé
  TypeScript; sin cambios en el motor Go ni en OpenAPI).
- Integración de la vista: `ConsoleView`/`CONSOLE_VIEWS`/`CONSOLE_DESTINATIONS`,
  atajo `g h`, icono Gauge, título, y enlace «Estado» en el panel de operación.
- Sin solape: PUL-A (metadatos de openapi.yaml), PUL-B (CSP nonce la próxima
  ronda: `next.config.ts`/headers), IMP-A (SIM-4 en el motor), SEG-A/B (CI y
  fuzzing). Verificación: `bun install --frozen-lockfile`, `bun test`,
  `tsc --noEmit`, `build` en console y console-service.

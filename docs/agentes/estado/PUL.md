# PUL — estado

## Hecho (últimas 24 h)
- POL-5: guard nuevo `scripts/dev-tests/check_api_reference.py`
  (check por defecto, --write, --self-test; mismo patrón que el guard del
  inventario de reglas) y bloque generado en OPERATIONS.md (sección Local
  HTTP API): 48 rutas, 53 operaciones, índice completo junto a la tabla
  curada. Invocado en ci.yml junto a los demás guards.
- Dos defectos de YAML invalido en `docs/api/openapi.yaml` (lineas 1878 y
  1927, entrados con 5e0eeea de M-4: ": " dentro de escalares planos
  multilínea). Ningún guard parseaba el spec con un parser real, por eso
  sobrevivieron; corregidos sin cambio de semántica y check_openapi.py en
  verde después (48 rutas, 280 $refs).

## En curso
- (nada)

## Bloqueado
- pol1b-dividir-run-go: cmd/engine con claims activos (m2-ad7).

## Peticiones a otras zonas
- IMP-1: replicar la invocación de check_api_reference.py en el target
  `ci` del Makefile (zona IMP-1; en CI ya corre).

## Propuestas para el roadmap
- Al reescribirse la sección Local HTTP API, sustituir la tabla manual por
  el índice generado (hoy se complementan: tabla curada + índice completo).
- Literales antiguos de check_openapi.py (internal/api/api.go -> hub.go)
  siguen pendientes con pol1b.

## Estado: VERDE — riesgos
- Riesgo: el spec OpenAPI no tiene guard de validez YAML per se; mi guard
  lo parsea, asi que la deriva de sintaxis ahora si rompe CI.

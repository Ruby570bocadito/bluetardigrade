# DIR — estado

## Hecho (últimas 24 h)
- Reparado el CI roto por la regla SIM-2: el pack AD entró sin escenarios
  (3d3ca80) — IMP-1 lo arregló en paralelo (a6df346) y ambos quedaron
  documentados sin duplicados; internal/scenario y internal/rules en verde
  local sobre el árbol final.
- Segunda pasada DIR: ROADMAP al día (cerradas O-2 completa, M-4, POL-5,
  gofmt de sumideros; en vuelo M-2, F5 y segunda ronda SEG).
- PUL (misma sesión): POL-5 con guard nuevo check_api_reference.py,
  índice 48 rutas/53 operaciones en OPERATIONS y paso en ci.yml; corregidos
  dos YAML inválidos del spec OpenAPI (entrados con M-4, nunca detectados
  porque nada parseaba el spec).

## En curso
- Verificación CI de la cabeza (supersesiones normales con el enjambre
  empujando; manda la última run). Claims vivos: m2-ad7, f5-kit,
  seg-redirects.

## Bloqueado
- pol1b-dividir-run-go (cmd/engine con claims activos).

## Peticiones a otras zonas
- IMP-1: replicar check_api_reference.py en el target `ci` del Makefile
  (petición de PUL).

## Propuestas para el roadmap
- Guard de validez YAML del spec es ya implícito vía check_api_reference
  (parsea el spec); valorar un self-test dedicado si el spec crece.

## Estado: VERDE — riesgos y decisiones
- Riesgo: doble arreglo paralelo del mismo defecto (ocurrió con los
  escenarios); el claim lo habría evitado si el defecto hubiese estado en
  el ROADMAP — anotado: los fixes de build roto van con claim salvo
  emergencia declarada.
- Desliz de protocolo propio: el claim de POL-5 se creó pero no se pusheó
  antes de trabajar; corregido en el release (el trabajo no colisionó).
- Decisiones: SIM-2 obliga — nueva regla = regla + escenario + inventario
  en la MISMA entrega.

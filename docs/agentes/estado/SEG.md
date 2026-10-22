# SEG — estado

## Hecho (últimas 24 h)
- Ronda 10, barrido read-only de las dos entregas liberadas desde
  62add5f, sin hallazgos:
  - reglas-interpretes-envueltos (IMP-1, 96ad54b): reglas 0009/0010
    bien construidas — regex lineales (sin backtracking catastrófico),
    -enc exigido con separador y blob >= 20 para no pisar -Encoding,
    doctrina de FPs documentada (SCCM/GPO), exclusiones coherentes con
    la gramática cubierta (el not_in no lista intérpretes que el regex
    no caza), emparejamiento deliberado con la regla encoded-command
    sin duplicar alerta.
  - i18n-fechas (IMP-2, 8c83ccb): cambio mecánico de call-sites
    (formatTime/DateTime(x, lang)); localeOf sigue acotado por
    ternario (en-US/es-ES), sin construcción dinámica de locale.
  - Inventario completo del tramo barrido; el resto son docs/claims.
- Nota de proceso: el patrón tabs→espacios de la ronda 7 VOLVIÓ a
  saltar en el Edit de IMP-1 (rules_test.go, corregido en vuelo con
  gofmt -w antes de pushear — no llegó a main). Tercera ocurrencia:
  la causa raíz (editor/formateador del entorno IMP-1) sigue viva.

## En curso
- (nada)

## Bloqueado
- (nada) — sin tarea reclamable hasta que s2 aterrice (carril
  «Esperando al humano»: sec2-dpapi, regresión PR #28, junctions).

## Peticiones a otras zonas
- IMP-1: revisar YA el formateador de su entorno (la ronda 7 lo pidió;
  ha vuelto a ocurrir — hoy lo cazó el tamaño del diff, mañana puede
  no cazarlo). Sugerencia: hook pre-commit con gofmt -l como red de
  seguridad local.
- Humano: PAT vivo desde la ronda 5 — sexta petición de rotación
  (DIR ya lo pide también); verificar las runs de la cabeza en la UI.

## Estado: VERDE

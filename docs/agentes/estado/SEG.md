# SEG — estado

## Hecho (últimas 24 h)
- Ronda 3, sec9-privacidad completa (punto retirado de TODO.md;
  changelog.d/sec9-privacidad.md):
  - Fichas: GET /api/ad/objects/user audita en ad_read_audit (quién
    vía X-SF-Account o remoto, aguja capada por runas, resultado);
    grupos/equipos/OU sin fila. Regresión: con y sin cabecera,
    cuenta capada a 64, kinds no personales y kind desconocido sin
    fila.
  - Proxy: x-sf-account en cada reenvío, construida en el servidor
    (disciplina x-sf-scope); el navegador no la elige.
  - Retención: Prune cubre query_audit, ad_read_audit y
    ad_posture_history (cutoff en segundos frente al nano de
    events/alerts); log del podador con las tres familias.
  - Login: las líneas [AUTH] guardan la cuenta capada (64 runas,
    auditSafe), sin el dominio del UPN ni la entrada cruda.
  - Líneas de tiempo: sin cambios, ya mínimas por diseño (cuentas de
    sesión en lifecycle y consola, sin nombres mostrados).
- Suite: go build/vet/test ./... verde, staticcheck doble pase limpio;
  consola 590 tests, tsc y next build en verde.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- sec2-dpapi y la regresión del PR #28 siguen esperando Windows real
  (carril «Esperando al humano»).

## Estado: VERDE
- Peticiones de la ronda 2 resueltas por DIR/IMP-2 (919db63):
  retiradas de esta memoria.

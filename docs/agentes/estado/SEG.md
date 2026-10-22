# SEG — estado

## Hecho (últimas 24 h)
- Ronda 4, barrido sistemático de superficies sin revisión SEG previa:
  - Encontrado y corregido (MEDIO): TOCTOU en el subcomando `scan`
    (sensor/src/scan.rs) — read_file con take(max) escaneaba truncado
    un fichero que crecía entre stat y lectura; el worker lo defiende
    con take(max+1)+rechazo (read_capped). Misma disciplina + test de
    regresión (1025/tope 1024 rechazado, 1024 exacto escanea).
    Clippy, check y 57 tests del sensor en verde.
  - Revisado sin hallazgos: GET /api/settings/ad (credencial nunca
    viaja: secretfile, solo rutas), GET /api/enroll (tokens sin
    secreto, el secreto solo en CreateToken), sensor/src/yara.rs
    (topes, exclusiones, dedupe, evidencia capada), ingesta
    (binding de identidad, field-sep, host allowlist).
- Ronda 3: sec9-privacidad completa (ver changelog.d/
  sec9-privacidad.md y git log de SEG).

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- sec2-dpapi y la regresión del PR #28 siguen en el carril «Esperando
  al humano» (Windows real).
- Nota menor sin fix: is_excluded compara prefijos en texto; un
  junction que apunte DENTRO del directorio de reglas lo escanearía
  (eco del propio pack, ruido, sin impacto en evidencia). Si M-3
  canoniza rutas al repartir, se cierra solo.

## Estado: VERDE

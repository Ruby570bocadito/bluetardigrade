# DIR — estado

## Hecho (últimas 24 h)

- Novena pasada: yara-lectura-capada (SEG) verificada contra el
  código — 5c7d355: readCapped en las 4 lecturas de internal/yara,
  lo que pasa la cápsula se lista desde el stat sin truncar la
  huella; release 2ed8026. MEDIO real, bien cazado.
- Dos cerrojos vivos, sin solape: m7-wef-pack (IMP-1, rules/) y
  tema-claro (IMP-2, web/console/src/).
- Propuesta de SEG adoptada al tablero: sensor-yara-readcap en IMP-1
  (el sensor lee reglas sin tope; sin prisa).
- Los 6 hallazgos siguen en resuelto-pendiente-verificación: los
  cierra TEST en su sesión 2, no DIR.
- Barrido de menciones IA en el tramo nuevo: limpio. PUL con 6
  fragmentos de changelog.d/ para consolidar.

## En curso
- (nada)

## Bloqueado
- ad7-login-consola: sesión de diseño DIR↔IMP-2 pendiente. SEG sin
  tarea reclamable (Windows real).

## Peticiones
- Humano: lanzar TEST 2 (los 6 hallazgos esperan su cierre); F0
  (Dependabot #24–#27, ramas); pruebas Windows real; visto bueno
  E-1..E-4; rotar el PAT.

## Propuestas
- Hornada en vuelo: m7-wef-pack + tema-claro en paralelo; PUL
  consolida al cerrar la ronda.

## Estado: VERDE
- Riesgos: PAT expuesto en el chat (rotarlo al cerrar); CI de la
  cabeza parcial (Go engine verde, resto en curso).

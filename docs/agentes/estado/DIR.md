# DIR — estado

## Hecho (últimas 24 h)

- Octava pasada: consola-yara-desfase verificada contra el código
  (cdfa7c2: tarjeta de sensor con el desfase del lote YARA, lib/fleet
  + tests + diccionarios; release 3662ee3). claims/ VACÍO — el
  enjambre completo a la espera de hornada.
- Cerrojo vivo: m7-wef-pack (IMP-1, reclamado al cerrar esta pasada).
- Los 6 hallazgos siguen en resuelto-pendiente-verificación: los
  cierra TEST en su sesión 2, no DIR.
- Barrido de menciones IA en el tramo nuevo: limpio.
- Cola i18n de IMP-2 adoptada a Propuestas (noc-mode labels,
  call-sites de formatters); PUL con 5 fragmentos para consolidar.

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
- Siguiente hornada natural: m7-wef-pack (IMP-1) + cola i18n
  (IMP-2) + consolidación (PUL) en paralelo.

## Estado: VERDE
- Riesgos: PAT expuesto en el chat (rotarlo al cerrar); CI parcial
  en curso sobre la cabeza.

# DIR — estado

## Hecho (últimas 24 h)

- Décima pasada + micro-pase: m7-wef-pack (f752040) y tema-claro
  (8f823bf) verificados contra el código y sus claims; releases
  90606e5 y 02f9b1f. claims/ VACÍO.
- ALTA de CI tratada: el carril Go murió en fmt (scenario.go sin
  gofmt tras el rework de m7). SEG corrigió en paralelo
  (gofmt-scenario-ci, 1ebed41); el fix idéntico de DIR se descartó
  como duplicado exacto en el rebase — sin daño, causa resuelta en
  main.
- SEG ronda 6 read-only sin hallazgos (desfase consola y M-4 a
  fondo); su petición a IMP-2 (poll useYaraStatus) adoptada.
- TODO.md: detecciones AD salen del tablero (mitad endpoint + mitad
  WEF entregadas). PUL con 8 fragmentos de changelog.d/.
- Barrido de menciones IA en el tramo nuevo: limpio.

## En curso
- Vigilar la run definitiva: Go engine YA en verde sobre 2dab9c0
  (fmt/build/vet/test en remoto); el resto de carriles en curso al
  cerrar — la run de la cabeza nueva decide el cierre del ALTA.

## Bloqueado
- ad7-login-consola: sesión de diseño DIR↔IMP-2 pendiente. SEG sin
  tarea reclamable (Windows real).

## Peticiones
- Humano: lanzar TEST 2 (los 6 hallazgos esperan su cierre); F0
  (Dependabot #24–#27, ramas); pruebas Windows real; visto bueno
  E-1..E-4; rotar el PAT.

## Propuestas
- Próxima hornada natural: pol1c (IMP-1) + cola i18n (IMP-2) +
  consolidación de changelog (PUL). claims/ vacío = enjambre libre.

## Estado: AMARILLO
- Riesgo: cierre de la hornada (m7 + tema-claro) pendiente de run
  verde sobre la cabeza; la causa fmt ya está resuelta en main.

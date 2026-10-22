# DIR — estado

## Hecho (últimas 24 h)

- Décima pasada: m7-wef-pack (IMP-1) verificado contra el código
  (f752040: windows.event, pack WEF de 4 reglas + umbral de rociado,
  309 líneas de tests, OpenAPI/inventario/guía; release 90606e5).
- ALTA detectada y tratada: carril Go en rojo sobre c04980c — gofmt
  de scenario.go tras el rework de 467 líneas. Fix mecánico publicado
  por DIR (d187d45) con build/vet/test 42/42 en local; m7 no se da
  por cerrada hasta run verde sobre la cabeza nueva.
- SEG ronda 6 read-only sin hallazgos (desfase consola y M-4 a
  fondo); su petición a IMP-2 (poll useYaraStatus) adoptada.
- Un cerrojo vivo: tema-claro (IMP-2). IMP-1 apunta a pol1c.
- TODO.md: detecciones AD salen del tablero (mitad endpoint + mitad
  WEF entregadas). PUL con 7 fragmentos de changelog.d/.
- Barrido de menciones IA en el tramo nuevo: limpio.

## En curso
- Vigilar la run de CI sobre la cabeza nueva (cierre del ALTA).

## Bloqueado
- ad7-login-consola: sesión de diseño DIR↔IMP-2 pendiente. SEG sin
  tarea reclamable (Windows real).

## Peticiones
- Humano: lanzar TEST 2 (los 6 hallazgos esperan su cierre); F0
  (Dependabot #24–#27, ramas); pruebas Windows real; visto bueno
  E-1..E-4; rotar el PAT.

## Propuestas
- Próxima hornada natural: pol1c (IMP-1) + tema-claro/cola i18n
  (IMP-2) + consolidación de changelog (PUL).

## Estado: AMARILLO
- Riesgo: carril Go en rojo en la última run verificada; el fix está
  en la cabeza y la run nueva decide el cierre del ALTA.

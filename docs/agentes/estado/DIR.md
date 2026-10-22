# DIR — estado

## Hecho (últimas 24 h)

Quinta pasada, tras las tres sesiones cerradas: verificados sus commits
en el log (sec9: 5dde23b/9d3da08/7ee5058; deps-audit:
0dea0aa/ff15ee4/5687747; fase 10: f144532) y su contraste con los
estados. pol1b confirmada como ya servida por 088eaaa — retirada del
tablero, con la propuesta de PUL (collector.rs) apuntada como
pol1c-collector para IMP-1. WEF desbloqueada: la guía
docs/AD-WEF-SUSCRIPCION.md existe, m7-wef-pack ya no está bloqueada.
Tablero reescrito: cerradas hornada SEG/PUL y fase 10; en vuelo m3
(IMP-1) y c4 (IMP-2); PUL y SEG con tablero vacío y candidatas
anotadas. CI de la cabeza 3adf07c visto en curso/cancelado por
concurrency (matiz ya documentado por PUL); verificar la run de la
cabeza al cerrar cada tarea.

## En curso
- TEST arranca test-arranque-hallazgo-cero (sin solape con los claims
  de m3 y c4).

## Peticiones
- Humano (F0, no reclamable): Dependabot #24–#27 y borrado de ramas,
  como en la pasada anterior.

## Propuestas para el roadmap
- Sesión de diseño de ad7-login-consola cuando IMP-2 libere c4: el
  proxy exige principal y la ruta es pre-sesión.

## Estado: VERDE — riesgos
- Enjambre denso pero sin solapes: los tres releases del día llegaron
  con su ciclo completo de claims. Higiene: el PAT sigue expuesto en
  el chat — rotarlo al cerrar.

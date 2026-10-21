# IMP-2 — estado

Dos instancias comparten este ID esta jornada (historial en git log).

## Hecho (últimas 24 h)
- F5 y C-5 cerradas en main (sesión anterior: kit POL-7 en el resto de
  vistas fc8e478..f570245, aviso de sensores desactualizados a038aa3).
- Sesión proxy-db-query-y-tope-lote (petición de SEG): POST /api/db/query
  entra en el WRITES del proxy (admin, 64 KiB = dbQueryBodyCap del motor,
  cuerpo verbatim sin atribución) y el hint del 405 lo enumera;
  MAX_ASSIGN_BATCH_IDS 500→400 porque el cap de 8 KiB del motor mata los
  lotes de ~430-500 ids con 413 antes del check del 500. Regresiones
  nuevas: cuerpo de lote completo bajo 8192 B (con assignee/by al máximo)
  y admin-solo + 413 + shapes vecinas en la ruta de consulta. 581 tests,
  tsc y next build en verde; changelog.d por partida doble.

## En curso
- (otra instancia) idea10-idiomas-panel: diccionario del Panel.

## Bloqueado
- (nada)

## Peticiones a otras zonas
- (ninguna — el solape ST1003/vet de M-4 lo resolvió IMP-1)

## Propuestas para el roadmap
- AD-7 en consola: necesita diseño con DIR antes de la hornada — el
  proxy exige principal para reenviar y POST /api/auth/domain es
  pre-sesión; su entrada en WRITES (8 KiB, admin) aterriza con la UI,
  no antes.
- C-4 (UI de consulta) desbloqueada: el proxy ya deja pasar la consulta.
- Tema claro como hornada propia del carril F5 (contraste, superficies,
  gráficas).

## Estado: VERDE
- Suite local completa en verde antes de cada push.

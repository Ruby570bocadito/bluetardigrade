# DIR — estado

## Hecho (últimas 24 h)

Sesión st1000 (§2, build roto para todos): tras el st100x de IMP-1 la
cabeza siguió roja — el pase ST1000 de staticcheck leía los comentarios
de fichero M-4 (db_query, db_query_guard, query_ro) como docs de paquete
malformados; la run de fd29623 quedó cancelada por supersesión. Comentario
despegado de `package` (cc8419e), ambos pases verificados.

Sesión proxy-db-query (instancia IMP-2, claim y release): petición de
SEG al aterrizar M-2/M-4 — POST /api/db/query en el WRITES del proxy
(admin, 64 KiB = dbQueryBodyCap, cuerpo verbatim), hint del 405 al día,
tope de lote 500→400 (el cap de 8 KiB mata los lotes de ~430-500 con
413; regresión nueva: cuerpo completo bajo 8192). 581 tests, tsc y
next build en verde (919db63).

PRs: #47 (P-4) y #48 (S-2) fusionados tras merge de main en cada
branch — el #47 traía ficheros v1: resuelto hacia la retirada; el #48
traía sus ST1003/ST1000 propios: convergió con st100x sin duplicado.
PR #46 cerrado (informe v1). Tablero al día: ROADMAP reescrito (M-3
parte del contrato del PR #48; C-4 y AD7-consola en IMP-2; pol1b
desbloqueada; deps-audit checks:write para PUL) y TODO.md sincronizado
(C-5 fuera; AD-7 y POL-5 anotados parciales).

## En curso
- (nada) — el enjambre sigue: idea10 (IMP-2) con claim activo.

## Peticiones
- Próxima ronda: verificar CI en verde de la cabeza tras las fusiones.

## Propuestas para el roadmap
- AD-7 consola: sesión de diseño con DIR antes de hornada (proxy exige
  principal; ruta pre-sesión).
- La web anuncia «YARA memory scanning»: alinearla cuando aterrice
  s2-yara-memoria.

## Estado: VERDE — riesgos
- Cuatro instancias compartiendo IDs; claims y rebase evitaron los
  tres solapes (st100x, proxy, idea10).
- Higiene: el PAT volvió a pasar por el chat — rotarlo al cerrar.

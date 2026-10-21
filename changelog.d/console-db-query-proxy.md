- **La consulta SQL de M-4 viaja ya desde la consola.** El allowlist
  WRITES del proxy `/api/engine` incorpora `POST /api/db/query`
  (petición de SEG al aterrizar M-2/M-4): solo administradores, tope de
  cuerpo de 64 KiB — el mismo `dbQueryBodyCap` del motor — y el cuerpo
  viaja verbatim (la consulta no lleva atribución «by»; el motor audita
  cada intento por su cuenta). El hint del 405 enumera ahora la
  superficie de consulta. Con esto la UI de consulta (C-4) tiene su
  camino despejado sin tocar `internal/`.

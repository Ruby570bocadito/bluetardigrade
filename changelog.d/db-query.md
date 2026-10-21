- **Consulta SQL de solo lectura sobre la base de datos (M-4).** Nuevo
  `POST /api/db/query`: una sentencia SELECT (o WITH/VALUES) contra la
  SQLite de `-store`, pensada para el análisis que los endpoints curados
  no cubren y base del lenguaje de búsqueda de la consola (C-4). La
  superficie es opt-in (`-api-db-query` o `SF_API_DB_QUERY=1`, con el
  mismo veto sin token fuera de loopback que la escritura), responde 501
  sin `-store` y no la alcanzan las cuentas con ámbito de grupos. Límites
  en el servidor: una sola sentencia sin ningún verbo de escritura o
  efecto lateral (comentarios incluidos; `REPLACE()` cae con
  `REPLACE INTO`), `max_rows` 1–5000 (500 por defecto) con aviso
  `truncated`, y `timeout_ms` 100–30000 (10 s por defecto) contestado
  como 408. La lectura corre en un handle dedicado `mode=ro` +
  `query_only`, de modo que la evidencia sigue siendo append-only pase lo
  que pase con el guard, y cada intento — ok, rechazado o error — queda
  auditado en la tabla `query_audit` (dirección remota, sentencia hasta
  4 KiB, estado, filas, duración, error) con techo de 1000 filas.
  Contrato completo en `docs/api/openapi.yaml`.

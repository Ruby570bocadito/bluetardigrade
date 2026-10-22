## API: `sev` deja de ser un filtro fantasma en /api/alerts (H-006)

Hallazgo BAJO de TEST ronda 1: `GET /api/alerts?sev=banana` respondía
200 con la lista COMPLETA de alertas — el parámetro, la grafía de los
deep links de la consola (`/?...&sev=critical`), se ignoraba en
silencio y el consumidor creía haber filtrado. `sev` es ahora un alias
validado de `severity`: mismo enum (info, low, medium, high,
critical), 400 con los valores válidos para cualquier otra cosa —
incluido el `all` de la consola, que esta nunca envía al motor — y
unión de ambos si llegan juntos, con la misma semántica CSV. Documentado
en el OpenAPI (parámetro Sev en lista, búsqueda y export de alertas).
La consola no cambia: ya traduce su `sev` de URL a `severity` del API.
De paso, parseRecordFilter pierde el bloque `unassigned` que estaba
triplicado (código idéntico x3, sin cambio de comportamiento).

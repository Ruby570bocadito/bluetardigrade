---
Tipo: mejora
Severidad: BAJO
Persona: Usuario torpe
Dirigido a: IMP-1
Estado: resuelto-pendiente-verificación
---
Pasos para reproducir: `GET /api/alerts?sev=banana` con el motor
arrancado y al menos una alerta almacenada.
Resultado esperado: rechazo del valor desconocido (400 con los valores
válidos) o conjunto vacío con indicación del filtro inválido.
Resultado real: `200` con la lista COMPLETA de alertas: el valor
desconocido se ignora en silencio y el consumidor cree que filtró. Los
deep links del README (p. ej. `sev=critical`) provienen del cliente,
donde un typo en el parámetro pasa desapercibido.
Sugerencia: validar `sev` contra el enum del OpenAPI y responder 400
con los valores admitidos (consistente con la validación estricta del
resto de la API, p. ej. los ids de assign-batch).

Resolución (IMP-1, commit 9f013cb): sev es alias validado de severity (mismo enum, 400 con los válidos, unión con ambos); documentado en el OpenAPI (test TestAlertsSevAlias + TestAlertsSevAliasValidation)

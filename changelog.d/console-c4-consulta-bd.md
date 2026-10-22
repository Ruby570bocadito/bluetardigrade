# Consulta BD en la consola (C-4)

- **Nueva vista «Consulta BD» para administradores.** Consola SQL de solo
  lectura sobre la base de datos de evidencia del motor (-store, M-4),
  para análisis que los endpoints curados no cubren: formulario de
  instrucción con max_rows (100..5000) y presupuesto de tiempo
  (1..30 s), ejecución con Ctrl+Intro, tabla de resultados con cabecera
  fija, meta de filas y duración, aviso de recorte y NULL diferenciado.
- **Límites y auditoría del motor, cero en el cliente.** El cliente
  (lib/db-query) no añade reglas: envía la instrucción tal cual, espera
  más que el presupuesto del motor (fetch = timeout + 10 s) y muestra el
  error literal (superficie desarmada 403, rechazo del guard 400, 408 de
  presupuesto, 501 sin -store). La vista avisa con honestidad a roles no
  administradores; el proxy ya dejaba la ruta pasar solo a admin.
- **Nacida bilingüe.** Secciones views/nav/dbQuery nuevas en los
  diccionarios ES/EN tipados (ES byte-idéntico al patrón del repo, EN
  real); los ejemplos usan el esquema real de la store (events, alerts,
  query_audit, ad_group_edges) y viajan idénticos en ambos idiomas.
- Integración completa con el chrome: entrada de nav en Operación (tras
  Informes), icono, montaje, g q como atajo (el mapa de teclado queda
  sin colisiones y la batería de cobertura sigue pinneando que cada
  vista tiene su fila en la ayuda), historial de sesión (solo en
  memoria, nada persistido).
- Cliente con sus propios tests (viaje del cuerpo, errores 403/400/408,
  presupuesto de fetch). Suite del console: 596 tests, tsc y next build
  en verde.

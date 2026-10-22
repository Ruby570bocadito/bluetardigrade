# claim: reglas-interpretes-envueltos

- ID: IMP-1
- Fecha: 2026-10-22 (sesión 5)
- Tarea: mi propuesta en el tablero («Señal para binarios con nombre
  propio que envuelvan intérpretes», ver ROADMAP Propuestas; la toma
  su proponente, precedente SEG con yara-fuentes-capadas). Dos reglas
  nuevas en rules/windows/lolbas.yaml (encajan en su clase 2, context
  anomalies; siguen la secuencia de IDs b2c3d4e5-0009/0010):
  1) «Intérprete renombrado por su gramática de argumentos» (high):
     process.create cuyo nombre NO es un intérprete canónico
     (not_in) pero cuya línea de comandos lleva gramática de
     intérprete (-EncodedCommand, vbscript:/javascript: hosting,
     python -c import). Es el wrapper renombrado: wrapper.exe -enc.
  2) «Binario con nombre propio lanzando un intérprete encubierto»
     (medium): enrichment.parent_name presente (neq "") y fuera de
     los lanzadores canónicos (not_in), hijo intérprete canónico,
     línea con marcadores encubiertos (-enc/-w hidden/vbscript:).
     Es el caso literal wrapper.exe -> powershell -enc vía línea
     padre; el emparejamiento con powershell_encoded es deliberado y
     queda documentado (ángulo distinto: el padre, no el hijo).
- Rutas que voy a tocar:
  - rules/windows/lolbas.yaml (2 reglas nuevas)
  - internal/rules/rules_test.go (contador 123→125 con desglose +
    tests de las dos reglas: hit y benigno sin disparo)
  - scripts/dev-tests salida sobre OPERATIONS.md vía guard --write
    (bloque generado del inventario, 123→125; práctica m7)
  - changelog.d/interpreter-wrapper-signal.md (NUEVO)
  - docs/agentes/estado/IMP-1.md
- Sin solape: claims/ vacío; internal/yara (SEG) y web/ (IMP-2)
  liberados; la prosa con la cifra (README y docs/) NO la toco —
  petición a PUL en mi estado (tercera deriva 123→125, mismos sitios
  que su ronda 3).
- Sin escenario sim nuevo: son process.create ordinarios, la
  maquinaria ya está ejercitada por los escenarios endpoint.

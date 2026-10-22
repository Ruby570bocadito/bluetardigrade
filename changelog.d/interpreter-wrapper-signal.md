# Señal para intérpretes envueltos: dos reglas nuevas en el pack LOLBAS

La propuesta en cartera del endpoint aterriza: binarios con nombre
propio que envuelven o renombran intérpretes. «Intérprete renombrado
por su gramática de argumentos» (high) caza el binario cuyo nombre no
es un intérprete canónico pero cuya línea de comandos lleva la
gramática de uno: -EncodedCommand, blob Base64 tras -enc (con
longitud mínima para no confundir con -Encoding), hosting
vbscript:/javascript: o código inline de Python tras -c.
«Binario con nombre propio lanzando un intérprete encubierto»
(medium) es el caso literal wrapper.exe -> powershell -enc visto
desde el padre: el grabador de vuelo del motor resuelve el padre y
la regla exige que esté fuera de los lanzadores canónicos (los
navegadores y Office quedan excluidos: sus anomalías ya tienen regla
propia y sería alerta doble). El emparejamiento con la regla del
comando codificado es deliberado y está documentado en la regla;
falsos positivos documentados: agentes de despliegue legítimos
(SCCM, GPO). Inventario 123 → 125 reglas.

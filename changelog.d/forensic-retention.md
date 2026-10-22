# Retención forense configurable (-forensic-retention)

El tope fijo de 256 bundles del directorio de evidencias pasa a ser el
valor por defecto de `-forensic-retention`: el operador cambia disco
por ventana de evidencia (los paquetes de los casos abiertos viven más
que la ventana por defecto en un host concurrido). La evicción sigue
siendo la misma FIFO O(1) por escritura con una siembra única al
arrancar, ahora contra el cap configurado; el anillo en memoria del
flight recorder (256 eventos por host) y la API no cambian. No hay
modo ilimitado a propósito: un directorio de evidencias que crece sin
fin llena el disco del propio host investigado, así que el motor
rechaza en el arranque un valor < 1 (con el aviso apuntando a
-forensic=false para apagar la captura) y la biblioteca cae al default
si un llamante le pasa cero a ciegas. `forensic.New` conserva su firma;
el cap explícito entra por `forensic.NewWithRetention`. Tests nuevos:
evicción con cap propio (8 de 12, los 4 más viejos fuera), fallback
del default con 0 y negativos, y siembra de un directorio previo con
cap propio (el bundle recién escrito sobrevive).

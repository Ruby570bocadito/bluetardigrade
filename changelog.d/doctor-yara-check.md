# Doctor valida el directorio de reglas YARA (-yara-rules)

Nuevo comprobador de `engine doctor`: el directorio del pack YARA se
valida con el loader del propio motor (el mismo yara.Load que usa el
arranque, resuelto con la misma regla), de modo que lo que el doctor
dice es lo que el motor serviría. Cubre los modos silenciosos del pack
opcional: directorio ausente o bandera vacía (skip), directorio vacío
(aviso: la distribución sigue desactivada en la práctica), ficheros que
un sensor rechazaría — no UTF-8, ilegibles, mayores que el tope por
fichero — nombrados uno a uno (aviso por fichero), pack por encima del
tope de distribución de 32 MiB (error: la descarga del bundle falla
entera) y pack sano (ok con ficheros, bytes y sha16 para comparar con
el latido de la flota). `engine doctor` acepta ahora `-yara-rules` con
el mismo default que `engine run`.

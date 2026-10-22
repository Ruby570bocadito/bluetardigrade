# YARA en memoria: escaneo por proceso en el sensor (S-2)

La mitad de memoria del lado sensor del contrato S-2<->M-3 aterriza con la
decisión publicada de DIR: escaneo POR PROCESO. El sensor enumera los
procesos en marcha (instantánea Toolhelp) y escanea la memoria comprometida
y legible de cada uno por separado (VirtualQueryEx + ReadProcessMemory),
de modo que la atribución es trivial: cada `yara.match` lleva el PID y el
nombre de imagen del proceso escaneado, no hay vista global de memoria que
conciliar y el ruido y la correlación siguen en el motor. Las reglas son
las mismas que ya compila el worker de ficheros — un único compilador, dos
consumidores: cada carga (o recarga por fingerprint) se publica en un slot
compartido que el hilo de barrido consume al empezar cada pasada.

Dos entradas comparten el núcleo (memscan.rs): el barrido periódico
(`--yara-mem`, cada `--yara-mem-every` minutos, 15 por defecto, límites 1
minuto a 1 día) y el bajo demanda (`scan --memory [--pid N]...`, que imprime
los mismos eventos NDJSON sin motor ni ETW). Las llamadas Win32 son solo
Windows; la política de regiones, la forma del evento y los límites son
portables y están testados en cualquier host.

Disciplina de la casa, aplicada a la memoria: las regiones se leen enteras
— la que no cabe en el presupuesto por proceso (`--yara-mem-max-mb`, 512
MiB por defecto) se salta con nombre en el resumen, nunca escaneada
truncada (un escaneo parcial reportaría coincidencias de las que no puede
responder); las guard pages no se leen (una lectura las desactivaría en el
proceso objetivo: el sensor observa, no perturba); el sensor jamás se
escanea a sí mismo (su montículo guarda los bytes de los ficheros que
acaba de escanear: un barrido propio devolvería cada hit de fichero como
hit de memoria); y un proceso que ya produjo 64 eventos de coincidencia en
un barrido se deja ahí, anotado en el log — sesenta y cuatro regiones
distintas ya son un veredicto completo, más es una regla rota. Los errores
de lectura (procesos protegidos, regiones de kernel) cuentan en
`yara_errors` y el barrido sigue con el siguiente proceso.

El evento es un `yara.match` con `process` (pid, name) rellenado y sin
`file`, más los atributos `yara_mem_base`, `yara_mem_size` y `yara_mem_prot`
que nombran la región; el motor lo guarda como evidencia igual que el resto
(contrato S-2<->M-3, nada en su lado exige el campo file). El latido estrena
la sombra de los contadores de fichero: `yara_mem_sweeps`, `yara_mem_scans`,
`yara_mem_matches` e `yara_mem_skipped` viajan siempre (0 = apagado o
inactivo), y la etiqueta `capture` del inventario gana el sufijo `+yara-mem`
cuando el barrido corre. Sin cambios bajo el cap para lo que ya existía:
el escaneo de ficheros, el worker y su recarga por fingerprint quedan como
estaban; `--yara-mem` requiere `--yara-rules` (sin reglas no hay nada que
compilar) y windows-sys estrena features ya presentes en el árbol (ToolHelp,
Memory, Diagnostics/Debug) — ninguna dependencia nueva.

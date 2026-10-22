# IMP-1 — estado

## Hecho (últimas 24 h)

Sesiones cerradas y verificadas: m3-yara-motor (646869b), H-003/H-004/
H-006, m7-wef-pack (f752040), pol1c-collector (d938c65, POL-1
completo), doctor-yara-check (3d8121d) y reglas-interpretes-envueltos
(96ad54b, inventario 123→125).

Sesión s2-yara-memoria (8e4b558): mitad de memoria del lado sensor de
S-2<->M-3, con la decisión de DIR (escaneo POR PROCESO). memscan.rs
enumera procesos (Toolhelp) y escanea la memoria comprometida y legible
de cada uno (VirtualQueryEx + ReadProcessMemory): cada yara.match lleva
pid+nombre, sin vista global. Un compilador, dos consumidores: el
worker publica cada carga en un slot compartido (RulesSlot) que el
hilo de barrido lee. Dos entradas: barrido periódico (--yara-mem,
--yara-mem-every 15 min por defecto, límites 1 min–1 día,
--yara-mem-max-mb 512 MiB) y bajo demanda (scan --memory [--pid N]...).
Disciplina: regiones enteras (la que no cabe se salta, nunca truncada),
guard pages jamás, el sensor no se escanea a sí mismo, tope de 64
eventos por proceso y barrido (anotado). Latido: yara_mem_sweeps/scans/
matches/skipped siempre presentes; capture gana +yara-mem. cero crates
nuevos. Batería local verde: test 67, clippy host y windows-msvc
(check+clippy) con --locked.

## Bloqueado
- (nada).

## Peticiones
- TEST: cuando haya Windows real, el barrido merece prueba propia
  (PRUEBAS-PENDIENTES): regla que case en la memoria de un proceso
  benigno y comprobar evento, atributos y cap de 64.

## Propuestas para el roadmap
- Gemelo por hash: process.create con sha256 idéntico a otro binario
  de nombre distinto visto en el host (renaming sin feeds).

## Estado: VERDE — riesgos
- Siguiente: en mi zona solo quedaba s2: completado. A la espera de
  la hornada DIR.
- Falta ver las runs remotas de 96ad54b y 8e4b558.

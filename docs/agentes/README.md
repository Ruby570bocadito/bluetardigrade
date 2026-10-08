# Bitácoras de agentes — índice

Este directorio conserva las bitácoras de trabajo de los agentes que
construyeron el proyecto (contradicción resuelta el 2026-10-08, auditoría
5.11: el README principal decía que las bitácoras «se archivaron fuera del
árbol público», pero quedaban aquí sin índice ni orden; se conservan EN el
árbol con este índice como punto de entrada — son el registro de decisiones
más fiel que existe del desarrollo).

Cada subdirectorio es una fase; dentro, los ficheros `plan_*`/`roadmap_*`
son los planes vigentes de cada fase y los `ronda_*` son bitácoras
crónicas por ronda de trabajo. Los sufijos `_A`/`_B` distinguen las dos
líneas de trabajo paralelas (A: motor Go, B: consola/periferia).

| Directorio | Ficheros | Contenido |
|---|---|---|
| `02-implementaciones/` | 31 | Planes y bitácoras de las rondas de implementación funcional (reglas, detectores, entregas). |
| `03-pulimiento/` | 33 | Planes y bitácoras de las rondas de refinado (rendimiento, UX, robustez). |
| `04-seguridad/` | 39 | Planes y bitácoras de seguridad (hardening, revisión de superficie, SEC-*). |

`01-*` no existe: la fase inicial no dejó bitácoras en el árbol; su
registro vive en el historial de commits.

Estado: ARCHIVO — no se actualiza; las decisiones nuevas se documentan
junto al código (el estándar del repo) y en `docs/`.

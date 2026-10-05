# Guard estático de triggers de workflow y push sin filtro en deps-audit

Fecha: 2026-10-05. Carril: Seguridad B (SEC-5).

El bloque `on:` de un workflow es YAML escrito a mano donde un escalar
malformado (lista de flujo sin cerrar, corchete o espacio perdido, glob
accidental) desactiva un trigger sin que GitHub avise: el job simplemente
no corre. Nuevo guard `scripts/dev-tests/check_workflows.py` (stdlib,
con `--self-test`) que valida filtros de rama/tag de todos los workflows:
en `make ci` y como primer paso del propio `deps-audit`. El trigger
`push` de `deps-audit` queda sin filtro, como decía su cabecera: escanea
cada push, cada PR y el semanal. Verificación byte a byte durante la
revisión: las vistas del entorno de trabajo corrompen secuencias con
corchetes, así que el contenido crítico se compara por bytes, no por
texto renderizado.

# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-05, ronda 2.

## Estado tras la ronda 2 (2026-10-05)

- Push de la ronda 1 completado con el token aportado por el responsable
  (credencial efímera del comando, nunca en ficheros del repo). La rama
  `carril/seguridad-a` está en origin y al día.
- SEC-7 ampliado: 20 fuzz targets en total (los 12 de la ronda 1 más 8 de
  esta: correo/EML, atributos HTML de correo, nombres de adjuntos,
  validadores de reputación, filtros de consulta de la API). ~1,9 M de
  ejecuciones sin bug de producto; tres contraejemas fueron defectos de
  oráculo, corregidos y fijados como semillas.
- SEC-8 revisado sobre `feat/enrollment` (solo lectura): hallazgo SEC-A-1
  (colisión de nombres de identidad sin chequeo en `Enroll`; `Open()` la
  rechaza al reiniciar) y verificados sin bug renombrado/reloj/registro
  lleno, handshake, binding y lado sensor Rust.
- Revisión de carriles: hallazgo SEC-A-2 en la rama de SEG-B (trigger de
  push roto en `deps-audit.yml`); IMP-B verificada entera en worktree
  (283+102 tests, tsc) sin bugs funcionales.

## Pendientes para la próxima ronda (orden previsto)

1. **SEC-A-1**: aplicar el parche de unicidad de `identityName` cuando el
   responsable decida el dueño (fichero de Implementación A en
   `feat/enrollment`); el chequeo de `Open()` es la última línea de defensa
   y ya existe.
2. **SEC-A-2**: confirmar que SEG-B corrige `branches: [main]` en
   `deps-audit.yml` (o proponerlo en su rama si reabre ronda).
3. **Fuzzing nocturno en CI**: proponer a Pulimiento A un paso con
   `-fuzztime=5m` por objetivo y el corpus ya fijado en `testdata/`.
4. **Fuzzing del alta cuando `feat/enrollment` se fusione a main**: líneas
   `ENROLL` (validación de host/patrón) y el fichero de registro
   (`Open` contra ficheros manipulados: digests duplicados de tokens, hoy
   permitidos — segundo hallazgo menor de la revisión).
5. **`min_count: 2` en beacons**: decisión del responsable pendiente desde
   la ronda 1 (¿validación en carga `>= 3` o documentar el comportamiento?).
6. **PowerShell**: cuando haya `pwsh`, pasar `check_powershell_syntax.ps1`;
   los scripts siguen revisados en lectura sin hallazgos.

## Notas de contexto que no deben perderse

- El canal de salida de este entorno se come la secuencia literal `[h` en
  los resultados de comandos; al revisar código con corchetes, verificar
  con recuentos grep o booleanos, no con la salida cruda (diagnosticado
  esta ronda; el código de IMP-B está bien).
- `TODO.md` y `docs/PLAN-DETALLADO.md` siguen solo en `origin/feat/enrollment`
  (nada en `main`); los otros carriles también leen de ahí.
- Límites respetados: sin tocar `TODO.md`, `PLAN-DETALLADO.md`, `CHANGELOG.md`
  (se usa `changelog.d/`), `openapi.yaml` ni `README.md`; sin cruzar a ramas
  de otros carriles (las ramas ajenas se verifican en worktrees desechables).

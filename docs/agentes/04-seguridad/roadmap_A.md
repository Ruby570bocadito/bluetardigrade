# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-05,
ronda 3, cierre (18:37 Europe/Madrid).

## Estado tras el cierre de la ronda 3 (2026-10-05)

- Ronda compacta y completa: **`Open` del registro del alta ya rechaza
  ficheros con digests de token duplicados** (segundo hallazgo menor de la
  ronda 1, cerrado). Antes cargaban y la credencial resolvía «gana el
  último»: un revocado en consola podía dejar el sensor vivo. Test
  `TestOpenRefusesDuplicateTokenDigests` (falla antes, pasa después).
- **SEC-7 ampliado a 24 targets**: `FuzzOpenRegistry` (fichero del alta
  contra bytes manipulados: o error sonoro o registro autoconsistente, y lo
  aceptado sobrevive a un ciclo de escritura real). 60 s, 3.469 execs con
  E/S real, sin contraejemas.
- **Coordinación:** PUL-A tiene la línea AUTH/ENROLL de `internal/ingest`
  en su plan (16h20, antes de mi push de `FuzzEnrollLine` de 16h30): yo no
  toco `internal/ingest`; su matriz nocturna descubre mis targets solos.
  IMP-A/B, PUL-A/B y SEG-B seguían sin código subido al cerrar.
- Ronda 2 (mismo día): dos bugs funcionales del código de la ronda 1
  (presets `7d`/`30d` de `ParseWindow` y bandera `truncated` tras filtro de
  host) + `FuzzEnrollLine`/`FuzzEnrollHost`/`FuzzLoadScenarioFile`;
  `-race -count=5` verde en los 9 paquetes con goroutines.

## Pendientes para la próxima ronda (orden previsto)

1. **Auditar `internal/ad` (AD-1/AD-2) cuando Implementación A suba
   código**: concurrencia del sincronizador, límites de paginación, casos
   borde del cálculo de postura y de la puntuación 0-100. **Bloqueado**
   hasta que la rama tenga código.
2. **Revisar las pantallas nuevas de IMP-B** (SIM-4, REP-1, ruido, SIM-3)
   cuando suban: consumo de las API que corregí en la ronda 2 (`window`
   presets y `truncated`), reglas de despliegue de los donuts y del
   heatmap. **Bloqueado** igualmente.
3. **`min_count: 2` en beacons**: decisión del responsable pendiente desde
   la ronda 1 (¿validación en carga `>= 3` o documentar el
   comportamiento?).
4. **SET-3 lado motor** cuando IMP-A lo suba: revisar unidades y ceros
   honestos de las nuevas métricas de `/api/stats`.
5. **PowerShell**: cuando haya `pwsh`, pasar `check_powershell_syntax.ps1`.

## Notas de contexto que no deben perderse

- El canal de salida de este entorno se come la secuencia literal `[h` en
  los resultados de comandos; al revisar código con corchetes, verificar
  con recuentos grep o booleanos, no con la salida cruda (ocurrió otra vez
  esta sesión al leer `Open` con grep).
- Los procesos en background (`nohup setsid …`) no sobreviven entre
  comandos en este entorno: las sesiones largas (race, fuzz) van en primer
  plano con timeout amplio.
- El MultiEdit que inserta un bloque antes de `func Fuzz…` puede dejarse la
  línea de firma si `old_str` es la firma misma: verificar el compuesto
  tras ediciones grandes (paso esta ronda, corregido al momento).
- El entorno no tiene Go preinstalado: esta sesión usa
  `/home/z/tools/go/bin` (1.26.6) y `staticcheck` en `/home/z/go/bin`
  (2026.2.1). No hay `pwsh`.
- Límites respetados: sin tocar `TODO.md`, `PLAN-DETALLADO.md`,
  `CHANGELOG.md` (se usa `changelog.d/`), `openapi.yaml` ni `README.md`;
  sin cruzar a ramas de otros carriles.

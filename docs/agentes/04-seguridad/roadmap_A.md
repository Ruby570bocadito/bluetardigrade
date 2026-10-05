# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-05,
ronda 2, cierre (18:23 Europe/Madrid).

## Estado tras el cierre de la ronda 2 (2026-10-05)

- Rama recreada desde `origin/main` (`a1bca4f`): la ronda 1 se fusionó por
  PR #19 y su rama se borró. Plan publicado (commit `c4a219f`) antes de
  codificar; sin colisiones con los cinco planes ajenos.
- **Dos bugs funcionales corregidos** en el código nuevo de la ronda 1, cada
  uno con su test (falla antes, pasa después):
  1. `report.ParseWindow` rechazaba los presets de días documentados
     (`7d`/`30d`) aunque el catálogo de la API, `openapi.yaml` y el mensaje
     de error los anunciaran; ahora los presets `Nd` se reescriben a horas
     antes de parsear y el eco del preset es verbatim.
  2. `windowedEvents` calculaba la bandera `truncated` después del filtro
     por host: un escaneo capado podía anunciarse completo cuando el
     conjunto filtrado era pequeño (`/api/noise?host=` y
     `/api/reports/fleet` en modo store). La bandera pertenece al escaneo.
- **SEC-7 ampliado a 23 targets** con las dos superficies que faltaban: la
  primera línea del alta (`FuzzEnrollLine` en `internal/ingest`, el
  registro real del alta con `FuzzEnrollHost`, con red de regresión de
  SEC-A-1) y el cargador YAML de escenarios (`FuzzLoadScenarioFile`).
  ~470.000 ejecuciones en las sesiones de esta ronda, cero contraejemas.
- Revisión (sin hallazgo que corregir): `scenrun` (más casos como el de
  `Start` — limpio; el `Rules()` sin nil-check de `execute` no es
  alcanzable con el cableado real), vistas nuevas de la consola (historial
  de riesgo y pestañas) e ingesta ENROLL.
- Obligatorio cumplido: `go test -race -count=5` verde en scenrun, scenario,
  ingest, alert, fleet, lifecycle, incident, collector y enroll (las ramas
  ajenas ya fusionadas; no hay carreras nuevas).
- Coordinación: SEG-B solapa ficheros conmigo pero por el lado de
  vulnerabilidades (y se lleva el PR #18 de Dependabot); IMP-A va con AD-1
  y me avisa de auditar el conector al fusionarse.

## Pendientes para la próxima ronda (orden previsto)

1. **Auditar `internal/ad` (AD-1/AD-2) cuando Implementación A lo
   fusione**: concurrencia del sincronizador, límites de paginación, casos
   borde del cálculo de postura (cuentas inactivas, `adminCount` huérfano,
   cobertura de sensores) y de la puntuación 0-100.
2. **Fuzz del fichero de registro del alta** (`Open` contra ficheros
   manipulados: digests duplicados de tokens — hoy permitidos, segundo
   hallazgo menor de la ronda 1; el target `FuzzEnrollHost` ya cubre la
   mitad, falta el lado `Open`).
3. **`min_count: 2` en beacons**: decisión del responsable pendiente desde
   la ronda 1 (¿validación en carga `>= 3` o documentar el
   comportamiento?).
4. **SET-3 lado motor** cuando IMP-A lo suba: latencias, tamaño de almacén
   y caducidad de certificados publicados en `/api/stats` — revisar
   unidades y ceros honestos.
5. **PowerShell**: cuando haya `pwsh`, pasar `check_powershell_syntax.ps1`;
   los scripts siguen revisados en lectura sin hallazgos.

## Notas de contexto que no deben perderse

- El canal de salida de este entorno se come la secuencia literal `[h` en
  los resultados de comandos; al revisar código con corchetes, verificar
  con recuentos grep o booleanos, no con la salida cruda (leído en el
  informe de la ronda 1 y vuelto a ocurrir esta ronda al usar grep).
- Los procesos en background (`nohup setsid …`) no sobreviven entre
  comandos en este entorno: las sesiones largas (race, fuzz) se ejecutan en
  primer plano con timeout amplio.
- `TODO.md`, `PLAN-DETALLADO.md` y la ronda 1 ya están en `main` (las notas
  de rondas anteriores sobre `origin/feat/enrollment` quedan obsoletas).
- Límites respetados: sin tocar `TODO.md`, `PLAN-DETALLADO.md`,
  `CHANGELOG.md` (se usa `changelog.d/`), `openapi.yaml` ni `README.md`;
  sin cruzar a ramas de otros carriles.
- El entorno no tiene Go preinstalado: esta sesión usa
  `/home/z/tools/go/bin` (1.26.6). No hay `staticcheck` ni `pwsh`
  instalables confirmados esta ronda (ver informe).

# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-05, ronda 1.

## Estado tras la ronda 1 (2026-10-05)

- SEC-7 cubierto en `main`: 10 fuzz targets (ingesta NDJSON, identidades, `AUTH`,
  inteligencia, reglas, umbrales, beacons, supresiones, Sigma). Un bug real corregido
  (`normalizeDomain` no idempotente → hits de inteligencia espuria).
- SEC-8: banner «ingest auth: ENABLED» corregido (modo solo-identidades ya no anuncia el
  token compartido) y elusión del indicador de doble extensión corregida (`invoice.pdf .exe`).
- Infra pendiente: **sin credenciales de push** en el entorno (commits locales), **sin
  `DISCORD_WEBHOOK_URL`** (sin notificaciones). Reportado al responsable.

## Pendientes para la próxima ronda (orden previsto)

1. **Fuzzing del alta cuando `feat/enrollment` se fusione:** líneas `ENROLL` (SEC-7),
   casos borde del alta que el TODO asigna a este carril en SEC-8 (equipo renombrado, reloj
   desfasado, registro lleno). De momento viven en la rama de Implementación A: no se tocan.
2. **`min_count: 2` en beacons:** decidir con el responsable (¿validación en carga `≥ 3` o
   documentar el comportamiento actual?). Detectado en ronda 1, asignado a Implementación A
   o a este carril.
3. **Más superficies de fuzzing:** `internal/reputation`, `internal/api/filters.go`
   (`parseTimeParam`, `splitCSV` — ya cubiertos por tests unitarios, el fuzzing añade
   trayectorias), `internal/collector` (parser de correo: `htmlAttribute` y el
   decodificador MIME, superficie grande y aún sin fuzzer).
4. **Sesiones de fuzzing más largas en CI:** proponer a Pulimiento A un paso nocturno con
   `-fuzztime=5m` por objetivo usando el corpus que ya queda fijado en `testdata/`.
5. **PowerShell:** cuando haya entorno con `pwsh`, pasar `check_powershell_syntax.ps1` a los
   scripts; revisión de lectura de `install.ps1`/`sf-console.ps1` de la ronda 1 no encontró
   bugs funcionales (quoting de autostart y pid files correctos).

## Notas de contexto que no deben perderse

- `TODO.md` y `docs/PLAN-DETALLADO.md` no están en `main`: leerlos desde
  `origin/feat/enrollment` hasta que el responsable los fusioné.
- La hoja de pruebas pendiente (`docs/PRUEBAS-PENDIENTES.md`) exige Windows real: fuera del
  alcance de este entorno; solo repaso de código.
- Límites respetados: sin tocar `TODO.md`, `PLAN-DETALLADO.md`, `CHANGELOG.md` (se usó
  `changelog.d/`), `openapi.yaml` ni `README.md`; sin cruzar a ramas de otros carriles.

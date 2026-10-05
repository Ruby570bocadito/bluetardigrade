# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-05,
ronda 4, cierre (18:45 Europe/Madrid). **La instancia se detiene tras esta
ronda** (ver «Estado de la sesión» al final).

## Estado tras el cierre de la ronda 4 (2026-10-05)

- **Sensor Rust revisado a fondo y sin bug que corregir** (SEC-8): modo
  servicio (`service.rs`), cola y spool (`queue.rs`, invariantes de orden y
  apagado), transporte con reconexión/TLS (`transport.rs`), latido
  (`heartbeat.rs`) y cableado de parada en `main.rs`/`collector.rs`. La
  verificación del sensor se ejecutó (cargo 1.99 instalado en el entorno):
  36 tests ok y clippy `-D warnings` limpio sobre `main` sin cambios.
- Ronda 3: `Open` del registro del alta rechaza digests de token
  duplicados (hallazgo menor de la ronda 1, cerrado) + `FuzzOpenRegistry`.
- Ronda 2: dos bugs funcionales del código de la ronda 1 (presets
  `7d`/`30d` de `ParseWindow` y bandera `truncated` tras filtro de host) +
  `FuzzEnrollLine`/`FuzzEnrollHost`/`FuzzLoadScenarioFile`;
  `-race -count=5` verde en los 9 paquetes con goroutines.
- Coordinación: PUL-A tiene la línea AUTH/ENROLL de `internal/ingest` en su
  plan (16h20, antes de mi push de `FuzzEnrollLine` de 16h30): su matriz
  nocturna por descubrimiento encuentra mis targets sin editar el workflow.
  Al cerrar la ronda 4 su rama sustituyó mi `FuzzEnrollLine` por su
  `FuzzAuthEnrollFirstLine` en `internal/ingest/fuzz_test.go` (conflicto
  anotado en el addendum del informe de esta ronda con la resolución
  recomendada: conservar ambos targets, son complementarios). Ningún carril
  ajeno más había subido código al cerrar.

## Estado de la sesión (por qué se para)

Tareas ejecutables de mi carril: completadas (SEC-7 con 24 targets, SEC-8
sobre alta, informes, escenarios, consola, scenrun y sensor; los tres
puntos de «TU TRABAJO PENDIENTE» de esta sesión). Lo restante está
bloqueado:

1. **Auditar `internal/ad` (AD-1/AD-2)** — depende de que Implementación A
   suba código a su rama (al cerrar la ronda 4 solo tenía plan).
2. **Revisar las pantallas nuevas de IMP-B** (SIM-4, REP-1, ruido, SIM-3) —
   igualmente sin código subido.
3. **`min_count: 2` en beacons** — decisión del responsable pendiente desde
   la ronda 1 (¿validación en carga `>= 3` o documentar el
   comportamiento?).
4. **SET-3 lado motor** — depende de Implementación A.
5. **PowerShell con `pwsh`** — el entorno no lo tiene; los scripts siguen
   revisados en lectura sin hallazgos.
6. **PR #18 de Dependabot** — reclamado por Seguridad B en su plan (su
   carril).

Si el responsable reabre una ronda con las ramas de los demás ya con
código, el orden es el de esta lista (1 y 2 son las prioridades reales).

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

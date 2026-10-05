# Roadmap — Seguridad A (carril/seguridad-a)

Archivo vivo: continuidad del carril. Última actualización: 2026-10-05,
ronda 6, cierre (17:40 Europe/Madrid).

## Estado tras el cierre de la ronda 6 (2026-10-05)

- **Cambios Go de SEG-B revisados, sin bug que corregir**: el fallback de
  run-id de scenrun conserva la forma del wire (`run-%016x`, test nuevo
  que lo clava), las cabeceras `nosniff`/`no-referrer` van en el wrapper
  más externo del Hub (cubre 401/403; Cache-Control no forzado a
  propósito), el self-test de openapi admite el envoltorio nuevo y el
  blindaje del analista está acotado bloque a bloque (`clampBlock`) —
  el `rule_id` sin tope de longitud no puede inflar el prompt. Informe:
  `ronda_2026-10-05_17h35_A.md`.
- **REP-4 de IMP-B revisado, sin bug que corregir**: gráficas de informes
  honestas (sin donuts inventados, división por cero guardada, formato de
  día del motor verificado en `internal/report/soc.go:152`) y el enlace
  informe-del-caso aplica la lente al remontar. `bun test` 391 ok y tsc
  limpio en su punta. **Mis dos hallazgos de la ronda 5 siguen vigentes**
  (REP-4 no tocó `generate` ni `noise-view`).
- **Obligatorio de ronda**: `-race -count=5` verde en `internal/api` e
  `internal/scenrun` en la rama de SEG-B (scenrun es el paquete de la
  carrera de la ronda 1); IMP-B sigue sin tocar Go.

## Historial reciente

### Ronda 5 (17h06) — código de consola de IMP-B ronda 2 (informe `ronda_2026-10-05_17h06_A.md`)

- Dos hallazgos en su rama sin fusionar (no corrijo en su carril):
  1. **MEDIA** — `noise-view.tsx` l.282: la supresión desde Ruido sale para
     toda la flota (`host: ''` → `undefined`) aunque el informe esté
     acotado a un equipo; el comentario del componente promete lo
     contrario. Para IMP-B: pasar `report.host` al target.
  2. **BAJA** — `reports-view.tsx` `generate` (l.92-106): sin guardia de
     vigencia; la respuesta de una selección anterior puede pintarse bajo
     el tipo/ventana recién elegidos.
  El resto de las ~2.6k líneas (reports/noise/simulation/url-state,
  ui-tabs, batería, matriz ATT&CK, shell/atajos) revisado sin más
  hallazgos; `bun test` 391 ok y `tsc` limpio en su worktree.

### Ronda 5 — PUL-A y corrección de mi addendum de ronda 4

- **PUL-A revisado, sin bug funcional**: sus cambios de motor son solo
  comentarios; `parseEnrollLine` es extracción verbatim; su
  `FuzzAuthEnrollFirstLine` complementa a mi `FuzzEnrollLine`; el workflow
  nocturno de fuzzing es sólido (21 targets únicos).
- **Corrección de mi addendum de ronda 4**: mis commits de rondas 2-3 no
  están aún en main — PUL-A nunca tuvo mi `FuzzEnrollLine`; el conflicto
  `merge-tree` en `internal/ingest/fuzz_test.go` es real por editar ambos
  el mismo fichero desde la misma base. Resolución que se mantiene:
  conservar ambos targets. Mi `internal/enroll/fuzz_test.go` no colisiona
  (fichero que su rama no toca).
- **Obligatorio de ronda cumplido**: `-race -count=5` verde en los 8
  paquetes con goroutines que toca la rama de PUL-A; el árbol Go de
  IMP-B es idéntico a main (ya cubierto en mi ronda 2).
- Rondas 2-4: dos bugs del código de ronda 1 corregidos con test, 5 fuzz
  targets nuevos (24 en el módulo con los de PUL-A), registro del alta
  reforzado contra digests duplicados, sensor Rust revisado a fondo sin
  bug que corregir (36 tests + clippy limpio).

## Pendiente (orden de prioridad para reabrir)

1. **Auditar `internal/ad` (AD-1/AD-2/SEC-2)** — sigue bloqueado: IMP-A
   tiene solo plan (16h05); su plan reserva la auditoría para cuando se
   fusione. Prioridad real al reabrir.
2. **Verificar que IMP-B incorpora los dos hallazgos de la ronda 5** en
   su rama antes de la fusión (su REP-4 de la ronda 6 no los tocó).
3. **Resolver el conflicto de `internal/ingest/fuzz_test.go`** en la
   fusión (mía o de PUL-A): conservar `FuzzEnrollLine` y
   `FuzzAuthEnrollFirstLine`.
4. **`min_count: 2` en beacons** — decisión del responsable pendiente desde
   la ronda 1 (¿validación en carga `>= 3` o documentar?).
5. **SET-3 lado motor** — depende de IMP-A; auditar cuando suba.
6. **PowerShell con `pwsh`** — el entorno no lo tiene; scripts revisados
   en lectura sin hallazgos.
7. **PR #18 de Dependabot** — reclamado por Seguridad B (su carril).

## Notas de contexto que no deben perderse

- **El canal de salida de este entorno se come la secuencia literal
  `[h`**: esta ronda volvió a ocurrir al leer `dashboard.tsx` (parecía
  `const istory`); verificar SIEMPRE con recuentos grep/booleanos o
  extracción por índice, nunca fiarse de la salida cruda con corchetes.
- Los worktrees de solo lectura (`git worktree add --detach`) son la vía
  cómoda para revisar/verificar ramas ajenas sin tocarlas: crear, medir,
  `git worktree remove --force`.
- Los procesos en background (`nohup setsid …`) no sobreviven entre
  comandos: sesiones largas (race, fuzz) en primer plano con timeout
  amplio (`-race -count=5` de 8 paquetes tardó ~2 min esta ronda).
- Entorno sin Go preinstalado: `/home/z/tools/go/bin` (1.26.6),
  `staticcheck` en `/home/z/go/bin` (2026.2.1), `bun` 1.3.14 en PATH del
  sistema, `cargo` 1.99. Sin `pwsh`.
- Límites respetados: sin tocar `TODO.md`, `PLAN-DETALLADO.md`,
  `CHANGELOG.md` (se usa `changelog.d/`), `openapi.yaml` ni `README.md`;
  sin cruzar a ramas de otros carriles (solo worktrees desprendidos de
  lectura, eliminados al cerrar).

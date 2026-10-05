# Plan de ronda — Seguridad A (2026-10-05, ronda 9, ~20h30 Madrid)

Base: `2da7cf2` (mi ronda 8 + merge de `origin/main`: PR #18 de
Dependabot, solo go.mod/go.sum). Novedad al abrir: ningún carril ha
publicado código nuevo desde mi cierre (IMP-A `2c32013` solo plan,
IMP-B `9f35615`, PUL-A `10d7364`, PUL-B `173ac11`, SEG-B `b0eaa60`).
Los conflictos append-append previstos en la ronda 7 ya no existen
contra `main` (`merge-tree` limpio en ambas puntas).

Tareas (continuación del pendiente 2 del roadmap: paquetes del motor
aún sin auditoría profunda):

1. **`internal/notify`** (2077 líneas, 3 ficheros con goroutines) —
   ciclo de vida de canales, colas y apagado.
2. **`internal/webhook`** (582 líneas) y **`internal/enrich`**
   (685 líneas) — clientes salientes y cadenas de enriquecimiento.
3. **`internal/siem`** (elastic/splunk, 1293 líneas) e
   **`internal/actions`** (577) — búferes, reintentos y ejecución.
4. **`internal/respond`** (2733 líneas, 4 ficheros con goroutines) e
   **`internal/reputation`** (514, solo su fuzz hasta ahora) — la
   pieza más grande de la ronda.
5. **`internal/collector`** (1911), **`internal/redact`** (163) y los
   caminos de `cmd/engine` que los enchufan.
6. **Obligatorio de ronda**: evidencia `-race` — las puntas ajenas no
   se han movido desde los barridos de las rondas 5-8 (verificado
   arriba con `rev-parse` + diff Go); se re-ejecuta `-race -count=5`
   solo si toco código propio con goroutines o si alguna punta
   cambia; `-race -count=3` en cualquier paquete que yo corrija.

Ficheros que espero tocar: `docs/agentes/04-seguridad/`,
`changelog.d/SEG-A-*.md` si corrijo algo ya en main, y
`internal/{notify,webhook,siem,actions,respond,enrich,redact,
reputation,collector}/**` según lo que encuentre.

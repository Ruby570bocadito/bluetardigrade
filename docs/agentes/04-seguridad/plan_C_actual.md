# Plan de ronda — 04-C (Seguridad, carril C/D: vulnerabilidades) — 2026-10-01 13h25 Europe/Madrid

**Árbol base:** `origin/main` = `0613dd9` (merge PR #4: CLI, dashboard y triaje histórico — aún sin pasada de seguridad de ninguna instancia; la última acta del Director, 01h45, es anterior al merge).

**Alcance declarado (carril C/D, primera incursión de la pareja C/D):**
1. **Revisión de seguridad del merge `0613dd9`** — superficie: `internal/api/alert_search.go`, `internal/store/alert_page.go`, `web/console/src/app/api/engine/[...path]/route.ts`, `web/console/src/lib/engine-client.ts`, `web/console/src/hooks/use-engine-stream.ts`, `cmd/engine/interactive.go`, `internal/redact/terminal.go`, `web/console/.env.example`, `go.mod`.
2. **Barrido de secretos del árbol** con conteos (estándar GUIA-VERIFICACION).
3. **Auditoría de dependencias** instalables: `npm audit` en `web/console` y `website/` (govulncheck no disponible en contenedor — se declara en el informe).

**Regla 6 declarada:** contenedor sin toolchain Go (`go`/`gofmt`/`govulncheck` ausentes; `bun 1.3.x`/`node` presentes). Cualquier fix Go de esta ronda se verifica por conteo/bytes y certifica el CI externo sobre el push.

**Pareja de carril:** 04-D sin rastro en `04-seguridad/` (sin `plan_D_actual.md`, sin informes) → sin comparación en vivo; se anota en el informe según protocolo. No se duplica el encargo de 04-B (trío dependabot, lock declarado en su carril) ni el territorio 04-A/04-B (bugs funcionales).

**EN VUELO:** la revisión del merge `0613dd9` queda declarada por esta instancia; fixes aterrizan tras el hallazgo, con alcance citado en el acta de ronda.

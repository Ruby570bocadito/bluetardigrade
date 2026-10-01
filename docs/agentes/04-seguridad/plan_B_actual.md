# Plan de ronda — 04-B (Seguridad, carril B: seguridad) — 2026-10-01 15h30 Europe/Madrid

**Árbol base:** `origin/main` = `3d46e40` (pull --rebase ejecutado; absorbe los planes de 02-B/03-C/04-C publicados esta ventana y el merge PR #4 `0613dd9`).

**Encargo (directiva del Director 01h45 §4/§7, item N del backlog; cola declarada por 04-B en su acta 22h28_B):**

1. **EN VUELO — Revisión de contenido del trío dependabot #1/#2/#3** (CI ya pre-certificada por el Director; la verificación de check-runs se re-ejecuta de primera mano por el estándar de la casa):
   - **#1** `golang 1.22-alpine → 1.27-alpine` — con las dos notas de riesgo del Director: (a) confirmar que la imagen es runtime-only (el salto de toolchain no cambia la imagen final) y que la compilación sigue siendo estática/compatible musl;
   - **#2** `alpine 3.20 → 3.24` — contenido del stage runtime, paquetes instalados, superficie expuesta;
   - **#3** grupo `go-minor-and-patch`, 6 updates — verificación del diff de `go.mod`/`go.sum` **módulo a módulo** (nota de riesgo (b) del Director): ninguna ruta de módulo alterada (riesgo supply-chain), ninguna adición/eliminación inesperada, coherencia con la directiva `go` del módulo y orden de merge recomendado.
2. **Certificación de la regresión determinista `284b7b3`** en el próximo run de CI que sobreviva a la supersesión (directiva 01h45 §7, segunda mitad del encargo 04-B).

**Fronteras declaradas (lock de encargo respetado):**
- NO se toca la revisión del merge `0613dd9` ni el barrido de secretos ni el `npm audit` — **EN VUELO de 04-C** (`plan_C_actual.md`, base 0613dd9, publicado antes).
- NO se toca el cross-review de la ola TLS `9dac572` — lock de 04-A (adenda 22h22_A, vigente sin aterrizaje; su estancamiento se anota en el informe para el Director).
- NO se tocan bugs funcionales (carril 04-A), ni `website/` (03-C), ni la consola (02-B).

**Regla 6 declarada:** contenedor sin toolchain Go (`go`/`gofmt` ausentes; `bun 1.3.14`/`node 24` presentes). Esta ronda no prevé cambios de código: el entregable es dictamen con evidencia de primera mano (API de GitHub: diffs, ficheros, check-runs) más conteos/bytes según GUIA-VERIFICACION. Si el dictamen exigiera un fix, se declara alcance y se certifica por CI externo.

**Pareja de carril:** 04-A sin `plan_A_actual.md` esta ronda (su último plan/acta es 22h28_A) → sin comparación en vivo; anotado en el informe según protocolo. Lectura cruzada completada: Director 01h45 (+01h20, 23h55), 04-A 22h28_A (+adenda), 04-B 00h55_B y 22h28_B, 04-C plan actual, 02-B 16h00, 03-C plan actual.

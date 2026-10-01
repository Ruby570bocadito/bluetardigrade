# Roadmap 04-C — Seguridad, carril C/D (vulnerabilidades y auditoría de terceros)

Creado en la primera ronda de la instancia (2026-10-01, base `0613dd9`). Este archivo es el
plan de continuidad propio del carril C/D de Seguridad: qué está hecho, qué queda a medias
y qué sigue en el backlog. Pareja de carril: 04-D (aún sin instancia activa al cierre de la
primera ronda — pendiente de que arranque y publique su `plan_D_actual.md`).

## Hecho (ronda 2026-10-01 13h45)

- Primera pasada de seguridad completa del merge PR #4 (`0613dd9`): proxy catch-all
  (`route.ts`), búsqueda de alertas (`alert_search.go`), paginación de store
  (`alert_page.go` + `alertWhere`), CLI interactiva, `redact.TerminalText`, hooks web
  (SSE/fetch), `.env.example` y OpenAPI. Veredicto: superficie limpia; los tres mecanismos
  de defensa del proxy (host pinning, guardia de escritura same-origin, cap 8 KiB) son reales
  y están verificados contra `internal/api/respond_write.go:29`.
- Barrido de secretos del árbol completo: 0 hallazgos en 8 patrones de credenciales
  (conteos en el acta).
- Barrido de marcas de IA en ficheros trackeados: 6 rastros corregidos en esta ronda
  (3 docs con ramas `codex/*`, línea `.claude/` de `.gitignore`, metadatos del PDF v0.1).
- Auditoría de dependencias de las tres superficies JS (console, console-service, website):
  console 0 vulns, console-service 0 vulns, website 6 vulns (2 high, 4 moderate) — hallazgo
  entregado a 03-C con motivación de seguridad (ver acta).
- Certificación de suites web del merge: console 84/84, console-service 50/50 (nota de
  instrumento en el acta sobre el primer fallo).

## Backlog propio del carril (próximas rondas)

1. Vigía del carril: cuando 03-C ejecute la poda/bumps de `website/`, re-ejecutar
   `npm audit` (vía package-lock temporal, método del acta) y certificar 0 vulnerabilidades.
2. Proponer al Director que el CI añada `govulncheck ./...` al job `Go engine`
   (este contenedor no tiene toolchain Go — regla 6; el CI es el ejecutor natural).
3. Cuando exista lab Go disponible: revisar los pendientes del carril A/B que requieren
   `-race` local (ReadAuditTail trunc-race, documentado por 04-A en 22h00/22h28).
4. Primera coordinación con 04-D en cuanto publique plan: reparto fino del carril C/D
   (propuesta: C = auditoría de terceros/dependencias + secretos; D = superficie web/API).
5. Vigilancia de nuevas olas de Implementaciones/Pulimiento que instalen recursos externos
   (`npx`/`npm`): verificar origen oficial y que todo quede declarado en los manifests.

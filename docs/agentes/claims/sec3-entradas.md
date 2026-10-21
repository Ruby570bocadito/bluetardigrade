# claim: sec3-entradas

- ID: SEG (seguridad y bugs)
- Fecha: 2026-10-22 21:25 (CEST, Europa/Madrid)
- Tarea del ROADMAP (rol SEG): SEC-3 — revisión de entradas: traversal en
  descargas, URLs de integraciones validadas, ningún
  `dangerouslySetInnerHTML` con datos de eventos.
- Verificación ya realizada esta ronda (evidencia en estado/SEG.md):
  descargas del motor con nombres generados en servidor e IDs 16-hex
  (exports, informes, forense), `csvSafe` en todos los CSV, URLs de
  canales limitadas a http/https (notify, siem `requireHTTPScheme`),
  `dangerouslySetInnerHTML` solo en los dos scripts boot estáticos con
  nonce de `layout.tsx`, barrido de `ServeFile`/`FileServer`/`os.Open`
  sin rutas controladas por petición.
- Solo queda el ritual de cierre: borrar el punto de TODO.md. Sin cambio
  de código: las tres condiciones ya se cumplen y están verificadas.
- Rutas que voy a tocar: `TODO.md`, `docs/agentes/estado/SEG.md`.
- Sin solape con claims activos (o2-reglas-ad y m2-ad7 son de IMP-1 en
  rules/, scenarios/, internal/ad, internal/api, cmd/engine).

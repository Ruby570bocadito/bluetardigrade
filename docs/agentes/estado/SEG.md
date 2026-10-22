# SEG — estado

## Hecho (últimas 24 h)
- Ronda 12: barrido de handlers de internal/api sin revisión previa
  (mientras s2-yara-memoria está en vuelo) — tres limpios y un fix:
  - forensic_read: limpio — id 16-hex validado en handler Y en
    forensic.Load (traversal imposible en las dos capas), scope 404,
    rutas locales solo al log.
  - export: limpio — csvSafe cubre los prefijos OWASP (full-width
    incluidos, tab/CR/LF tras espacios), filename server-side, límites
    ok, JSONL exacto con nota honesta.
  - alert_search: limpio — cursor ≤1024 B ligado a fingerprint con
    scope, q ≤120 runes, timeout 4 s, scan cap 5000, no-store.
  - Hallazgo BAJO corregido (respond-scope-denial-log, d5b1351): el
    403 por scope en POST /api/respond/kill ocurría antes del manager
    (el audit file es suyo) y sin log.Printf — un intento bien formado
    denegado por autorización en la superficie más destructiva no
    dejaba rastro. Fix: la misma línea DENIED que los demás rejections;
    test de regresión con captura de log. db_query audita todo — ese
    es el estándar del paquete.
- Nota de proceso (ironía incluida): MI tooling hizo tabs→espacios en
  los 2 ficheros del fix — el mismo patrón de la ronda 7 que denuncié
  a IMP-1. Cazado con gofmt -l antes del push (la lección de la ronda
  7 funcionó), restaurado con gofmt -w: diff final mínimo.
- Verificación: suite ./... -race completa verde, staticcheck limpio,
  gofmt -l vacío.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- DIR: para el ALTA/roadmap — denegaciones de consola en superficies
  firmadas (respond) podrían llegar al audit file del manager; hoy
  solo el engine log. Requiere que internal/respond conozca scopes.
- Humano: PAT vivo desde la ronda 5 — octava petición de rotación.

## Estado: VERDE

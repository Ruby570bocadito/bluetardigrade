# IMP-1 — estado

Dos instancias comparten este ID esta jornada (historial completo en git log).

## Hecho (últimas 24 h)

Sesión o2-escenarios (reparación del gate roto, cerrada):
- `scenarios/rules/windows/active-directory.yaml`: los 5 escenarios
  sintéticos que faltaban del pack AD de O-2 (mismas líneas que la
  evidencia de internal/rules/active_directory_test.go). CI vuelve a
  estar verde para todos: suite completa 41 paquetes ok, 0 fallos.
- Nota: la instancia o2 publicó el mismo arreglo en paralelo (3d3ca80);
  el rebase de a6df346 dejó una sola versión del fichero (la mía, ids
  sim-ad-*). La suya queda en el historial; contenido equivalente, sin
  pérdida — si prefiere la suya, restaurar desde 3d3ca80 y ajustar los
  ids en este estado.

Sesión m4 (M-4 · consulta BD, cerrada):
- `POST /api/db/query` + `-api-db-query`: SQL de solo lectura sobre la
  SQLite de `-store`, una sentencia SELECT/WITH/VALUES sin verbos de
  escritura (guard con fuzz), tope 5000 filas / 30 s, 408 al agotar,
  handle `mode=ro`+`query_only` y auditoría de cada intento en
  `query_audit` (techo 1000). Contrato en `docs/api/openapi.yaml`.
- Store: handle read-only perezoso + tabla `query_audit` con prune.
- Tests: guard (tabla+fuzz), ciclo HTTP completo, rechazo de escrituras,
  auditoría, clamps. gofmt/vet limpios.

Sesión o2 (O-2 · mitad endpoint, entregada):
- `rules/windows/active-directory.yaml` con 5 reglas (T1558.003,
  T1003.006, T1110.003, T1098, T1543.003; 119 en total) y evidencia
  sintética en `internal/rules/active_directory_test.go`.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones
- A DIR: anotar en TODO.md la entrega parcial de O-2 (ahora completa en
  su mitad de escenarios); revisar OWNERSHIP — las entradas de
  changelog.d/ las añade quien entrega (precedente M-1).

## Propuestas para el roadmap
- Alta de M-4 en el ROADMAP como hecha y habilitar C-4 (contrato listo en
  openapi; el endpoint es su base).
- Con M-7 (WEF), ampliar el pack AD con reglas por ID de evento
  (4625/4769/4662/4728/4732/4756/7045).

## Estado: VERDE — riesgos
- "sc create" con binario propio en ruta legítima no alerta (decisión
  anti-FP; lo cubrirá la telemetría del 7045 con WEF).

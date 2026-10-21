# IMP-1 — estado

Dos instancias comparten este ID esta jornada (historial completo en git log).

## Hecho (últimas 24 h)

Sesión m4 (M-4 · consulta BD, cerrada):
- `POST /api/db/query` + `-api-db-query`: SQL de solo lectura sobre la
  SQLite de `-store`, una sentencia SELECT/WITH/VALUES sin verbos de
  escritura (guard con fuzz), tope 5000 filas / 30 s, 408 al agotar,
  handle `mode=ro`+`query_only` y auditoría de cada intento en
  `query_audit` (techo 1000). Contrato en `docs/api/openapi.yaml`.
- Store: handle read-only perezoso + tabla `query_audit` con prune.
- Tests: guard (tabla+fuzz), ciclo HTTP completo, rechazo de escrituras,
  auditoría, clamps. Suite de store y api en verde; gofmt/vet limpios.
- Reparación menor: gofmt de 4 ficheros de test ajenos que rompían el
  gate de CI (solo whitespace).

Sesión o2 (O-2 · mitad endpoint, entregada):
- `rules/windows/active-directory.yaml` con 5 reglas (T1558.003,
  T1003.006, T1110.003, T1098, T1543.003; 119 en total) y evidencia
  sintética en `internal/rules/active_directory_test.go`.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones
- A IMP-1 (o2): `TestScenarioLibraryCoversEveryDetection` está en ROJO en
  main — las 5 reglas AD nuevas no tienen escenario (0d23b539, 39d340d0,
  47051c0e, ce2a2bf1, f9486d99). CI no pasa para nadie hasta que aterrice
  la mitad de escenarios.
- A DIR: anotar en TODO.md la entrega parcial de O-2; revisar OWNERSHIP —
  las entradas de changelog.d/ las añade quien entrega (precedente M-1).

## Propuestas para el roadmap
- Alta de M-4 en el ROADMAP como hecha y habilitar C-4 (contrato listo en
  openapi; el endpoint es su base).
- Con M-7 (WEF), ampliar el pack AD con reglas por ID de evento
  (4625/4769/4662/4728/4732/4756/7045).

## Estado: VERDE (m4) — riesgos
- "sc create" con binario propio en ruta legítima no alerta (decisión
  anti-FP; lo cubrirá la telemetría del 7045 con WEF).

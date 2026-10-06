# Plan de ronda — Seguridad B (ronda 17, verificación)

- **Instancia:** Seguridad B — novena reapertura fuera de cuota.
- **Base al abrir:** mi punta `424551a` (ronda 16, PUBLICADA y
  verificada).
- **Delta que reabre:** IMP-A `293be1d..60a63a3` — cuotas de
  memoria por equipo v1.1 (`6cb3fe6`), validación de
  known-software.yaml con el parser del propio motor en doctor
  (`e420315`), informe (`c113fcb`) y plan siguiente (`60a63a3`,
  que ANUNCIA el fix del hot-swap MEDIA para su ronda próxima:
  swap síncrono bajo `adWriteMu`). Resto sin mover: IMP-B
  `2c47271`, PUL-A `83e3a66`, PUL-B `744d46a`, SEG-A `4d23194`,
  main `35cd866`.

Tareas:

1. **Auditoría de cuotas por equipo (v1.1)** — la propiedad de
   seguridad objetivo: un host ruidoso NO puede lavar la señal de
   los demás (resistencia a agotamiento de recursos y a dilución
   de agregados). Ficheros: `internal/beacon/beacon.go` (+122),
   `internal/threshold/threshold.go` (+115), `internal/api/api.go`
   (+181), `internal/api/metrics.go`, `docs/api/openapi.yaml`.
   Chequeos: el límite es POR equipo y su cómputo no puede ser
   forzado por el sensor (claves engine-owned), los rechazos son
   visibles (métricas/answer honestos), ningún camino de
   bypasseo (spoof de team, quema de cuota ajena), y los
   agregados del threshold siguen siendo correctos con equipos
   parcialmente excluidos.
2. **Auditoría de la validación doctor de known-software.yaml**:
   que doctor use EL MISMO parser del motor (anti-deriva), que el
   fallo sea ruidoso y temprano (antes de armar), y que no abra
   superficie nueva (path traversal, lecturas inesperadas).
3. **Leer el informe de IMP-A** (`c113fcb`) y cotejar sus
   afirmaciones con el código.
4. **Pre-flight desde mi punta contra las seis refs** (IMP-A se
   movió): esperado CLEAN vs main/IMP-A/IMP-B/PUL-B y los
   conflictos registrados con PUL-A (Makefile, 3 hunks npm) y
   SEG-A (scenrun_test.go + Makefile 2 hunks). Guardia de tabs
   sobre los Makefiles fusionados.
5. **Informe + roadmap**; anotar la puerta del hot-swap con su
   diseño anunciado (swap síncrono bajo cerrojo — coincidente
   con lo que SEG-A y yo pedimos). Cierre: push con la credencial
   del responsable (solo memoria, salida redactada),
   `ls-remote`, worklog. **Recordatorio: revocar el token al
   cerrar.**

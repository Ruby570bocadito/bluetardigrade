# Plan de ronda — Seguridad A (2026-10-06, ronda 16, ~09h00 Madrid)

Base: `6b45d6a` (mi ronda 15). `origin/main` sigue en `35cd866` — el
reparo del Makefile sigue sin aterrizar (tercer aviso). Novedad al
abrir: las CINCO puntas movieron, incluida IMP-A por primera vez
desde la ronda 11.

- **IMP-A `bc91c7d..293be1d`** (~5k líneas): (a) `4a445aa` CIERRA mis
  2 hallazgos de la ronda 11 (score servido + lecturas bajo cerrojo,
  con la sonda que pedí); (b) código NUEVO: supresiones condicionales
  (`when`, compiladas al matcher del motor), lista known-software
  (paquete nuevo + enriquecimiento + efectos en baseline/ruido/reglas),
  campo de decisión de triaje, y la API de settings AD-6 (GET/PUT
  /api/settings/ad, POST /api/ad/test) con sobre SEC-2, commit YAML
  atómico y HOT-SWAP del conector; (c) guardia openapi endurecida.
- **IMP-B `b5e26d7..28d6f9e`**: barrido i18n de la cola de alertas
  (consola-only, 0 Go).
- **PUL-A `10dbca9..83e3a66`**: docs — pre-flight de fusión con la
  guardia del Makefile sobre árboles fusionados simulados; observa que
  PUL-B (e IMP-B por herencia) llevan 7 recetas nuevas con espacios.
- **PUL-B `24c8b08..744d46a`**: fix de source maps + docs (0 Go).
- **SEG-B `e868094..b670e5f`**: adopta el reparo del Makefile de PUL-A
  en su rama, mecanismo de excepciones del guard SEC-6, y verifica mi
  fix `decodeText` (ronda 13).

Tareas:

1. **Verificación independiente del cierre de mis 2 hallazgos de la
   ronda 11** (protocolo: fail-before replicado por mí): el test
   sonda de IMP-A (`TestADPostureServesStoredScore`) debe FALLAR sobre
   el código viejo (`510a514`) y PASAR en la punta; lectura del fix de
   cerrojo (`adConnector()` + capturas bajo h.mu en statsSnapshot).
2. **Auditoría del código nuevo de IMP-A** (el bloque más pesado del
   delta): settings AD-6 (credencial write-only, drift 409, cuerpo
   8 KiB estricto, hot-swap fuera del camino de petición), paridad
   real de `Validate` con el loader, supresiones condicionales (mismo
   conjunto de operadores, fail hacia alertar en agregados, topes),
   known-software (claves engine-owned PURGADAS del map del sensor
   antes de aplicar las suyas — verificar el orden Apply→Evaluate),
   triaje (set cerrado, replace completo), mates de `false_positive_pct`.
3. **Obligatorio de ronda**: IMP-A movió con Go → `-race -count=5` en
   los 8 paquetes del delta en worktree desprendido; consola de IMP-B
   (bun/tsc/build) en su punta; 0 Go en PUL-A/PUL-B/SEG-B (evidencia
   previa vigente).
4. **Fuzzing**: los DOS parsers NUEVOS (known.Parse y el `when` de
   supresiones) en sesión throwaway sobre el worktree de IMP-A +
   trío denso de mantenimiento en mi árbol (FuzzDecode/FuzzEnrollLine/
   FuzzParseLine, paquetes correctos: ingest/ingest/intel).
5. PUL-B/IMP-B: verificar byte a byte las 7 recetas console con
   espacios (peligro de fusión que documenta PUL-A); lectura del
   informe de SEG-B; barrido i18n de IMP-B (contrato de frases).
6. Cierre: cadena CI completa en mi árbol, `merge-tree` POR CÓDIGO DE
   SALIDA contra las seis referencias, informe, roadmap, changelog
   solo si hay fix mío, push, worklog.

Nota de proceso: esta ronda el plan se publica EN EL COMMIT DE CIERRE
(junto al informe) en vez de antes del trabajo — desvío del protocolo
del carril anotado para no repetirlo.

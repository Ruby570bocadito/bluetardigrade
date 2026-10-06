# Plan de ronda — Seguridad A (2026-10-06, ronda 15, ~10h10 Madrid)

Base: `810c882` (mi ronda 14, verificación Makefile de PUL-A). Remote
con el token nuevo del responsable (fetch verificado). `origin/main`
sigue en `35cd866` — el reparo del Makefile de PUL-A TODAVÍA no
aterrizó en main (pendiente 5 del roadmap). Novedad al abrir: TRES
carriles movieron tras mi push de ronda 14.

- **IMP-B `b5e26d7`** (su ronda 7): publicó código nuevo propio —
  (a) vista de Directorio AD-5 (`directory.ts` +195 con test de 149,
  explorador de objetos, cuentas privilegiadas, postura) sobre la API
  AD de IMP-A fusionada; (b) cierre SET-3 en `platform-status.ts`
  (+112: versión, latencias, tamaño de store, certificados) — ESTO
  desbloquea mi pendiente 7 (la vista que consume el stats payload
  que audité en la ronda 11); (c) reconciliación CSP tras fusionar a
  PUL-B (langBoot firmado por el nonce por-petición) — verificar si
  addressó mis 2 observaciones de la ronda 13 (`'self'` redundante
  bajo strict-dynamic; 401 sin CSP); (d) fixes a11y label-in-name
  (`3607ada`). Su árbol ahora CONTIENE Go heredado (26 ficheros vía
  merges: AD/SEC-2 de IMP-A + main) → `-race` aplica al árbol
  fusionado aunque el código Go sea el que ya audité en la ronda 11.
- **PUL-A `10dbca9`** (continúa su ronda 11): `f830cc3` añade
  `--ignore-scripts` a los npm installs del browser-harness (endureci-
  miento SEC-6); el reparo del Makefile y la guardia ya los verifiqué
  byte a byte en la ronda 14. 0 ficheros Go. SEG-B `e868094` ya
  verificó su CI con ejecución real — convergencia total con mi
  ronda 14 (precisión suya: 62 defectos marcados + 1 continuación
  backslash exenta = 63 reparadas).
- **SEG-B `e868094`**: docs-only (informe de verificación cruzada de
  PUL-A, ya leído al abrir).
- Sin mover: IMP-A `bc91c7d` (octava espera de mis 2 hallazgos),
  PUL-B `24c8b08`.

Tareas:

1. **Auditoría del código nuevo de IMP-B** (protocolo: no me fío del
   informe, leo el código):
   a. `directory.ts` (+195) y su test: transformaciones de datos AD
      (objetos, cuentas privilegiadas) — XSS/datos sensibles en
      render, errores de parseo de SIDs/fechas fileTime, estados de
      ausencia honestos.
   b. `platform-status.ts` (+112): cierre SET-3 — comparar contra el
      payload real de `/api/stats` que audité en la ronda 11
      (h.alertLatency/h.ingestCert/h.version): campos que existen vs
      los que la vista asume, ausencia honesta cuando `ready: false`.
   c. Estado final de `proxy.ts` tras la reconciliación CSP: ¿mis 2
      observaciones de la ronda 13 fueron addressadas o sigue la
      desviación razonada? ¿langBoot firmado por nonce por-petición
      introdujo alguna regresión funcional (orden de firmado, fallback
      sin nonce en dev)?
   d. `3607ada` (a11y label-in-name): lectura ligera — los nombres
      accesibles nuevos no deben romper selectores funcionales.
   e. Re-verificar mis 2 hallazgos de la ronda 5 en `b5e26d7`
      (séptimo aviso): `noise-view.tsx` host:'' y `reports-view.tsx`
      generate sin guardia de vigencia.
2. **PUL-A `f830cc3`**: lectura ligera del `--ignore-scripts`
   (¿algún paso del harness NECESITA postinstall — esbuild/rollup
   nativos — o el suite sigue verde?). SEG-B ya la verificó con
   ejecución; la mía es confirmación de convergencia, no duplicado.
3. **Obligatorio de ronda**: la punta de IMP-B contiene Go (heredado,
   idéntico al `bc91c7d` ya -race'd en la ronda 11) → `-race -count=5`
   en `internal/ad`, `internal/secretfile`, `internal/api`,
   `internal/store` sobre worktree desprendido en `b5e26d7` (el árbol
   fusionado es nueva combinación). PUL-A/SEG-B: 0 Go, evidencia
   previa vigente.
4. **Mantenimiento de fuzzing**: paseo de 60 s sobre 3 objetivos
   densos rotando respecto a la ronda 14: `FuzzLoadIntelFile`,
   `FuzzConvertSigma`, `FuzzDecodeMail`.
5. Cierre: checklist CI completo en mi árbol (Go sin cambios propios;
   consola sin cambios → evidencia previa válida), informe, roadmap,
   changelog solo si hay fix mío, `merge-tree` contra las cinco
   puntas, push, worklog.

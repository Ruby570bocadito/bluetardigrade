# Plan de ronda — Seguridad B (ronda 16, verificación)

- **Instancia:** Seguridad B — octava reapertura fuera de cuota.
- **Base al abrir:** mi punta `7905cf0` (rondas 13-15, PUBLICADAS y
  verificadas con `ls-remote`).
- **Delta que reabre:** SEG-A `5678f6b..4d23194` — 3 commits:
  reparación de TABs del Makefile (`0852035`), `--ignore-scripts`
  en targets npm (`a13012e`) e informe de ronda 17 (`4d23194`) con
  2 hallazgos BAJOS nuevos sobre SET-1. Resto de carriles y main
  sin mover (IMP-A `293be1d`, IMP-B `2c47271`, PUL-A `83e3a66`,
  PUL-B `744d46a`, main `35cd866`).

Tareas:

1. **Verificación independiente de los 2 hallazgos BAJOS de SEG-A
   sobre SET-1** (cruzan con mi auditoría de la ronda 15, que no los
   cubrió — mi checklist miró exposición/UX, no el contrato fino):
   (a) trim del password en el cliente (`settings.ts` `draftPayload`)
   vs motor verbatim (PUT handler y sonda en `ad_settings.go`);
   (b) presupuesto de sonda 30 s cliente (`AbortSignal.timeout`)
   vs 45 s motor. Lectura línea a línea en IMP-B `2c47271` e
   IMP-A `293be1d`; veredicto propio confirmado o refutado.
2. **Cotejo del estado del Makefile que SEG-A declara**: su tabla
   dice main ROTO (`missing separator` :31) y mi carril OK por
   reparo `a04379b` — verificar TABs y `--ignore-scripts` en MI
   Makefile y en main con la guardia de PUL-A (copia local
   verificada), sin `make` (sin Go en el sandbox, `make` no
   requerido para la guardia).
3. **Pre-flight de fusión desde mi punta contra las seis refs**
   (merge-tree --write-tree --name-only, `out=$(... || true)` +
   lectura de salida): esperado CLEAN vs main/IMP-A/IMP-B/PUL-B y
   el conflicto registrado con SEG-A en `scenrun_test.go`
   (receta «conservar ambos» vigente). Cotejar que el Makefile de
   SEG-A fusiona limpio contra el mío (sus 4 hunks declarados
   idénticos a los míos).
4. **Informe + roadmap**: veredictos de la ronda, actualización de
   la matriz, puertas vigentes (hot-swap MEDIA de IMP-A, guardia
   BAJA de `runProbe` para IMP-B + los 2 BAJOS nuevos de SEG-A,
   Makefile roto en main — ahora con 6 de 7 carriles rotos según
   SEG-A, SEC-9 bloqueado).
5. Cierre: push de la ronda con la credencial del responsable
   (solo memoria, salida redactada), verificación `ls-remote`,
   worklog. **Recordatorio: revocar el token al cerrar.**

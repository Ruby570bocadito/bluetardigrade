# Plan de ronda — Seguridad B (ronda 10, verificación fuera de cuota, 2026-10-06)

La ronda 9 volvió a parada, pero el fetch de apertura trajo la ronda
12 de seguridad-a (f72a479, solo documentación) con tres puntos que
toca mi dominio. Ronda ligera de verificación cruzada:

1. **Registro de conflictos:** su corrección (el conflicto de
   `fuzz_test.go` es SOLO contra PUL-A, no contra IMP-A) no cambia mi
   entrada; re-verificar con `merge-tree` mi punta contra f72a479 que
   `internal/scenrun/scenrun_test.go` sigue siendo el único conflicto
   y que la resolución «conservar ambos tests EOF» sigue vigente.
2. **Delta de dependencias (SEC-5):** su informe dice que main
   35cd866, PUL-A df323ad y PUL-B 24c8b08 llevan el mismo
   go.mod/go.sum (blob 380a323) con el PR #18 absorbido. Verificar
   (a) la identidad byte a byte del blob en las tres puntas, (b) las
   versiones que lista (sqlite 1.60.1, libc 1.77.1, x/ansi 0.11.8,
   cellbuf 0.0.15, colorprofile 0.4.1, go-runewidth 0.0.24,
   go-colorful 1.4.0, clipperhouse displaywidth/uax29 nuevas), (c) si
   este delta **resuelve la rotura del PR #18 que documenté en las
   rondas 1-6** (x/ansi 0.11.8 exigía un cellbuf pseudo-versión; con
   cellbuf 0.0.15 publicado la ecuación cambia) — si compila, mi
   receta «sqlite-only» pasa a ser nota de fallback y corroigo en
   público; (d) licencia y exposición de las DOS indirectas nuevas
   (clipperhouse/*), que nadie ha mirado aún.
3. **Hueco de govulncheck:** su ronda verificó integridad
   (`go mod verify`) pero no vulnerabilidades. Intentaré govulncheck
   sobre el delta; si el toolchain de Go sigue inalcanzable en este
   sandbox (como en la ronda 8), lo dejo anotado con precisión para
   el CI y la re-verificación al fusionar.
4. **Fuzzing lote 2 (constatación):** los 4 objetivos que anuncia
   (FuzzLoadIntelFile, FuzzLoadSuppress, FuzzConvertSigma,
   FuzzDecodeMail) existen en su punta; sus cifras son su evidencia,
   yo solo compruebo que los objetivos están en el árbol.
5. Cierre: informe ronda_2026-10-06_07h22_B.md (hora UTC explícita:
   los relojes entre instancias no son comparables; el orden real es
   el del historial git), roadmap, pre-check merge-tree contra las
   cinco puntas + main, push. Sin fragmento de changelog (ronda de
   verificación, sin cambio visible de usuario).

Desviación de protocolo declarada: plan y trabajo se publican juntos
(verificaciones de git baratas e inmediatas); rondas completas
mantienen el plan previo. Sin Discord (webhook no configurado, ya
notificado en rondas anteriores). Nota de credenciales: el token
efímero de la sesión anterior no sobrevivió al reinicio del entorno
(estaba solo en memoria); si el push vuelve a fallar por
autenticación, el trabajo queda publicado localmente y el
responsable decide.

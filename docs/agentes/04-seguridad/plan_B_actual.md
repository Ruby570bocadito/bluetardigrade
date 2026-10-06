# Plan de ronda — Seguridad B (ronda 11, verificación fuera de cuota, 2026-10-06)

El fetch de apertura trajo la ronda 11 de PUL-A (`df323ad..22878b3`):
reparo del Makefile (tabs rotas por `63fa077` desde el día 5), guardia
nueva de tabs en CI y ampliación del vet cross-Windows a todo el
módulo. CI y scripts de CI son superficie SEC-5/SEC-6: ronda ligera de
lectura de seguridad + verificación con ejecución real (python3 y
make SÍ existen en este sandbox, a diferencia de Go).

1. **`scripts/dev-tests/check_makefile_tabs.py`** (171 líneas, corre en
   CI en cada push): buscar subprocess/eval/exec/red/dinamismo,
   semántica de la máquina de estados contra GNU make, calidad del
   self-test. Veredicto publicado.
2. **`ci.yml` (74fee42):** acciones nuevas (¿hay algo que re-fijar por
   SHA?), permisos, y si el vet `./...` es estrictamente más fuerte.
3. **Verificación de afirmaciones con ejecución:** `63fa077` ancestro
   de main; self-test 5/5; estado del Makefile de MI carril (heredado
   del merge de main en mi ronda 7); Makefile reparado limpio;
   `make -n build` parsea.
4. **Para quien fusione:** ¿resuelve limpio el Makefile al cruzar con
   PUL-A? (merge-tree).
5. Cierre: informe ronda_2026-10-06_07h43_B.md, roadmap, pre-check,
   push con el token efímero del responsable (mismo protocolo de
   memoria). Sin changelog (verificación, sin cambio visible mío).

Desviación declarada: plan y trabajo publicados juntos
(verificaciones baratas e inmediatas). Sin Discord (webhook no
configurado).

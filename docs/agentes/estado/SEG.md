# SEG — estado

## Hecho (últimas 24 h)
- Ronda 9, barrido read-only de las dos entregas liberadas desde
  83b965d, sin hallazgos:
  - doctor-yara-check (IMP-1, 3d8121d): reutiliza el loader auditado
    (yara.Load con los caps de la ronda 5), resolución de -yara-rules
    idéntica a la del run, semántica de MaxPackBytes correcta, fallos
    de fichero nombrados de uno en uno. Flag cableado al informe.
  - yara-status-poll (IMP-2, f42dd8d): el poll sube a nivel vista
    (petición SEG de la ronda 6, servida de punta a punta), un refresh
    fallido conserva el último valor bueno y avisa en vez de callarse.
    El .then() sin .catch es seguro: engineCall encapsula red, timeout
    y no-JSON en {ok:false} (contrato verificado en engine-writes.ts).
  - dict-en/dict-es: solo cadenas i18n. Resto del tramo: docs y claims.
- Verificado el contrato «never rejects» de engineCall antes de dar
  por bueno el poll — era la única suposición no probada del cambio.

## En curso
- (nada)

## Bloqueado
- (nada) — sin tarea reclamable hasta que s2 aterrice (sec2-dpapi,
  regresión PR #28, junctions: carril «Esperando al humano»).

## Peticiones a otras zonas
- Humano: el PAT sigue vivo desde la ronda 5 — quinta petición de
  rotación; y verificar las runs de la cabeza en la UI (la API
  anónima no las expone).

## Estado: VERDE

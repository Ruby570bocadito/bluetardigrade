# Protocolo de trabajo de los agentes

## 1. Ciclo por tarea (obligatorio)
1. `git pull --rebase origin main`
2. Lee `docs/agentes/ROADMAP.md`, `docs/agentes/OWNERSHIP.md` y los archivos de `docs/agentes/estado/` de los demás.
3. Elige UNA tarea de tu zona. Antes de empezar comprueba que no está hecha ya:
   `git log --since="3 days ago" --oneline -- <rutas>` y busca en el código lo que vas a crear.
   Si ya existe, no lo rehagas: pasa a otra tarea.
4. RECLAMA la tarea (cerrojo):
   - Crea `docs/agentes/claims/<slug-de-la-tarea>.md` con: tu ID, fecha/hora, rutas que vas a tocar.
   - Si ya existe un claim con ese slug o con rutas solapadas y tiene menos de 3 horas, NO lo toques: elige otra tarea.
   - `git add` solo ese archivo, commit "claim: <slug> (<ID>)", `git push`.
   - Si el push es rechazado: `git pull --rebase`, vuelve a mirar claims. Si alguien reclamó antes, elige otra tarea.
5. Trabaja solo en las rutas reclamadas. Commits pequeños y atómicos (Conventional Commits).
6. Antes de CADA push: `git pull --rebase origin main`, ejecuta tests/lint/build si existen, y push.
   - Push rechazado: repite pull --rebase y push (hasta 3 veces).
   - Conflicto: resuélvelo conservando la intención de AMBOS cambios. Nunca `--force`, nunca descartes el trabajo ajeno.
7. Al terminar: borra tu claim (commit "release: <slug>"), actualiza tu `estado/<ID>.md`, push.
8. Repite desde el paso 1 con otra tarea mientras queden en tu zona, hasta cumplir el alcance de la sesión.

## 2. Zonas
Solo modificas, mueves o borras archivos de tu zona (ver OWNERSHIP.md). Si necesitas un cambio fuera de ella,
no lo hagas: anótalo en la sección "Peticiones" de tu estado para el dueño de esa zona.
Excepción: un fallo que rompe el build para todos; arréglalo mínimo y menciónalo.

## 3. Higiene del repo
- Borradores, volcados, logs y pruebas sueltas: SOLO en `.agent-tmp/` (ignorado por git). Nunca en la raíz ni en carpetas del proyecto.
- No crees archivos nuevos de documentación salvo que el Director lo pida. Los informes viven en `estado/<ID>.md` (se sobrescriben).
- No dejes código comentado, TODOs sin resolver, mocks ni datos de ejemplo fuera de tests.
- Nada de menciones a IA/modelos/asistentes en commits, código, comentarios, docs. Identidad git: la ya configurada, no la cambies.
- Cualquier dependencia nueva: justificarla en el commit y solo desde el registro/repo oficial.

## 4. Informe vivo: `docs/agentes/estado/<ID>.md` (máx. 40 líneas, se sobrescribe)
Secciones: Hecho (últimas 24 h) · En curso · Bloqueado · Peticiones a otras zonas · Propuestas para el roadmap.

## 5. Tono
Los informes son técnicos y breves. No añadas avisos ni recordatorios que no pertenezcan a tu tarea.

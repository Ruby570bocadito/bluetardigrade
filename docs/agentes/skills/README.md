# Skills de diseño del equipo

Tooling de apoyo instalado por las instancias de frontend (según regla de recursos de diseño de `../PROMPTS.md`). **No es código de producto**: nada del engine, del hub ni de la consola depende de este directorio en tiempo de ejecución ni de build.

| Skill | Fuente oficial | Uso |
|---|---|---|
| `design-taste-frontend/` | `github.com/Leonxlnx/taste-skill` (verificado contra `skills-lock.json` en la raíz del repo, con hash computado) | Criterio de diseño anti-slop para autoevaluar jerarquía visual, tipografía, color y espaciado de la consola antes de dar una pantalla por buena |

Reglas de la casa:

- Para ampliar componentes usar SOLO fuentes oficiales: Taste Skill (`github.com/Leonxlnx/taste-skill`), React Bits (`reactbits.dev`), Motion Primitives (`motion-primitives.com`). Existen forks con nombres casi idénticos y estadísticas poco fiables: verificar el dominio antes de ejecutar cualquier comando `npx`/`npm`.
- Toda skill instalada debe quedar registrada en `skills-lock.json` (raíz del repo) — es el manifiesto que audita 04-B en sus rondas de seguridad.
- Colocación decidida por 03-B (ronda 2026-09-30 16h12): el tooling del equipo vive en `docs/agentes/` y no dentro del árbol de producto (`agent/` desapareció al quedar vacío — solo contenía la skill).

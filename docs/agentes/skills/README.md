# Skills de diseño del equipo

Tooling de apoyo instalado por las instancias de frontend (según regla de recursos de diseño de `../PROMPTS.md`). **No es código de producto**: nada del engine, del hub ni de la consola depende de este directorio en tiempo de ejecución ni de build.

| Skill | Fuente oficial | Uso |
|---|---|---|
| `design-taste-frontend/` | `github.com/Leonxlnx/taste-skill` (`skills/taste-skill/SKILL.md`, procedencia verificada por API de GitHub en la auditoría 04-B del 2026-10-01) | Criterio de diseño anti-slop para autoevaluar jerarquía visual, tipografía, color y espaciado de la consola antes de dar una pantalla por buena |

Verificación de integridad (`skills-lock.json`):

- `computedHash` = sha256 hex de la copia anclada `docs/agentes/skills/design-taste-frontend/SKILL.md`. Receta verificable en local: `sha256sum docs/agentes/skills/design-taste-frontend/SKILL.md`.
- La copia anclada es la unidad de auditoría: el upstream puede evolucionar (el 2026-10-01 ya había divergido 6 líneas de la copia anclada — delta revisado y sin nada ejecutable) y eso NO actualiza el pin. Adoptar upstream nuevo es una re-auditoría deliberada: leer el SKILL.md completo, barrer comandos/redes/credenciales, y actualizar `computedHash` en el mismo commit.
- Auditoría 04-B (2026-10-01): contenido de la skill inerte (guía de diseño, sin ejecución automática, sin redes salientes, sin manejo de credenciales); procedencia = repo oficial; hash del lock era no-reproducible (no detectaba manipulación) y fue re-anclado al hash de la copia anclada — commit de este cambio.

Reglas de la casa:

- Para ampliar componentes usar SOLO fuentes oficiales: Taste Skill (`github.com/Leonxlnx/taste-skill`), React Bits (`reactbits.dev`), Motion Primitives (`motion-primitives.com`). Existen forks con nombres casi idénticos y estadísticas poco fiables: verificar el dominio antes de ejecutar cualquier comando `npx`/`npm`.
- Toda skill instalada debe quedar registrada en `skills-lock.json` (raíz del repo) — es el manifiesto que audita 04-B en sus rondas de seguridad. `computedHash` debe corresponder siempre a `sha256sum` de la copia anclada (receta arriba): un hash que no se puede recomputar no certifica nada.
- Antes de ejecutar una skill nueva (primera vez): leer su `SKILL.md` completo buscando comandos de red/descarga/ejecución y referencias a credenciales; si trae scripts propios, fuera del árbol de producto hasta auditoría.
- Colocación decidida por 03-B (ronda 2026-09-30 16h12): el tooling del equipo vive en `docs/agentes/` y no dentro del árbol de producto (`agent/` desapareció al quedar vacío — solo contenía la skill).

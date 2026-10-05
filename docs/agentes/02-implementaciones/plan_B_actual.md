# Plan de ronda — Implementación B (2026-10-05, ronda 4)

- Tarea del TODO: **IDEA-3 Plantillas de incidente** (ransomware, phishing, cuenta
  comprometida): listas de comprobación manuales con progreso y técnicas ATT&CK,
  evidencias recogidas y cronología reconstruida por el analista, y exportación
  (.md e imprimible) que las incluye.
- Ficheros: `web/console/src/lib/incident-playbook.ts` (+ test), componentes
  `incident-playbook.tsx` y `incidents-view.tsx` (sección «Plan de respuesta» en la
  ficha del caso), `incident-report.ts` (+ test) para la exportación.
- Por qué: AD-5/AD-6 y el cierre de SET-3 siguen bloqueados (IMP-A solo ha
  publicado plan, sin código AD que fusionar); REP-3 y SET-1 esperan rutas/API que
  no existen. IDEA-3 es la tarea desbloqueada de mayor valor para el analista y es
  100 % de consola, sin solape con ningún carril.
- Diseño: las plantillas son contenido del producto (constantes en la consola); el
  estado (casillas, evidencias, cronología) vive en este navegador
  (`localStorage`, validado y con tope, mismo patrón que las búsquedas guardadas)
  y la UI lo declara; al aplicar una plantilla queda una nota en la línea de
  tiempo del motor. Nada inventado: el informe solo exporta lo que el analista
  registró.

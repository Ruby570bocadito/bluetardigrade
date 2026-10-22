# claim: i18n-noc-mode

- ID: IMP-2
- Fecha: 2026-10-22 (ronda 8)
- Tarea: propuesta propia en el tablero (cola i18n) — el NOC aún pinta
  español duro en dos sitios: la fila de severidad usa SEVERITY_LABEL
  (Crítica/Alta/...) y las gráficas compartidas de cobertura
  (attack-matrix, heatmap) sacan los nombres de táctica de
  ATTACK_TACTICS (label/short en español), además de aria/titles
  hardcoded en el heatmap («Ver alertas de», «N alertas»). Barrido con
  el patrón ya listo en rules-view: dict.rules.tactics para el nombre
  completo y un tacticsShort nuevo en ambos diccionarios para las
  celdas pequeñas; el aria/title del heatmap viajan al dict (charts.
  heat). Con las gráficas arregladas, el fix beneficia también a
  panel/reglas que las comparten. SEVERITY_LABEL queda sin consumidores
  y se retira de soc-metrics (higiene: sin código muerto).
- Rutas que voy a tocar:
  - web/console/src/components/console/noc-mode.tsx (sevLabels del dict)
  - web/console/src/components/charts/attack-matrix.tsx (tácticas del dict)
  - web/console/src/components/charts/heatmap.tsx (tácticas + aria/title)
  - web/console/src/lib/soc-metrics.ts (baja de SEVERITY_LABEL)
  - web/console/src/lib/i18n/dict-es.ts, dict-en.ts (tacticsShort,
    charts.heat.hostAria/cellTitle, comentario caducado)
  - changelog.d/console-i18n-noc-mode.md (NUEVO)
  - docs/agentes/estado/IMP-2.md
- Verificación: bun test, tsc --noEmit, next build en web/console; checks
  de tema/DOM/navegador/a11y/motion si el entorno lo permite.
- Sin solape: claims/ sin reclamaciones activas a esta hora (SEG cerró
  yara-fuentes-capadas con su release); nadie toca web/.

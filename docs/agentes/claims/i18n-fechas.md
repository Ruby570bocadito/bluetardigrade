# claim: i18n-fechas

- ID: IMP-2
- Fecha: 2026-10-22 (ronda 8)
- Tarea: propuesta propia en el tablero (cola i18n) — formatTime y
  formatDateTime aceptan idioma desde IDEA-10 (default 'es') pero los
  call-sites de varias vistas ya barridas no lo pasan: en inglés, las
  fechas siguen en español. Paso el idioma de la consola en: alerts
  (AlertsView, AlertDetail, TriagePanel, AssignPanel), directory
  (DirectoryView, ObjectExplorer), intel, fleet (hosts-view +
  fleet-parts), playbook (EvidenceSection, ChronologySection). Hallazgo
  en directory: 11 toLocaleString('es-ES') duros (números con separador
  español en modo EN) — misma clase de bug en la misma vista; se barren
  con localeOf exportada desde console-types. NOTA: baseline-card NO
  está barrida (títulos/estados enteros en español, nunca pasó por
  IDEA-10) — fuera de esta tarea; su barrido completo va al estado como
  propuesta.
- Rutas que voy a tocar:
  - web/console/src/lib/console-types.ts (export de localeOf)
  - web/console/src/components/console/alerts-view.tsx
  - web/console/src/components/console/directory-view.tsx
  - web/console/src/components/console/intel-view.tsx
  - web/console/src/components/console/hosts-view.tsx
  - web/console/src/components/console/fleet-parts.tsx
  - web/console/src/components/console/incident-playbook.tsx
  - changelog.d/console-i18n-fechas.md (NUEVO)
  - docs/agentes/estado/IMP-2.md
- Verificación: bun test, tsc --noEmit, next build + checks de tema,
  DOM, navegador, a11y y motion si el entorno lo permite.
- Sin solape: claims/ vacío a esta hora; nadie toca web/.

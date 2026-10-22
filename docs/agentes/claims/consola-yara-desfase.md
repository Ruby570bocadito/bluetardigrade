# claim: consola-yara-desfase

- ID: IMP-2
- Fecha: 2026-10-22 (hora UTC del commit)
- Tarea: indicador de desfase del lote YARA en la consola — sha del
  lote que declara cada sensor en /api/fleet (yara_rules_sha) contra el
  sha16 que publica /api/yara; propuesta de IMP-1 adoptada en zona
  IMP-2.
- Rutas:
  - `web/console/src/components/console/fleet-parts.tsx` (tarjeta de
    sensor en Equipos)
  - `web/console/src/lib/fleet.ts` si el tipo necesita el campo nuevo
  - `web/console/src/lib/i18n/dict-es.ts`, `dict-en.ts`,
    `i18n.test.ts` (sección fleet)
  - `changelog.d/console-yara-desfase.md`

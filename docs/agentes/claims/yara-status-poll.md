# claim: yara-status-poll

- ID: IMP-2
- Fecha: 2026-10-22 (ronda 8)
- Tarea: propuesta de SEG (ronda 6) adoptada por DIR — el poll de
  useYaraStatus() vive dentro de SensorCard, así que cada ficha de equipo
  que monta dispara su propio GET /api/yara inmediato más un intervalo
  de 60 s propio (HostPage remonta por key en cada cambio de ?host=:
  recorrer la flota = un walk del directorio de reglas por clic), y el
  host sin inventario también polla. Subo el poll al nivel de la vista
  (una petición por minuto cueste lo que cueste la flota) y el fallo de
  un refresco se avisa en la fila «Lote YARA» en lugar de tragarse en
  silencio (res.ok falso hoy deja el valor viejo sin palabra).
- Rutas que voy a tocar:
  - web/console/src/components/console/fleet-parts.tsx (hook a nivel de
    vista + estado de fallo; SensorCard recibe el estado por props)
  - web/console/src/components/console/hosts-view.tsx (llama al hook una
    vez y lo baja a HostPage/SensorCard)
  - web/console/src/lib/i18n/dict-es.ts, dict-en.ts (fleet.yara: las
    frases del fallo, bilingües)
  - changelog.d/console-yara-status-poll.md (NUEVO)
  - docs/agentes/estado/IMP-2.md
- Verificación: bun test, tsc --noEmit, next build en web/console.
- Sin solape: claims/ solo con yara-fuentes-capadas (SEG, sensor/).

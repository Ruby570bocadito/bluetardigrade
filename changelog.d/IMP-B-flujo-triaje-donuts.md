# IMP-B: flujo del triaje y donuts del dashboard

Fecha: 2026-10-05. Carril: Implementación B (`carril/implementacion-b`).

## Nuevo

- **VIZ-3 — «Flujo del triaje»**: panel a ancho completo del dashboard con un
  diagrama de flujo en tres columnas (origen declarado → táctica ATT&CK → estado
  de triaje) sobre la ventana de alertas que la consola ya recibe. Libra pura
  `lib/triage-flow.ts` (plegado «Otras fuentes»/«Otras tácticas» a partir de 6,
  invariantes de suma en los dos saltos, triples exactas para el gemelo de
  tabla) y componente `charts/triage-flow.tsx` (sankey compacto sin dependencias
  nuevas: cintas neutras, escala única por columna, tooltip, teclado con
  flechas, sin animación).
- **VIZ-1 — donuts**: componente compartido `charts/donut.tsx` (porciones
  anulares con hueco angular, total en el centro, tooltip, teclado) y libra
  `lib/donut.ts` (plegado «Otros»). Paneles nuevos: «Alertas por táctica»,
  «Alertas por fuente» y «Flota por estado» (inventario `GET /api/fleet` que ya
  publica el motor: en línea / sin señal / inactivo).

## Detalles

- La paleta categórica validada tiene cuatro tonos más «Otros»: los donuts
  nombran hasta 4 porciones y el gemelo de tabla conserva el desglose completo
  sin plegar, así ningún valor queda solo en el tooltip.
- El motor solo publica tres estados de ciclo de vida (`new`, `acknowledged`,
  `closed`); el flujo no dibuja un «falso positivo» que la API aún no expone.
- Sin cambios de API Go/OpenAPI, socket ni variables de entorno; las vistas
  consumen datos ya publicados (stream de alertas y `/api/fleet`).

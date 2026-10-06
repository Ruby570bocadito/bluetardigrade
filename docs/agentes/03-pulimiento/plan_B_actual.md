# Plan de ronda — Pulimiento B (2026-10-06, 09h10 Madrid, ronda 6)

Base: `carril/pulimiento-b` `d458fae` (ronda 5); `origin/main` sigue en
`35cd866` (merge: up to date). Estado leído: SEG-B cierra su cuota
(ronda 8, veredictos positivos sobre AD-1, nada para este carril);
SEG-A ronda 11 con dos hallazgos en la rama de IMP-A y cero en las
consolas; IMP-A/IMP-B/PUL-A sin planes nuevos.

## Tareas cogidas

1. **POL-11 (auditoría y cierre de `prefers-reduced-motion`):** pase
   completo de microinteracciones — reactbits (`motion`), transiciones
   CSS y animaciones de canvas — verificando que cada animación no
   esencial se apaga o reduce con la preferencia activa. Correcciones
   solo en ficheros de este carril (reactbits, shell, theme) o de
   tokens; las gráficas de IMP-B solo se auditan y se anotan.
2. **POL-9 (re-medida Lighthouse tras la ronda 5):** el nonce hace la
   ruta dinámica; se re-mide la baseline documentada (Panel
   95/100/96/100, Alertas 100/100) y se actualiza la sección del
   README de la consola con la comparación antes/después.

## No toca

Vistas y gráficas de IMP-B (su barrido i18n y las vistas AD entrantes);
`ci.yml`/Makefile (PUL-A); `web/console-service`; Go, sensor, scripts.

## Coordinación

- IMP-B: reactbits y shell están en mis ficheros auditados por SEG-B;
  su barrido i18n toca vistas, no estos ficheros. Conflicto ya
  documentado de `shell.tsx` sigue en manos del responsable.
- SEG-A ronda 11 revisó mis consolas: cero bugs; sin acciones.

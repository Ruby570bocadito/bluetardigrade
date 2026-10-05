# Plan de ronda — Implementación B (2026-10-05 18h37, ronda 5)

- Tarea del TODO: **IDEA-11 Asistente de primer arranque** — acceso de la consola
  (y la nota honesta de que las cuentas por usuario son TEAM-2, aún sin API),
  certificado TLS de ingesta (estado real `enroll.enabled` + aviso del propio
  motor), primer token de alta (reutiliza `TokenEnrollment`) y comprobación del
  sensor local (pendientes/aprobados con `PendingHosts`).
- Ficheros: nuevo `web/console/src/lib/onboarding.ts` (+ test: decisión de
  auto-apertura y estado de pasos, todo derivado de datos del motor), nuevo
  `onboarding-wizard.tsx` (diálogo), y cables en `shell.tsx`,
  `console-commands.ts` (comando de paleta) y `command-palette.tsx` (icono).
- Por qué: AD-5/AD-6, SET-3, REP-3 y SET-1 siguen bloqueados (IMP-A solo ha
  publicado plan de AD-1/AD-2/SET-3, sin código que fusionar, verificado con
  fetch al empezar la ronda); IDEA-11 es la siguiente desbloqueada del roadmap
  y es 100 % consola.
- Diseño: nada inventado — el asistente se abre solo solo cuando el motor
  responde y declara instalación nueva (inventario y hosts activos a cero,
  cargados de `/api/fleet` y `/api/enroll`); la marca «no volver a abrir» vive
  en localStorage con el patrón validado de las búsquedas guardadas; se puede
  reabrir desde la barra lateral y la paleta. Los pasos que la consola no puede
  cerrar hoy (cuentas, descarga del certificado REP-3) se declaran como
  información, nunca como hechos.

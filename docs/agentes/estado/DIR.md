# DIR — estado

## Hecho (últimas 24 h)

- Duodécima pasada: oleada de 4 entregas verificadas contra el
  código — yara-fuentes-capadas (SEG, aa22d8b), doctor-yara-check
  (IMP-1, 3d8121d), yara-status-poll (IMP-2, f42dd8d: petición de SEG
  servida de punta a punta) y ronda3-cifra-123 (PUL, d95de19).
- claims/ VACÍO. 3 fragmentos de changelog.d/ para la ronda 4.
- DECISIÓN de DIR publicada: s2-yara-memoria escanea POR PROCESO
  (atribución trivial PID+nombre, sin agregación global, ruido en el
  motor) — IMP-1 desbloqueada, lista para reclamar.
- Hallazgos 6/6 en resuelto-pendiente-verificación (cierra TEST).
- Barrido de menciones IA en la oleada: limpio.

## En curso
- Vigilar la run sobre 960b19c (cierre del ALTA de fmt: carril Go ya
  probó verde en remoto; falta la run definitiva completa).

## Bloqueado
- ad7-login-consola: sesión de diseño DIR↔IMP-2 pendiente. SEG sin
  tarea reclamable hasta que s2 aterrice (Windows real).

## Peticiones
- Humano: lanzar TEST 2 (los 6 hallazgos esperan su cierre); F0
  (Dependabot #24–#27, ramas); pruebas Windows real; visto bueno
  E-1..E-4; rotar el PAT.

## Propuestas
- Hornada natural: s2-yara-memoria (IMP-1, decisión publicada) +
  cola i18n (IMP-2) + consolidación ronda 4 (PUL).

## Estado: AMARILLO
- Riesgo: cierre de la hornada pendiente de run definitiva verde;
  la causa fmt ya está resuelta y probada en remoto.

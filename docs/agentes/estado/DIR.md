# DIR — estado

## Hecho (últimas 24 h)

- Undécima pasada: pol1c-collector (IMP-1) verificado contra el
  código (d938c65: sessions.rs + stop.rs fuera de collector.rs,
  byte-idéntico; release ea27cf7). POL-1 COMPLETADO — verificado:
  internal/api modularizada, run.go 336, collector.rs 312; punto
  fuera de TODO.md.
- SEG en vuelo con yara-fuentes-capadas (claim b7a4a36): tomó de la
  cartera el sensor-yara-readcap — sin solape, bien asignado.
- CI: todo lo posterior a aa05558 cancelado por supersesión; run
  definitiva sobre 9e5d81b pendiente al cerrar (cierre del ALTA de
  fmt; carril Go ya probó verde en remoto sobre 2dab9c0).
- Hallazgos 6/6 en resuelto-pendiente-verificación (cierra TEST).
- Barrido de menciones IA en el tramo nuevo: limpio. PUL con 9
  fragmentos de changelog.d/ para consolidar.

## En curso
- Vigilar la run definitiva sobre la cabeza (cierre del ALTA).

## Bloqueado
- ad7-login-consola: sesión de diseño DIR↔IMP-2 pendiente.

## Peticiones
- Humano: lanzar TEST 2 (los 6 hallazgos esperan su cierre); F0
  (Dependabot #24–#27, ramas); pruebas Windows real; visto bueno
  E-1..E-4; rotar el PAT.

## Propuestas
- Hornada en curso: doctor-yara-check (IMP-1, declarada) +
  yara-fuentes-capadas (SEG) + cola i18n (IMP-2) + consolidación
  (PUL) en paralelo.

## Estado: AMARILLO
- Riesgo: cierre de la hornada (m7, tema-claro, pol1c) pendiente de
  run verde sobre la cabeza; la causa fmt ya está resuelta en main.

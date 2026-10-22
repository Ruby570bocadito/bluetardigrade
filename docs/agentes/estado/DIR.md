# DIR — estado

## Hecho (últimas 24 h)

- Decimocuarta pasada: oleada de 3 entregas verificada contra el
  código real — reglas-interpretes-envueltos (IMP-1, 96ad54b:
  LOLBAS 0009/0010, inventario 123→125 vía guard, contador a 125
  comprobado) e i18n-fechas + i18n-baseline (IMP-2, 8c83ccb y
  4574283: localeOf exportada, BaselineStatusWords tipado, test EN).
- SEG ronda 10 read-only (8075bff): ambas entregas limpias.
- CI: última run completa verde la #564 (960b19c); #565..#587
  supersesiones, ninguna failure real — la insignia roja del carril
  ci pinta la última completada cancelada. Cierre del ALTA
  ACUMULATIVO: 960b19c ya contiene m7-wef-pack, tema-claro, pol1c,
  yara-fuentes-capadas, yara-status-poll y doctor-yara-check.
- CORRECCIÓN de la pasada 12: la run de b49e96e (#566) murió por
  supersesión — verdes confirmadas del carril Go: TRES.
- Barrido de menciones IA: limpio (tramo nuevo solo docs). Tablero:
  propuestas servidas retiradas (poll YARA, noc-mode, fechas,
  intérpretes) y añadidas las nuevas (gemelo por hash, cola i18n).

## En curso
- claims/ vacío. Siguiente turno natural: s2-yara-memoria (IMP-1,
  decisión publicada: por proceso). PUL con doble petición ACTIVA:
  deriva 123→125 en prosa + consolidación de SIETE fragmentos.

## Bloqueado
- ad7-login-consola: sesión de diseño DIR↔IMP-2 pendiente. SEG sin
  tarea reclamable hasta que s2 aterrice (Windows real).

## Peticiones
- Humano: lanzar TEST 2 (los 6 hallazgos esperan su cierre); F0
  (Dependabot #24–#27, ramas); pruebas Windows real; visto bueno
  E-1..E-4; rotar el PAT.
- IMP-1: arreglar el formateador de su entorno (tabs, 3.ª vez).

## Estado: AMARILLO
- Riesgo: ALTA formal de CI abierta por supersesiones; el código nuevo
  (reglas, i18n) acumula tramo sin run superviviente, suites locales
  en verde en cada entrega.

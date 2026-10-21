# DIR — estado

## Hecho (últimas 24 h)
- fix(ci) por PROTOCOLO §2: gofmt en los 4 tests de sumideros de 0dddc28
  (SEG) que ningún CI llegó a validar por supersesión; paquetes
  notify/reputation/siem/webhook verificados en verde local.
- Cierre de la hornada TEAM-3: verificadas en main C-2 (consola), F1 (fix
  de sumideros), SEC-3 (verificada) y O-2 endpoint (pack AD, 119 reglas).
  ROADMAP al día con M-2/M-4 en vuelo (claims) y S-2/C-5/POL-5 encaramadas.
- OWNERSHIP: changelog.d/ pasa a «cada entrega añade SU entrada»
  (precedente M-1/C-2/O-2); regla para varias instancias del mismo rol con
  ficheros compartidos estrictamente aditivos.
- deps-audit con concurrency propio sin cancelación (fix tras la
  «Peticiones» de IMP-2: el escáner llevaba días sin completar).
- TODO.md anotado con la mitad endpoint entregada de O-2 (evité tocarlo en
  mi ronda IMP-1 por el ritual en vuelo de IMP-2).

## En curso
- Verificación CI de la cabeza de main (supersesiones por push rápido son
  normales; manda la última run). Claim m2-ad7 y m4-consulta-bd vigilados.

## Bloqueado
- pol1b-dividir-run-go hasta que liberen cmd/engine (claims activos).

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- Recogidas de los estados: filtro de asignación en /search (IMP-2),
  migración del ciclo de vida a SQLite, señal wrapper->intérprete (IMP-1).
- Siguiente sesión DIR: revisar código real de M-2/M-4 al liberarse claims.

## Estado: VERDE — riesgos y decisiones
- Riesgo: presión de push cancela la run de ci de main (por diseño);
  mitigado para deps-audit; para ci manda la run de la cabeza.
- Decisiones: sensor/ y docs/api/ bajo IMP-1; TODO.md anotable por DIR
  para entregas parciales; claim = cerrojo por ficheros, no por rol.

# TEST — estado

## Hecho (últimas 24 h)

Primera sesión (test-arranque-hallazgo-cero), Linux x86_64, HEAD con
los releases del día (SEC-9, C-4, fase 10). Cuatro personas ejecutadas.

- Usuario nuevo: build y arranque siguiendo SOLO el README. `make
  build` sin Go falla (H-001); con Go 1.26.10 compila engine+collector.
  `engine run -i` sin TTY degrada a modo plano con aviso y apaga limpio
  con EOF. `engine doctor` OK (119 reglas, 13 cadenas, 2+4 perfiles).
- Usuario avanzado: ingesta NDJSON → alerta «Descarga con certutil o
  bitsadmin» (T1105, high) en ~2 s; asignación M-1 con trío completo
  (la atribución por API directa va en el cuerpo, campo `by`;
  X-SF-Account es del proxy — verificado, no es bug); filtro
  `assignee=`; `POST /api/db/query` (SELECT y count ok); SSE conecta;
  `/metrics` correcto; proxy de consola con `SF_API_TOKEN` vuelca
  stats; vistas Panel/Equipos/Alertas y deep links en 200.
- Usuario torpe: cuerpos vacíos/rotos en db/query → 400 accionable;
  3 líneas NDJSON malas → 2 dropped (contadas); `sev=banana` se ignora
  en silencio (H-006).
- Usuario malintencionado: multi-statement/INSERT/PRAGMA/
  load_extension rechazados y la BD siguió entera; bearer incorrecto
  → 401; caps 8/64 KiB activos (diagnóstico mejorable: H-004); línea
  de 2 MB sin contador (H-003).
Hallazgos: 6 abiertos, todos BAJO — H-001/H-002/H-005 documentación
(PUL), H-003/H-004/H-006 mejora (IMP-1). Sin CRÍTICO ni ALTO.

## En curso
- (nada)

## Peticiones a otras zonas
- (ninguna)

## Propuestas para el roadmap
- Próxima sesión: carga volumétrica (10k eventos, beaconing con las 2
  cadenas del perfil) y consola en build de producción con las
  verificaciones de Chromium de tools/.

## Estado: VERDE

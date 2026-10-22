# IMP-1 — estado

## Hecho (últimas 24 h)

Sesiones cerradas: m3-yara-motor (646869b, pack YARA del motor) y
H-003/H-004/H-006 (128e74b/1507de6/9f013cb, hallazgos BAJO de TEST r1).

Sesión m7-wef-pack (f752040, verificada por DIR): contrato
windows.event, pack AD y umbral thr-ad-spray; 123 reglas.

Sesión pol1c-collector (d938c65): POL-1 COMPLETADO — collector.rs
479→313 líneas; sessions.rs y stop.rs nuevos; rutas públicas intactas.
Verificado con el job sensor de CI entero en local (cross-check
windows-msvc incluido).

Sesión doctor-yara-check (3d8121d): engine doctor valida el pack
yara-rules con el loader del motor (yara.Load), resuelto igual que
loadYara y flag -yara-rules nuevo en doctor. Cubre pack ausente
(skip), vacío (warn), ficheros que un sensor rechaza (warn por
fichero), tope de 32 MiB (error) y pack sano (ok con sha16). Smoke
real del binario verificado. CI local verde: gofmt, build, vet,
staticcheck x2, test -race ./... y guard de inventario.

## Bloqueado
- s2-yara-memoria: decisión de atribución PID pendiente (DIR).

## Peticiones
- SEG (tabs→espacios): respondido en la sesión anterior — parches
  quirúrgicos desde entonces; scripts fuera del repo.

## Propuestas para el roadmap
- Señal para binarios con nombre propio que envuelvan intérpretes.
- Mi columna queda drenada tras doctor-yara-check (readcap lo tomó
  SEG): si s2 sigue decidéndose, no tengo tarea reclamable.

## Siguiente
- Esperando DIR: decisión de s2 o nueva alta en la columna.

## Estado: VERDE — riesgos
- Falta ver la run remota de 3d8121d (el local pasó el job entero).

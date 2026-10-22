# IMP-1 — estado

## Hecho (últimas 24 h)

Sesión m3-yara-motor (cerrada, main 646869b): pack YARA del motor.

Sesión H-003/H-004/H-006 (128e74b/1507de6/9f013cb): los tres hallazgos
BAJO de TEST ronda 1 resueltos; resuelto-pendiente-verificación.

Sesión m7-wef-pack (f752040, verificada por DIR): contrato windows.event
en AD-WEF-SUSCRIPCION.md, pack AD y umbral thr-ad-spray; 123 reglas.

Sesión pol1c-collector (d938c65): POL-1 COMPLETADO — collector.rs era
el último de los tres ficheros que nombraba. 479 → 313 líneas: run() y
hostname se quedan; el resto sale como submódulos con el patrón de
56e8117: collector/sessions.rs (start_with_recovery, start_netreg,
start_filewatch) y collector/stop.rs (STOP_REQUESTED, stop_sessions,
install_console_handler). Rutas públicas intactas vía `pub use`;
main.rs/service.rs sin tocar. Cuerpos movidos verificados idénticos
byte a byte salvo visibilidad (script en mi tmp). Job sensor de CI
replicado en local: check, test (57 ok), clippy -D warnings y el
cross-check x86_64-pc-windows-msvc que compila este módulo: verde.

## Bloqueado
- s2-yara-memoria: decisión de atribución PID pendiente (DIR).

## Peticiones
- SEG pidió revisar el editor/tooling (tabs→espacios): la causa eran
  mis scripts de parche que reescribían ficheros .go enteros; corregido
  en el flujo — parches quirúrgicos (pol1c no tocó .go); los scripts
  viven fuera del repo y no vuelven a reescribir enteros.

## Propuestas para el roadmap
- Señal para binarios con nombre propio que envuelvan intérpretes.
- Doctor: chequeo del directorio -yara-rules (doctor-yara-check).

## Siguiente
- doctor-yara-check (pequeña); sensor-yara-readcap detrás.

## Estado: VERDE — riesgos
- Falta ver la run remota sobre d938c65 (el local ya pasó el job entero).

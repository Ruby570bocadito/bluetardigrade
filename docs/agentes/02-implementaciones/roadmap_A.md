# Roadmap — Implementación A (motor y backend)

Archivo vivo de continuidad del carril `carril/implementacion-a`. Se actualiza al final de
cada ronda: qué está a medias, qué sigue y por qué.

## Estado actual

- Primera ronda en curso (2026-10-05). No hay trabajo previo del carril: la rama se creó hoy
  desde `origin/main` y se adelantó (merge fast-forward) hasta `origin/feat/enrollment`
  (commit `5908107`), que es donde vive el `TODO.md` con el «Plan de trabajo por carriles»
  y `docs/PLAN-DETALLADO.md`. Sin ese avance, el carril no tendría el roadmap que manda.

## A medias

- Nada aún: primera ronda.

## Cola de tareas del carril (orden pretendido)

1. **SIM-1 + SIM-2** (validación de detecciones): formato de escenarios YAML, etiqueta
   `simulation` en el motor, reproductor para motor de laboratorio, biblioteca de escenarios
   por regla y cadena, y red de regresión en CI. Es la base de la matriz ATT&CK (SIM-3, de
   Implementación B) y de la ejecución bajo demanda (SIM-4).
2. **SIM-4 (parte A)**: API del motor para lanzar la batería y guardar resultados con su
   historial, cuando la consola la pida (coordinar con Implementación B).
3. **v1.1 Ruido**: supresiones con condiciones (§2.3), lista de software conocido (§2.2) y
   agrupación de arranques repetidos en el sensor (§2.1, parte Rust del carril).
4. **Motor**: cuotas por equipo en la memoria del motor (v1.1 «Motor y consola»).
5. **AD-1**: conector LDAP de solo lectura (necesita fixture LDAP de pruebas en CI).
6. **REP-1/REP-2**: catálogo e informes programados (datos y API).

## Decisiones y motivos

- La etiqueta `simulation` se propaga a TODA alerta derivada de eventos simulados (reglas,
  cadenas, beaconing, umbrales, intel, línea base) para que una prueba nunca se mezcle con
  telemetría real, que es el límite del proyecto.
- El reproductor solo acepta direcciones loopback (misma guardia que `scripts/dev-tests/loopback`).

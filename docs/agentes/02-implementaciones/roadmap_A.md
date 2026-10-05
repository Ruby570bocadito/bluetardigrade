# Roadmap — Implementación A (motor y backend)

Archivo vivo de continuidad del carril `carril/implementacion-a`. Se actualiza al final de
cada ronda: qué está a medias, qué sigue y por qué.

## Estado actual

- Ronda 2026-10-05 cerrada (informe: `ronda_2026-10-05_12h36_A.md`). Entregado SIM-1 y SIM-2
  completos: biblioteca `scenarios/` con 127 escenarios (114 reglas habilitadas + 13
  cadenas), etiqueta `simulation` propagada a toda alerta derivada de evidencia simulada
  (reglas, cadenas, beacon, umbrales, intel, línea base), reproductor `engine scenarios
  list|replay` solo-loopback, red de regresión en CI y E2E contra motor de laboratorio real.
- La rama se creó desde `origin/main` y se adelantó (merge fast-forward) hasta
  `origin/feat/enrollment` (`5908107`), donde vive el `TODO.md` con el plan de carriles y
  `docs/PLAN-DETALLADO.md`. Si `main` avanza, hacer `git merge origin/main` al inicio de la
  ronda siguiente; si el responsable fusiona `feat/enrollment`, no habrá conflicto.

## A medias

- Nada a medias: las dos tareas de la ronda quedaron completas y verificadas.

## Cola de tareas del carril (orden pretendido)

1. **SIM-4 (parte A)**: API del motor para lanzar la batería de escenarios bajo demanda y
   guardar resultados con historial (detectado/no, latencia); endpoint nuevo + OpenAPI.
   Coordinar la pantalla con Implementación B (su SIM-4/SIM-3) y publicar el contrato.
2. **v1.1 Ruido**: supresiones con condiciones (PLAN-DETALLADO §2.3), lista de software
   conocido por organización (§2.2) y agrupación de arranques repetidos en el sensor (§2.1,
   parte Rust de este carril; requiere cargo en el entorno o pruebas en otro sitio).
3. **Motor**: cuotas por equipo en la memoria del motor (v1.1 «Motor y consola»).
4. **AD-1** conector LDAP de solo lectura (necesita fixture LDAP de pruebas en CI).
5. **REP-1/REP-2** catálogo de informes e informes programados (datos y API).

## Decisiones y motivos (histórico vivo)

- **Etiqueta `simulation` de extremo a extremo**: se propaga a TODA alerta derivada de
  eventos simulados — incluidas cadenas, beacons y umbrales, donde un solo evento simulado
  contamina la clave/estado completa — para que una prueba nunca se mezcle con telemetría
  real (límite del proyecto y requisito SIM-1).
- **Los eventos del escenario se decodifican vía JSON** (el esquema de la capa de
  transporte), no con tags YAML nativos: evita bifurcar el contrato del sensor en un segundo
  esquema y hace que una errata del YAML falle en carga (`DisallowUnknownFields`).
- **Cobertura obligatoria por detección en CI** (`TestScenarioLibraryCoversEveryDetection`):
  toda regla o secuencia nueva sin su escenario rompe el build; la biblioteca crece con el
  paquete.
- **El reproductor solo acepta loopback literal** (ingesta y API) y valida las expectativas
  contra el catálogo del motor de laboratorio antes de repetir (`FALTA-CATALOGO`).
- Corrección de CLI descubierta en la ronda: los subcomandos nuevos deben registrarse en
  `cmd/engine/main.go` (`isRoutedSubcommand`) ADEMÁS de en el árbol Cobra, o el
  `legacyMain` arranca el motor con el nombre desconocido.
- Entorno de esta ronda: sin credenciales de push a GitHub y sin `cargo`/`pwsh`; los
  commits quedaron en la rama local `carril/implementacion-a` y se subieron los pasos
  del protocolo que no requieren red.

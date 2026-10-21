# WORKLOG.md — Registro compartido de agentes

Memoria viva del equipo. **Append-only**: cada sesión AÑADE su entrada al
final del fichero. Nunca se edita ni se borra una entrada anterior. Si algo
no está aquí, es que no pasó.

Qué va en cada entrada: qué hiciste, qué ficheros tocaste, contratos o
decisiones que afectan a otros roles, pendientes y bloqueos. Formato exacto:
ver la plantilla en [AGENTS.md](AGENTS.md).

Reglas rápidas:
- Una entrada por sesión de trabajo, aunque no hayas terminado nada
  (especialmente entonces).
- Las entradas van en orden cronológico (nuevas al final).
- El humano puede añadir entradas de «coordinación» (fusiones, decisiones
  de hornada, cambios de prioridad) con el mismo formato.

---
*(Las entradas de trabajo empiezan debajo de esta línea.)*

---
## 2026-10-21 · AG-3 CONSOLA · C-1 · sesión 1
- Hecho: rediseño de la vista Panel sobre el kit POL-7. Héroe de operación
  (`operations-overview.tsx`): Estado/Actualizar al Button outline y los tres
  CTAs a la forma ghost del kit, con el tinte rojo de datos y el tinte
  primario viajando en `className` (sin variantes nuevas). Salud del pipeline
  (`dashboard.tsx`): estado de conexión como Badge del kit (color semántico
  en `className`, como SeverityBadge) y contadores en hoja de especificación
  2×4 (antes 8 columnas apretadas en media tarjeta), etiqueta en
  micro-mayúsculas y marcador ámbar en filas que piden atención.
  Telemetría reciente: primera vista migrada a la primitiva `ui/table`
  (caption sr-only, cabecera compacta, filas hairline, estados honestos).
  Botón Actualizar del heatmap y enlace Ver flujo completo también al kit.
  README de la consola actualizado en su sección POL-7. Verificación local:
  tsc, 553 tests de consola, build de producción, tema (ambos), guard DOM
  (contrato de tabla incluido), regresión de navegador 23/23, login 9/9,
  analista, a11y 20/20; hub 108 tests.
- Ficheros: `web/console/src/components/console/dashboard.tsx`,
  `web/console/src/components/console/operations-overview.tsx`,
  `web/console/README.md`; además el kit de coordinación (`AGENTS.md`,
  `TASKS.md`, `WORKLOG.md`) llega a la raíz en el primer commit porque aún
  no estaba en el repo y el protocolo exige reclamar C-1 en TASKS.md.
- Contratos/decisiones para otros: no se consume ninguna API nueva del motor
  (todo lee de /api/stats, /api/stream y /api/alerts existentes). La vista
  Panel sigue en español: su migración i18n es IDEA-10 (tarea aparte, junto
  a O-3). AnimatedList deja de animar las filas de Telemetría reciente (un
  motion.div no puede envolver un `<tr>` sin romper el DOM de tabla); sigue
  en las listas no-tabla (Hosts calientes). Los botones-fila de listas
  (abrir host) NO se convierten a Button: son filas interactivas, no
  acciones; el kit es para acciones.
- Cierre: PR #38 abierto (`agent/consola/c-1` → `main`, 5 commits). La
  sesión continuó con credenciales de push y rebase sobre main @ 7d99cb7
  (PR #37 fusionado antes: solo TODO.md, sin conflictos). NO fusionar
  hasta CI verde. Capturas oficiales del escaparate (F5) después, en VM
  de laboratorio real.
- Bloqueos: ninguno.
- Estado en TASKS.md: en revisión (PR #38)

---

## 2026-10-21 · AG-4 OPS/QA · O-1 · sesión 1
- Hecho: POL-5 — `docs/OPERATIONS.md` reorganizada por capítulos, sin cambiar
  contenido: 39 secciones planas agrupadas en 8 Partes (`## Part N: …`), índice
  `## Contents` tras la introducción, secciones descendidas a h3 y sus
  subsecciones a h4 (los textos de los encabezados no cambian, así que las
  anclas usadas desde `README.md`, `docs/GUIA-INICIO.md` y `TODO.md` siguen
  funcionando). Navegación reparada de paso: un ancla interna muerta
  preexistente (`#alert-noise-control`) apunta ahora a la sección que documenta
  el informe de ruido (REP-1). Segunda mitad de O-1: esqueleto de la guía de
  suscripción WEF (`docs/AD-WEF-SUSCRIPCION.md`, español) para la futura
  sección AD del TODO (F3): arquitectura propuesta (fuentes → recolector Wecsvc
  → ForwardedEvents → ingesta NDJSON del motor), requisitos, filtro provisional
  de IDs ligado a O-2, alta por GPO, retención/RGPD, plan de pruebas de
  laboratorio y tabla de decisiones abiertas. Fila en el mapa de
  `docs/README.md` y fragmentos de `changelog.d/` para ambas entregas.
- Ficheros: `docs/OPERATIONS.md`, `docs/AD-WEF-SUSCRIPCION.md` (nuevo),
  `docs/README.md`, `changelog.d/docs-operations-chapters.md` (nuevo),
  `changelog.d/docs-ad-wef-skeleton.md` (nuevo), `TASKS.md`, `WORKLOG.md`.
  Primer commit de la rama añade además el kit de coordinación a la raíz
  (`AGENTS.md`, `TASKS.md`, `WORKLOG.md`) porque el repo aún no lo tenía y sin
  TASKS/WORKLOG no había forma de reclamar la tarea ni registrar la sesión —
  revisable por separado (es el commit 1 de 4).
- Contratos/decisiones para otros: **M-7 (AG-1)** define el contrato
  transportista→motor (formato NDJSON, identidad, cómo distinguir la fuente
  real en `ForwardedEvents`); el esqueleto no inventa campos, solo recoge
  restricciones. **O-2 (AG-4, yo)** fija la lista definitiva de IDs del filtro
  WEF; la tabla actual es provisional. El transportista propuesto vive en
  `scripts/` (ámbito AG-4) cuando toque.
- Pendiente: redactar la guía WEF en firme tras validar en Windows real
  (alta por GPO, 5985/5986, identidad de reenvío, buffering) — queda marcado
  en el propio documento y en «Decisiones abiertas». Bloqueos: sin
  credenciales de push/PR en esta sesión; el humano abre el PR desde
  `agent/ops/o-1` (entrega preparada: bundle + parches + comandos).
- Estado en TASKS.md: en revisión (PR #39)

---
## 2026-10-21 · AG-2 SENSOR · S-1 · sesión 1

- Hecho:
  - Raíz `?` resuelta por los dos caminos que pide el TODO:
    (1) **por las claves vistas bajo esa base**: cuando un OpenKey/CreateKey
    bajo una base nunca vista lleva BaseName (ruta `\REGISTRY\...` completa),
    la base se recuerda y los opens posteriores bajo ella resuelven
    completos (`regnames.rs`);
    (2) **por el usuario del proceso**: el SID del escritor (campo UserSID
    de los eventos de arranque y rundown del kernel, en la tabla de
    procesos) resuelve `?\Software\...` a `HKU\<SID>\Software\...`
    (`netreg.rs registry_path_resolved`). Sin SID conocido el `?` se queda:
    no se inventa el hive.
  - Los eventos `registry.set` llevan ahora `user` (SID del escritor, mismo
    formato que `process.create`) y, solo cuando la raíz se resolvió por
    inferencia, el atributo `registry_root_inferred` con la raíz usada
    (`HKU\<SID>`): la resolución se declara, no se disimula.
  - Dato del valor escrito: la captura sigue el manifiesto del proveedor
    (estable desde Windows 7: `DataSize` u32 tamaño real, `CapturedDataSize`
    u16 bytes que trae el evento, `CapturedData` binario). Captura cero → el
    evento no lleva `value` (antes un REG_SZ sin datos se enviaba como
    cadena vacía). El campo del esquema es **`registry.value`** (model.go,
    fieldmap.go): el TODO lo llama `registry.value_data` con vocabulario
    Sigma, pero es el mismo dato; crear un campo `value_data` nuevo sería
    descartado por el modelo del motor. Dos reglas ya exigen
    `registry.value` (fDenyTSConnections, EnableScriptBlockLogging).
  - `--debug-registry` imprime también `type`, `data_size`, bytes capturados
    y el value renderizado: es la evidencia para verificar la captura en un
    Windows real.
  - CI: cargo test 38/38 en host, clippy host y clippy cross-check
    x86_64-pc-windows-msvc en verde, sobre main rebasada (7d99cb7).
- Ficheros: `sensor/src/regnames.rs`, `sensor/src/netreg.rs`,
  `sensor/src/collector.rs`; además `AGENTS.md`, `TASKS.md`, `WORKLOG.md`
  (kit desplegado en raíz: llevaba pendiente según LEEME.md; primera
  sesión que lo necesita).
- Contratos/decisiones para otros:
  - registry.set ahora puede llevar `user` (SID) y el atributo declarativo
    `registry_root_inferred` (solo con raíz inferida). El motor no necesita
    cambios (attributes ya existe en model.Event). La consola puede
    mostrarlos cuando quiera (AG-3).
  - El dato escrito se exige como `registry.value` — NO introducir
    `registry.value_data` en reglas/supresiones (AG-4): el motor lo
    descartaría. Ejemplo de supresión para el caso real Chrome/Copilot en
    Run, armable cuando se verifique la captura en Windows real:
    ```yaml
    - rule_id: 7d1e2f40-5a6b-4c7d-9e8f-0a1b2c3d4e5f  # Persistencia en clave Run via registro
      host: LAB-WKS-01
      reason: "autoarranque legítimo de Chrome/Copilot (valor verificado)"
      when:
        - field: registry.value
          operator: icontains
          value: "chrome.exe"
    ```
- Pendiente:
  - **Verificar en un Windows real** (esta sesión no tiene VM; queda todo
    lo que el CI no puede ver):
    1. Compilar y arrancar el sensor con `--debug-registry run` y escribir
       en la clave Run (`reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run
       /v bt-prueba /d C:\ruta\bt.exe`) y arrancando Chrome/Copilot.
    2. En la línea `[REG] set ...` confirmar `captured=Some(n)` con n>0 y
       `value=[...]` con el comando escrito. Si sale `captured=Some(0)`, la
       build de Windows no captura el dato en SetValueKey: anotarlo como
       limitación (las reglas no podrán exigir el dato en esos eventos) y
       decidir con el humano si se amplía la captura por otra vía.
    3. Con una clave abierta antes del sensor (arrancar el sensor después
       de la sesión): confirmar que la escritura llega como
       `HKU\<SID>\...` con `registry_root_inferred` y que la regla
       «Persistencia en clave Run via registro» sigue disparando.
  - Abrir el PR a main (4 commits, rama `agent/sensor/s-1` rebasada):
    esta sesión no tiene credenciales de git; la entrega incluye los
    parches (`git am`) y el texto del PR listos.
- Bloqueos: ninguno de código. Publicación pendiente de credenciales
  (entrega tipo parche, escenario B del kit).
- Estado en TASKS.md: en revisión (PR pendiente de abrir: rama
  `agent/sensor/s-1`)

---
## 2026-10-21 · AG-2 SENSOR · S-1 · sesión 2

- Hecho:
  - **PR abierto**: [#40 — sensor: resolve the unknown registry root via
    the writer's user; value data (S-1)](https://github.com/Ruby570bocadito/bluetardigrade/pull/40)
    (rama `agent/sensor/s-1`, 5 commits, rebasada sobre main 7d99cb7 —
    sesión 1 terminó sin credenciales de git; esta sesión las tuvo).
  - Verificación previa al push, todo verde otra vez sobre la rama tal
    cual va al PR: `cargo test` 38/38 y `cargo clippy --all-targets`
    limpio en host.
  - Revisión del contrato con el código fusionado en main: el campo del
    esquema sigue siendo `registry.value` (pkg/model/model.go,
    internal/sigma/convert.go «Details» → `registry.value`) y las reglas
    lo usan; se confirma la decisión de la sesión 1 de NO crear
    `registry.value_data`.
  - TASKS.md: S-1 pasa de «PR pendiente de abrir» a «en revisión (PR
    #40)».
- Ficheros: `TASKS.md`, `WORKLOG.md` (este commit de coordinación va
  dentro del PR #40). El código no cambió respecto a la sesión 1.
- Contratos/decisiones para otros: sin cambios respecto a la sesión 1
  (`user` + `registry_root_inferred` en registry.set; `registry.value`
  para el dato escrito; ejemplo de supresión Chrome/Copilot en la
  entrada anterior).
- Pendiente (sin cambios, lo hereda de la sesión 1):
  - Verificar en un Windows real: `--debug-registry run`, escritura en
    la clave Run y arranque de Chrome/Copilot, confirmar
    `captured=Some(n)>0`, `value=[...]` y la resolución
    `HKU\<SID>\...` con `registry_root_inferred`.
  - El humano revisa y fusiona el PR #40 (AG-2 no fusiona el suyo).
- Bloqueos: ninguno.
- Estado en TASKS.md: en revisión (PR #40)

---
## 2026-10-21 · AG-2 SENSOR · S-4 (parte latido) + ritual S-1 · sesión 1 (IMPL-B)
- Hecho: el `sensor.heartbeat` informa de lo que ETW pierde (`etw_events_lost`,
  `etw_buffers_lost` vía `ControlTraceW(EVENT_TRACE_CONTROL_QUERY)` sobre las
  sesiones vivas, PLAN-DETALLADO §2.5) y de los descartes del hilo de hashes
  (`hash_dropped`); contador en `emit_enriched` solo cuando el hashing estaba
  pedido. Ritual de fusión de S-1 (el ROADMAP lo tenía pendiente de mi
  carril): líneas fuera de TODO.md + fragmento en changelog.d/ con la
  decisión de esquema (`registry.value`, no `value_data`).
- Ficheros: `sensor/src/heartbeat.rs`, `sensor/src/collector.rs`,
  `sensor/src/main.rs`, `sensor/Cargo.toml` (feature
  `Win32_System_Diagnostics_Etw`, `Cargo.lock` intacto), `TODO.md`,
  `changelog.d/sensor-heartbeat-loss.md`,
  `changelog.d/sensor-registry-root.md`, `TASKS.md` (S-4 dividida: la parte
  DPAPI/SEC-2 queda en fila propia, carril Seguridad C/D),
  `docs/agentes/02-implementaciones/{plan_B_actual,roadmap_B,ronda_*_B}.md`.
- Contratos/decisiones para otros: tres atributos nuevos en
  `sensor.heartbeat`, texto decimal, SIEMPRE presentes aunque sean 0
  (un latido que deja de llevarlos se confunde con un sensor viejo).
  `etw_events_lost`/`etw_buffers_lost` son acumulativos por instancia de
  sesión: una recuperación de sesión reinicia su contador (mejora futura:
  acumular en el sensor). El motor hoy los ignora (consumo retrocompatible);
  el aviso de subidas (severidad baja) y su vista en Equipos: AG-1/AG-3.
  Reglas y supresiones: el valor escrito es `registry.value` (no existe
  `registry.value_data`).
- Pendiente: verificación conductual en Windows real (acción del humano):
  atributos nuevos en Equipos y cruce con `logman query
  bluetardigrade-sensor -ets`. Hallazgo para AG-4/OPS: `ci.yml` tiene
  `on.push.branches: ain]` (los pushes a main no disparan CI). Directores:
  commits de los PRs #34–#38 con autor `Z User <z@container>` — decisión
  sobre su tratamiento; esta ronda firma con la identidad del historial del
  repositorio (declarado en el informe). Sin `DISCORD_WEBHOOK_URL` en esta
  sesión.
- Bloqueos: ninguno.
- Estado en TASKS.md: S-4 en revisión (PR #42)

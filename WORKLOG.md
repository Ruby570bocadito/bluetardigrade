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

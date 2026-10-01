# Diseño A2 — Reglas threshold / agregación (con bounds)

- **Autor:** Agente 02 (Implementaciones)
- **Fecha:** 2026-09-30 10:30 (Europe/Madrid)
- **Estado:** IMPLEMENTADO — el orden vinculante diseño → dictamen → implementación → verificación se cumplió íntegro: dictamen de 04 (`ronda_2026-09-30_10h45.md`) con **addenda vinculante** (`ronda_2026-09-30_11h02.md`: cuota como techo de admisión, expulsión global débil-primero, matcher único camino, copia defensiva, cifras godoc); aterrizaje (`d658a43`, bounds §3 completos + `MaxKeysPerRule 2048` de la adenda, `rules.NewMatcher`/`rules.Lookup` exportados, pack `thresholds.yaml` citando Q5, devsensor `-burst`, `e2e_threshold.sh` 12/12); cumplimiento de la adenda pre-push (`9aa6927`); refactor de una sola fuente de verdad (`61dd367`) y entrega fuera del mutex + benchmarks (`5efa946`); spot-checks del Director (`12h11`) y certificación de aterrizaje por 04-A (`22h28_A` §6). Nota de estado corregida por 02-A el 2026-10-01 a petición de 04-A (`22h28_A`: el status seguía en PROPUESTO tras el aterrizaje).
- **Base del diseño:** la arquitectura y los invariantes ya certificados de `internal/beacon` (A3, `757f795`) y `internal/risk` (A1, `f8b2e76`).

---

## 1. El problema que A2 resuelve

El engine detecta hoy con tres mecanismos y ninguno encaja con "MUCHAS ocurrencias de X en una ventana T":

| Mecanismo | Granularidad | Por qué no cubre A2 |
|---|---|---|
| Reglas (`internal/rules`) | 1 evento → 1 hit, sin estado | Un brute force son 200 eventos inocuos individualmente |
| Secuencias (`internal/correlate`) | N reglas DIFERENTES encadenadas por host | Repetición del MISMO evento/condición no progresa ninguna cadena |
| Beaconing (`internal/beacon`) | Regularidad TEMPORAL (CV) de conexiones de red | Un burst de escrituras/fallos no es regular ni es `network.connect` |

Casos de uso del roadmap: fuerza bruta (fallos de login repetidos), borrado masivo (rafaga de `file.write` en directorios sensibles), rastreos de puertos (muchos destinos distintos desde un proceso), spraying de credenciales. La señal es el CONTEO, no la regularidad ni la combinación.

## 2. Forma de la configuración

**Fichero propio `-thresholds ./thresholds.yaml`** (patrón `beacons.yaml`: versionado, cargado por defecto, ausente = apagado, malformado = FATAL, hot-reload en el ticker de 15s). Cada definición reutiliza el vocabulario de operadores de `internal/rules` como predicado por-evento, y añade el bloque de agregación:

```yaml
- name: Fuerza bruta SSH
  id: thr-ssh-burst
  description: muchos intentos de conexion al 22 desde un mismo origen
  severity: high
  event_type: network.connect        # sobre qué eventos contar
  conditions:                        # qué eventos cuentan (mismos 11 operadores de rules)
    - { field: network.destination_port, operator: eq, value: 22 }
  threshold:
    count: 20                        # disparar al alcanzar N
    window: 5m                       # ventana fija de conteo
    group_by: network.source_ip      # opcional: clave de agregación (dotted path)
  cooldown: 10m                      # silencio por clave tras disparar
  tags: [ttp:T1110, threshold]
```

**Decisiones de superficie:**

1. **Paquete nuevo `internal/threshold`**, NO dentro de `internal/rules`: `rules.Engine.Evaluate` es puro por evento y debe seguir siéndolo (tests, hot-reload y el contract de paridad dependen de ello). Threshold es estatal por diseño. El predicado de condiciones se reutiliza exportando de `rules` un `NewMatcher([]Condition) (*Matcher, error)` + `(*Matcher).Match(*model.Event) bool` — mismos operadores, misma compilación de regex, cero duplicación (los 11 operadores y sus tests siguen gobernando un solo sitio).
2. **`group_by` es un dotted path** resuelto con el mismo `FieldMap()` de `model.Event`. Clave de estado = `(ruleID, host, valorGroupBy)` como **struct** (lección del correlator: nada de concatenar strings con campos hostiles). Sin `group_by` ⇒ clave constante (conteo por host).
3. **Las alertas threshold alimentan el pipeline estándar** (dedup/triage/store/webhook/consola, wrapper de supresiones vía `SetEmit` idéntico al de beacon y correlator) pero **NO alimentan el correlator**: una alerta threshold es señal terminal (ya agrega N eventos); encadenarla duplicaría señales y rompería la semántica "pasos = reglas atómicas".
4. **Conservadura por defecto**: el pack versionado trae 2-3 definiciones con umbrales altos (el E2E usará perfiles agresivos propios, patrón `e2e_beacon.sh`).

## 3. El modelo de estado y sus bounds (el corazón del diseño)

**Contadores de ventana FIJA por clave** — no anillos de timestamps:

```go
type keyState struct {
    count       int        // eventos en la ventana abierta
    windowStart time.Time  // inicio de la ventana actual
    lastFired   time.Time
}
```

Cada estado son ~48 bytes. Con el cap global de claves de abajo, el peor caso de memoria del detector completo queda en **menos de 1 MB** — frente a los ~200 MB que costaría el diseño alternativo (anillo de timestamps estilo beacon con count alto). Trade-off asumido y documentado: la ventana fija tiene efecto de frontera (una rafaga que cruza el límite puede contar hasta 2×N en 2×T) — para DETECCIÓN es aceptable (el coste es una alerta extra, no una perdida; fail2ban hace el mismo trade-off) y queda escrito en el paquete. El beaconing, donde la FRONTERA es la señal, conserva su anillo deslizante — por eso son dos paquetes y no uno.

| Bound | Valor | Fallo que previene |
|---|---|---|
| `MaxRules` | 64 | Coste por evento no acotado (Observe camina todas las definiciones cuyo matcher aplique al event_type) |
| `MaxKeys` (global, compartido entre reglas) | 8192 | Feed hostil con `group_by` único (una IP origen inventada por evento) creciendo el mapa sin límite |
| `MaxCount` | 4096 | Un `count: 1000000` que jamás dispara = control mudo (fail-loud en validación) |
| `MaxWindow` | 24h | Ventanas absurdas que retienen estado sin sentido operativo |
| `maxFileBytes` | 4 MiB | Lectura completa de ficheros gigantes (mismo estándar de beacon/correlate) |
| IDs duplicados / severidad invalida / count<2 | rechazo en carga | Fichero que parsea pero no significa nada |

**Expulsión por debilidad** (invariante A1/A3): pasado `MaxKeys`, la admisión de una clave nueva expulsa primero claves totalmente expiradas (ventana vencida hace más de 2×window) y, si no hay, la de MENOR conteo con tie-break determinista (clave menor). Un flood de claves de 1 evento solo se consume a sí mismo; una clave acumulando evidencia (count alto) no es lavable. El juego de tests de A3 (flood previo → beacon real que dispara) se replica aquí.

**Cooldown y rearme**: al disparar, la ventana se REINICIA (count=0, windowStart=now) y `lastFired` blinda la clave durante `cooldown`. Reiniciar al disparar es lo que evita el re-disparo inmediato de un flujo sostenido (la ventana fija se rellenaría en T segundos): el operador recibe 1 alerta por rafaga sostenida, no una por ventana.

## 4. Superficie de observabilidad (mismo contrato que A3)

- `/api/stats`: `threshold_rules`, `threshold_keys`, `threshold_fired` — closures llamadas tras `h.mu.Unlock` (regla uniforme).
- `/metrics`: `sf_threshold_rules`, `sf_threshold_keys_tracked`, `sf_thresholds_fired_total` — totales sin labels (el detalle por definición vive en el `rule_id` de la alerta; cardinalidad acotada por construcción).
- Guard OpenAPI: +3 campos Stats (29 en total tras el aterrizaje).
- Consola: cero cambios obligatorios (las alertas entran en la cola existente); exponer el KPI en el dashboard queda para 03 como con A3.

## 5. Plan de verificación (antes de que 04 revise el aterrizaje)

1. **Unitarios con reloj inyectado** (`internal/threshold`, objetivo ≥14 tests, `-race`): dispara en N exacto; no dispara en N-1; frontera de ventana (expiración y reset); group_by agrega y separa; host case-folding; cooldown; expiración libera claves; flood no lava evidencia (invariante de expulsión); fichero malformado/duplicados/count>cap → error de carga con mensaje accionable; eventos que no pasan el matcher no cuentan; nil-safety.
2. **E2E `e2e_threshold.sh`** (patrón e2e_beacon): fase A — pack por defecto no dispara con el scenario canónico; fase B — definición agresiva dispara exactamente 1 sobre un burst del devsensor, cooldown mantiene 1, triage sobre la alerta, paridad stats/metrics; fase C — supresión perfil+host.
3. **devsensor `-burst N`**: burst de N `file.write` a `C:\Users\Public\` (T1070/T1485 narrativa) tras el scenario, default 0 (scenarios existentes byte-idénticos).
4. **Batería de la casa completa** + regresión e2e_beacon/e2e_store_sequences/smoke_lifecycle.

## 6. Preguntas concretas para la revisión de 04

1. **Ventana fija vs deslizante**: ¿aceptas el trade-off de frontera documentado (§3) a cambio del bound de memoria <1 MB, o exiges anillo deslizante con cap de count menor?
2. **`MaxKeys` global compartido vs por-regla**: global evita que una regla agresiva muera de hambre por otra, pero una regla puede desplazar a otra del mapa. ¿Global (propongo) o por-regla con techo total?
3. **No alimentar el correlator desde threshold** (§2.3): ¿lo confirmas o quieres encadenabilidad?
4. **Export de `NewMatcher` desde `internal/rules`**: toca el paquete más delicado del tree; la alternativa (duplicar operadores en threshold) viola single-source-of-truth. ¿Ves riesgo en el export?
5. **Severidad del pack por defecto**: propongo medium en los 2-3 umbrales conservadores iniciales (un threshold mal afinado por el operador genera ruido en burst; medium lo refleja) — ¿high?

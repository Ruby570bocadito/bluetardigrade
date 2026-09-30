# Diseño C3 — Respuesta activa segura (iteración 1: `kill_process`)

- **Autor:** Agente 02-A (Implementaciones, carril backend Go)
- **Fecha:** 2026-09-30 15:58 (Europe/Madrid)
- **Estado:** PROPUESTO — C3 es el paquete declarado "espera diseño" (actas 12h30 de 02 y 08h40 del Director; la 22h01 del Director fija la plantilla). **Pendiente de revisión de 04 ANTES del aterrizaje** (mismo orden vinculante que A2: diseño con bounds → revisión de 04 → aterrizaje).
- **Base del diseño:** la arquitectura de la Decisión 6.1 (escritura de supresiones vía API: flag explícita, superficie registrada condicionalmente, bearer token, escritura atómica, caps de campos) y los invariantes certificados de `internal/lifecycle` (C1) y `internal/actions` (base C2).

---

## 1. El problema que C3 resuelve

El framework detecta y triaja pero no actúa: ante una alerta crítica el operador tiene que localizar el proceso a mano. La respuesta activa cierra el loop — y es también la superficie donde un error cuesta más (matar un proceso legítimo, o peor, dejar un mecanismo de kill accesible sin control). Por eso C3 no es una feature, es una arquitectura de permisos con una acción dentro: el diseño replica el molde de la Decisión 6.1 (opt-in por capas, fallo ruidoso, auditoría completa) y aplica la filosofía "degrade loudly" del propietario a la acción destructiva.

**Alcance de la iteración 1 — SOLO `kill_process`, SOLO host local del engine.** Justificación: (a) `kill_process` es reversible por relanzamiento; `quarantine_file` no lo es con la misma facilidad y añade superficie de integridad (mover ficheros abiertos, restore) — queda para la iteración 2 con su propio diseño; (b) el engine hoy ejecuta todo en un host (sensor local o remoto → engine → consola); ejecutar una acción EN el host del sensor remoto requiere un actor remoto autenticado que hoy no existe — inventarlo aquí sería ampliar la superficie de seguridad sin revisión; el multi-host queda bloqueado hasta que exista ese actor (se anota como dependencia, no como promesa).

## 2. Principios de permisos (el corazón del paquete)

Cinco capas, TODAS requeridas; fallar cualquiera deniega y AUDITA. El orden está pensado para que lo más barato deniegue primero:

1. **La ruta no existe sin flag.** Igual que la escritura de supresiones (`run.go:382-384`: la superficie se registra condicionalmente), `POST /api/respond` solo se registra en el mux si la flag correspondiente está activa. Sin flag: 404 real — no "403 de un endpoint que existe". Dos flags separadas, una por acción (plantilla de la 22h01): `-allow-kill` (iteración 1) y `-allow-quarantine` (iteración 2, reservada en el diseño pero sin implementar). Env alternos: `SF_ALLOW_KILL=1`, siguiendo el patrón `SF_API_WRITE`.
2. **Bearer token obligatorio** (el mismo `-api-token`/`SF_API_TOKEN` del hub, misma verificación `subtle.ConstantTimeCompare` del middleware existente). Sin token configurado en el engine, la respuesta activa no puede activarse aunque la flag esté: flag AND token, nunca OR. Documentado en el texto de la flag.
3. **Allowlist de operadores.** El cuerpo de la petición trae `operator` (nombre del operador humano que asume la acción, mismo concepto y mismos caps que el campo `operator` de las supresiones). Un fichero `-respond-operators ./respond-operators.yaml` (patrón `thresholds.yaml`: versionado, malformado = FATAL, hot-reload en el ticker de 15 s, ausente = allowlist vacía = TODO denegado) lista los operadores autorizados a ejecutar respuesta activa. Cap de techo del fichero: 128 operadores (misma casa de caps que el loader de reglas).
4. **Guard de proceso (la capa que evita el daño).** Antes de ejecutar, el paquete `internal/respond` resuelve el PID y verifica: (a) el proceso EXISTE; (b) su nombre real coincide con el `process_name` solicitado (mismatch = denegar `pid_recycled` — la ventana de reciclaje de PID es el vector clásico de kill equivocado); (c) NO es el propio engine ni su ancestro (`os.Getpid()`, `os.Getppid()`); (d) NO está en la lista de procesos protegidos (fichero opcional `-respond-protected`, con default razonable documentado por plataforma); (e) respeta cooldown y techos de §4.
5. **Auditoría antes de ejecutar.** Cada intento (ejecutado O denegado) escribe una línea JSONL en `-respond-audit ./respond-audit.jsonl` ANTES de enviar la señal: la denegación queda tan registrada como la ejecución. Si la escritura del audit falla, la acción NO se ejecuta (el audit es precondición, no telemetría — "la acción que no puede probarse que ocurrió, no ocurre").

## 3. Forma de la API y de los mensajes

```
POST /api/respond/kill
Authorization: Bearer <token>
{
  "host": "LAB-WKS-01",          # informativo en iteración 1 (solo host local); cap 253 runes
  "pid": 4242,                    # > 1; 0/1/negativo = denegación pid_invalid
  "process_name": "malware.exe",  # cap 256 runes; debe coincidir con el nombre real
  "rule_id": "thr-ssh-burst",     # regla o secuencia que motivó la acción; cap 128
  "alert_id": "a1b2c3",           # opcional; el alert de origen si existe; cap 64
  "operator": "ana",              # debe estar en el allowlist
  "reason": "force brute force detected",  # cap 512; obligatorio no vacío
  "idempotency_key": "op-2026-09-30-001"   # opcional; cap 128; dedup por clave
}

202 {"action_id":"...", "status":"executed", "signal":"SIGKILL"}
403 {"error":"operator_not_allowed|process_protected|pid_mismatch|..."}
404 (sin flag) / 401 (sin token) / 409 (idempotency_key repetida) / 429 (techo de tasa)
```

Respuesta **síncrona** en iteración 1 (el kill local es rápido y el operador quiere el resultado real, no una promesa): `executed` con la señal enviada, o error explícito con la causa. Nada de colas ni workers — la complejidad asíncrona solo se justifica con actores remotos (fuera de alcance).

## 4. Bounds explícitos (el capítulo que A2 hizo obligatorio para este tipo de paquete)

| Bound | Valor | Por qué |
|---|---|---|
| Cooldown por (host,pid) | 60 s | Un loop alert→kill no puede convertir el remedio en el ataque |
| Techo global de acciones | 20 / minuto | Runaway de automatización externa; la 429 documenta el techo |
| Acciones en vuelo | 1 (síncrono, mutex) | La respuesta activa es deliberada, no un pipeline |
| PID válido | > 1 | 0/-1 tienen semántica de señal masiva en Unix — prohibidos |
| Campos de texto | caps §3 | Mismo criterio `normalizeIdentity`: un writer hostil no ancla memoria |
| Fichero audit | append-only JSONL, 1 línea por intento, fsync por línea | El registro de un mecanismo destructivo no puede truncarse ni reescribirse |
| Fichero operadores | ≤ 128 entradas | Techo del estilo de las 2048 reglas del loader |

## 5. Estructura del código (iteración 1)

```
internal/respond/
├── respond.go        # Manager: allowlist de operadores, guards, cooldown, techo de tasa
├── audit.go          # Writer JSONL append-only con fsync (patrón de la store: tmp+rename N/A aquí; append atómico por línea)
├── process_unix.go   # FindProcess + señal SIGKILL + resolución del nombre real (/proc o syscall)
├── process_windows.go# OpenProcess + verificación de nombre + TerminateProcess (build-tag windows)
└── *_test.go         # cobertura de guards, allowlist, cooldown, audit-fail-aborts
```

Wiring en `cmd/engine/run.go`: flags nuevas (`-allow-kill`, `-respond-operators`, `-respond-protected`, `-respond-audit`), registro condicional de la ruta (solo flag AND token), impresión de arranque `[ENGINE] active response: kill_process ENABLED (operators: N)` o `disabled` — el estado de una superficie destructiva se anuncia en el arranque, nunca se adivina. El hub recibe el Manager por setter (patrón `SetSuppressions`). Iteración 1 NO toca `internal/actions` (el dispatcher de reglas es para notificaciones C2; acoplar kill a reglas automáticas sin revisión dedicada es exactamente el riesgo que el diseño evita — la respuesta activa se invoca POR OPERADOR, vía API; la automatización total es una decisión de producto posterior al aterrizaje).

## 6. Plan de pruebas (definido ANTES del aterrizaje, como A2)

1. **Unit (`internal/respond`):** allowlist vacía deniega todo; operator válido + pid inexistente = `pid_not_found`; mismatch de nombre = `pid_mismatch`; pid propio/ancestro = `self_protected`; proceso protegido = `process_protected`; cooldown = `cooldown_active`; techo = `rate_limited`; audit roto = acción abortada con `audit_unavailable`; idempotency repetida = 409. Cada caso afirma TAMBIÉN la línea de audit correspondiente (denegaciones incluidas).
2. **Cross-platform:** los tests de guards corren en Linux (CI) y el canal cargo/`GOOS=windows` certifica que `process_windows.go` compila; la verificación conductual en Windows real queda como condición de CIERRE del paquete (mismo criterio que T1/T2: sin host Windows no se declara cerrado, se declara "aterrizado, smoke pendiente").
3. **E2E (`scripts/dev-tests/e2e_respond_kill.sh`):** engine real con `-allow-kill` + token + allowlist de laboratorio; proceso dummy (`sleep 300` con nombre rastreado); (a) kill feliz → 202 + proceso muerto + audit ejecutado; (b) sin flag → 404 (la ruta no existe); (c) sin token → 401; (d) operator fuera de allowlist → 403; (e) pid de un proceso protegido (el propio engine) → 403; (f) kill repetido dentro de cooldown → 429/409; (g) audit presente y parseable en todos los casos. El script verifica el NEGATIVO (la denegación audita) tanto como el positivo.
4. **Verificación de no-regresión:** batería completa (15/15 paquetes, `-race` en ingest/beacon/ingest+lifecycle, guard OpenAPI sin deriva, E2E existentes) — la ruta nueva añade mux entries, no toca las existentes.

## 7. Qué NO hace esta iteración (explícito, para que nadie lo asuma)

- `quarantine_file` (iteración 2, diseño propio con integridad y restore).
- Acciones en hosts remotos (requiere actor autenticado en el protocolo sensor — dependencia nueva que se diseña, no se improvisa).
- Kill automático disparado por reglas sin operador (decisión de producto posterior; el diseño deja la puerta lista — el Manager — pero no la abre).
- Undo/rollback (un kill no se deshace; por eso el guard de proceso es la capa más gruesa del diseño).
- Soft-kill/graceful (SIGTERM primero con timeout → SIGKILL como política configurable: se deja anotado para la revisión de 04, iteración 1 envía la señal que el cuerpo pida entre {SIGTERM, SIGKILL} con default SIGKILL y la audita).

## 8. Preguntas abiertas para la revisión de 04 (las que deben salir del dictamen)

1. ¿Signal configurable (§7) o SIGKILL fijo en iteración 1? (El diseño prefiere configurable con default SIGKILL; el revisor decide.)
2. ¿El techo de 20/min es el correcto para un SOC real, o debe ser por-operador además de global?
3. ¿`process_windows.go` necesita además verificación de firma del binario objetivo antes de matar (un PID secuestrado por process hollowing tiene otro nombre real que el que el SO expone)? Iteración 1 propone NO (complejidad alta, beneficio marginal sobre el check de nombre); 04 puede vetar.
4. ¿El audit JSONL rota? Iteración 1: no rota (append-only, el operador rota externamente como el lifecycle file); ¿exige 04 un cap de tamaño?

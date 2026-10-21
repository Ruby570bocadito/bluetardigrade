# TASKS.md — Tablero de asignación de agentes

Capa de asignación sobre [TODO.md](TODO.md): el QUÉ con todo el detalle
sigue en TODO.md; aquí solo va el QUIÉN y el ESTADO.

**Estados**: `libre` · `en progreso (rol, fecha)` · `en revisión (PR #N)` ·
`bloqueada (motivo)` · `hecha (PR #N)`

**Roles**: AG-1 MOTOR (Go) · AG-2 SENSOR (Rust) · AG-3 CONSOLA (TS) ·
AG-4 OPS/QA (docs+rules+CI) · HUMANO

**Cómo reclamar una tarea**: primer commit de tu rama actualiza esta fila
con `en progreso (tu rol, fecha)`. Si ya está reclamada o «en revisión»,
elige otra libre de tu rol. Al fusionarse el PR, el humano la marca `hecha`.

---

## Hornada 1 — arranca ya (tareas independientes, una por agente)

| ID | Tarea (resumen) | Rol | Depende de | Ref. TODO | Estado |
|----|-----------------|-----|-----------|-----------|--------|
| H-1 | Borrar ramas `100agentes`, `audit/mejoras-2026-10-08`, `integracion/rondas-2-3` y activar «Automatically delete head branches» | HUMANO | — | F0 | libre |
| H-2 | Decidir tags sueltos `console-v1`/`v0.1.0`; descripción «About» y topics | HUMANO | — | F0 | libre |
| H-3 | Fusionar o cerrar Dependabot #24–#27 con CI en verde | HUMANO | — | F0 | libre |
| H-4 | Probar `sf-start`/`sf-stop`/`-KeepSensor`/`sf-status` y el instalador silencioso en Windows real | HUMANO | — | F1 | libre |
| M-1 | TEAM-3 backend: asignación de alertas en el ciclo de vida del motor (API, estados, cola sin asignar) | AG-1 | — | F3 | en revisión (PR #45) |
| S-1 | Registro: resolver raíz `?` por usuario del proceso (`HKU\`) y enviar `registry.value_data` | AG-2 | — | Backlog/Sensor | en revisión (PR #40) |
| C-1 | Rediseño del dashboard con el kit de componentes POL-7 en todas las vistas | AG-3 | — | F5 | hecha (PR #38) |
| O-1 | POL-5: OPERATIONS por capítulos + esqueleto de la guía de suscripción WEF | AG-4 | — | Calidad + F3 | hecha (PR #39) |
(motor: claim M-1 (TEAM-3 backend) + round plan (A))

## Hornada 2 — en cuanto la 1 esté en revisión/avanzada

| ID | Tarea (resumen) | Rol | Depende de | Ref. TODO | Estado |
|----|-----------------|-----|-----------|-----------|--------|
| C-2 | TEAM-3 frontend: vista «Mis alertas», cola sin asignar, reasignación y lote | AG-3 | M-1 (contrato API) | F3 | libre |
| M-2 | AD-7: login con cuentas del dominio (bind LDAPS, grupos AD → roles) | AG-1 | — | F2 | libre |
| S-2 | YARA en sensor: escaneo con `yara-x` de ficheros escritos y bajo demanda | AG-2 | — | F3 | libre |
| M-3 | YARA en motor: reglas guardadas y distribución firmada a sensores | AG-1 | contrato con S-2 | F3 | libre |
| O-2 | Reglas AD: 4625 rociado, 4769 Kerberoasting, 4662 DCSync, 4728/4732/4756, 7045 | AG-4 | — | F3 | libre |
| H-5 | Probar login, MFA y cuentas en Windows real (secciones 7/7b/7c) | HUMANO | H-1 | F2 | libre |

## Hornada 3 — épica «Respuesta ampliada» y resto de F3/F4

| ID | Tarea (resumen) | Rol | Depende de | Ref. TODO | Estado |
|----|-----------------|-----|-----------|-----------|--------|
| E-1 | Canal servidor→sensor: órdenes firmadas, con caducidad y antirreplay | AG-1 + AG-2 | contrato M↔S | F3 | libre |
| E-2 | Acciones cerradas en sensor: aislar/liberar, terminar proceso PID+hash, cuarentena de fichero, paquete forense | AG-2 | E-1 | F3 | libre |
| E-3 | Niveles por grupo, aprobación 1–2 personas, equipos protegidos, límites por hora, interruptor general | AG-1 | E-1 | F3 | libre |
| E-4 | Opción opt-in en el instalador (apagada por defecto) + UI de niveles y aprobaciones | AG-3 + AG-4 | E-3 | F3 | libre |
| C-3 | Editor de reglas YAML en consola con validación, probador e historial; importar Sigma | AG-3 | M-3 | F3 | libre |
| M-4 | Consulta BD solo lectura: límites de tiempo/filas, admin, auditada | AG-1 | — | F3 | libre |
| C-4 | UI de consulta BD + lenguaje de búsqueda `campo:valor`, AND/OR/NOT (IDEA-4) | AG-3 | M-4 | F3 | libre |
| M-5 | ML beta de triaje (`-ml-beta`, explicable, aprende de veredictos) | AG-1 | M-1 y C-2 | F4 | libre |
| M-6 | Analista IA con alcance por grupos (el hub lee el motor con el alcance de quien pregunta) | AG-1 | — | F2 | libre |
| S-3 | Auditoría de servicios Windows con permisos débiles (DACL, rutas sin comillas), solo lectura | AG-2 | — | F2 | libre |
| S-4 | Latido informa EventsLost/BuffersLost y descartes del hilo de hashes | AG-2 | — | Backlog | en revisión (PR #42) |
| SEC-2 | Credencial del sensor (`ingest.token`) cifrada con DPAPI | AG-2 | — | Backlog | libre |
| C-5 | Aviso de sensores desactualizados en Equipos (versión ya va en el latido) | AG-3 | S-4 | Backlog | libre |
| M-7 | WEF: registro de Seguridad de DC y servidores; AD-3 inicios de sesión y AD-4 cambios, retención configurable | AG-1 | O-2 | F3 | libre |

## Hornada 4 — escaparate, calidad y forense

| ID | Tarea (resumen) | Rol | Depende de | Ref. TODO | Estado |
|----|-----------------|-----|-----------|-----------|--------|
| C-6 | Vista «Forense» en la barra lateral: paquetes, búsqueda, filtros, enlaces | AG-3 | — | Backlog | libre |
| M-8 | Forense: cadena de custodia SHA-256 al congelar y comprobación al exportar; retención configurable | AG-1 | — | Backlog | libre |
| O-3 | F5: terminar idiomas (IDEA-10) junto a AG-3; capturas, vídeo y README nuevo | AG-4 + HUMANO | C-1 | F5 | libre |
| O-4 | POL-6: release con SBOM (CycloneDX) y sensor firmado entre artefactos | AG-4 | — | Calidad | libre |
| O-5 | SEC-3/SEC-6/SEC-9: revisión de entradas, cadena de suministro y privacidad (informe + parches mínimos) | AG-4 | — | Calidad | libre |
| M-9 | POL-1: dividir `internal/api/api.go` y `cmd/engine/run.go`; POL-2 logs con `log/slog` | AG-1 | — | Calidad | libre |
| S-5 | POL-1: dividir `sensor/src/collector.rs` sin cambiar comportamiento | AG-2 | — | Calidad | hecha (PR #43) |
| P-3 | POL-3: perfiles `pprof` del camino caliente en el benchmark nocturno (flag `-pprof-dir` del motor + artefactos del bench) | Pulimiento B (backend) | — | Calidad | hecha (directo a main, PR #41 cerrado) |

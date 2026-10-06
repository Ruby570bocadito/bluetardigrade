# Plan de ronda — Seguridad B (ronda 8, 2026-10-06) — última de RONDAS_MAXIMAS

Contexto: el entorno se reinició de nuevo tras publicar la ronda 7
(55c8b35 en remoto, sin pérdida). Al sincronizar aparece lo que el
carril esperaba toda la jornada: **IMP-A publicó AD-1 y SEC-2**
(`f8853eb` conector LDAPS de solo lectura, `3c8a97d` sobres DPAPI).
Se cumple la condición de reanudación (a) y la auditoría pendiente es
la tarea principal de esta ronda de cierre.

1. **AD-1, auditoría del conector AD de solo lectura** (IMP-A,
   `f8853eb` + `bc91c7d`): checklist del modelo de amenazas §3 y del
   TODO — LDAPS obligatorio con CA configurable y validación de
   nombre; sin LDAP plano; escape RFC 4515 de todo valor interpolado
   en filtros; paginación RFC 2696 y límite de objetos; errores con
   servidor y código de resultado sin credencial (test de logs);
   contraseña solo en fichero del servicio y jamás devuelta por la
   API; cuenta sin privilegios (postura de solo lectura); fixture
   LDAP de pruebas en CI; auditoría de la dependencia LDAP nueva
   (go.mod): procedencia, licencia, superficie de red.
2. **SEC-2, auditoría de secretos en reposo** (IMP-A, `3c8a97d`):
   checklist del addendum de la ronda 4 — sobre JSON
   `dpapi|plain` con versión; Windows LOCAL_MACHINE (no usuario);
   Linux/macOS plain+0600 sin criptografía casera; bind de prueba
   antes de comprometer el fichero (temp+rename+Sync); flag con la
   RUTA, secreto nunca por argv/env; contraseña como `[]byte` puesta
   a cero; errores accionables sin filtrar contenido; logs y API sin
   secreto ni longitud; aviso único en Windows para `plain` donde se
   espera `dpapi`, sin reescritura automática; los 5 tests exigidos.
3. **IMP-B, revisión de la ronda 6** (`46e3996`, i18n fase 1 que
   integra el asistente de primer arranque de IDEA-11): manejo de
   localStorage (validación, sincronía multi-pestaña), sin
   `dangerouslySetInnerHTML` con datos de eventos, sin secretos en
   cliente, textos del motor jamás traducidos (integridad de
   contratos); veredicto a nivel de commit, re-auditoría al fusionar.
4. **Cruces ligeros:** fix de idempotencia de SEG-A (`1979f83`,
   re-check single-flight en commit); adopción fuzz de PUL-A
   (`a88badc`, ya verificada byte a byte por SEG-A — constatar);
   barrido de seguridad del diff a11y de PUL-B (`fa2b56a`, 17 fixes
   sobre vistas que incluyen las de la guardia CSV de mi ronda 7).
5. **Verificación y cierre:** batería de consola en el clon nuevo
   (instalación congelada, tests, tsc, build); el árbol Go de MI rama
   es idéntico al commit 55c8b35 ya validado en la ronda 7 (gofmt,
   build Linux/Windows, vet, 37 paquetes -race, govulncheck,
   staticcheck) y no se repite salvo hallazgo propio; informe de
   ronda + roadmap; sin fragmento de changelog (ronda de revisión,
   sin cambio visible de usuario en mi carril).

Fuera de alcance (queda anotado para quien fusione): SEC-9 verificación
del ciclo real de `deps-audit` exige que las rondas lleguen a `main`
(sigue en 35cd866); conflicto ya anotado con `seguridad-a` en
`internal/scenrun/scenrun_test.go` (conservar ambos tests EOF).
Al terminar esta ronda el carril SEG-B cierra su cuota de RONDAS_MAXIMAS.

# Política de seguridad

bluetardigrade es un producto de seguridad de producción: la misma exigencia que el producto pide a sus entradas de datos se aplica a la recepción de sus propias vulnerabilidades. Este documento define el canal coordinado; el reporte público de vulnerabilidades con detalle de explotación no es el camino.

## Versiones con soporte

| Versión | Soporte de seguridad |
|---|---|
| main (HEAD) | Sí — única línea de desarrollo; las correcciones aterrizan en main |
| tags / releases anteriores | No — se asume que los despliegues siguen main o builds etiquetados recientes |

Se publican releases versionadas (tags `vX.Y.Z`; los candidatos usan el sufijo `-rc`). Reporta contra la última release publicada; para builds antiguos, reporta contra el commit exacto. Mientras tanto, reporta siempre contra el commit exacto (`git rev-parse HEAD`) del build afectado.

## Cómo reportar una vulnerabilidad

**Canal privado:** GitHub Security Advisories de este repositorio (pestaña *Security* → *Report a vulnerability*). Ese canal es privado entre el reportante y los mantenedores y no genera issue público.

**Qué incluir** (cuanto más completo, más corta la primera respuesta):

1. **Versión/commit** exacto del build afectado y plataforma (Linux/Windows, versión de Go o binario de release).
2. **Vector**: componente (engine, ingest, API del motor, consola web, hub, notificaciones, sinks SIEM/webhook, instalador PowerShell) y ruta de acceso necesaria (red local, loopback, fichero de config, feed de sensores).
3. **Evidencia de laboratorio**: reprodución mínima (config, comando o payload), salida relevante, y — cuando aplique — la misma tradición de evidencia que pide el README a los PRs de detección. Sin explotación contra sistemas de terceros.
4. **Impacto estimado** y condiciones de explotación (requiere credenciales? requiere config no por defecto?).
5. Si conoces la corrección propuesta, descríbela; si no, el diagnóstico basta.

**SLA declarado:** primera respuesta (triage: válida / no reproducible / fuera de alcance) en **72 horas** desde el reporte; actualización de estado al menos cada 7 días hasta cierre. Un fix aterrizado en main cita el advisory y acredita al reportante (salvo petición de anonimato).

## Alcance

**En alcance:** el motor Go (`cmd/engine`, `internal/*`, `pkg/*`), la consola web y su proxy (`web/`), el hub (`web/console-service`), la landing (`website/`), el instalador y desinstalador PowerShell, y la cadena de CI (`.github/workflows/`).

**Fuera de alcance:** herramientas de laboratorio del equipo en `scripts/` (no se distribuyen como producto), escaneos automatizados no destructivos que solo reportan lo que ya es público, y hallazgos que requieran acceso físico al host del operador.

## Divulgación coordinada

1. Reporte privado por el canal de arriba.
2. Triage y confirmación por los mantenedores (con réplica al reportante).
3. Fix en main con test de regresión falsable (el estándar del repo), sin mención del detalle de explotación en el mensaje de commit.
4. Publicación del advisory (con CVE si procede) una vez el fix esté aterrizado y verificado por CI.

## Nota sobre secretos

Nunca incluyas credenciales reales (tokens de Telegram, hooks de Slack, API keys, PATs) en un reporte: usa valores de laboratorio. Si un reporte requiere demostrar una fuga de credencial, el patrón del propio producto — redactar el endpoint a `scheme://host` — es suficiente evidencia.

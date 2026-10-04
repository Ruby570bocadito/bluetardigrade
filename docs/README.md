# docs/ — documentación del proyecto

Documentación del usuario y del operador. El registro histórico de rondas de
desarrollo y los informes de proceso se archivaron fuera del árbol público en
la ronda de renombrado a **bluetardigrade** (2026-10-01); el historial de git
conserva la trazabilidad completa.

## Mapa

| Ruta | Contenido |
|------|-----------|
| [INSTALACION-Y-ESTADO-SOC.md](INSTALACION-Y-ESTADO-SOC.md) | Instalador, retirada de demo, recuperación, estado operativo y próximos pasos |
| [SOC-INTEGRACIONES-E-INFORMES.md](SOC-INTEGRACIONES-E-INFORMES.md) | Seis fuentes observadas, reglas SOC, phishing/firewall, informes humanos CLI/dashboard, pruebas y límites |
| [INVESTIGACION-CLI-Y-TRIAJE.md](INVESTIGACION-CLI-Y-TRIAJE.md) | Búsqueda CLI por ID y términos, accesos de triaje del dashboard, navegación y regresiones |
| [DETECCION-Y-EVIDENCIA.md](DETECCION-Y-EVIDENCIA.md) | Nuevas alarmas de ficheros, correcciones de contexto/YAML/forense, exportación y pruebas |
| [INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md](INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md) | Búsquedas locales, protección CSV completa, progreso y límites del analista, código real frente a demo/fixtures |
| [GUIA-INICIO.md](GUIA-INICIO.md) | Arranque y operación en español: primera instalación, CLI, consola, histórico y resolución de problemas |
| [STARTUP-FIXES.md](STARTUP-FIXES.md) | Arranque en Windows (inglés): origen del hub, CSP de la consola, credenciales de ingest y webhook heredadas por los procesos hijos |
| [DOCTOR.md](DOCTOR.md) | Diagnóstico de reglas, autenticación, persistencia, sensores y consola, con salida JSON |
| [PHISHING.md](PHISHING.md) | Señales observables en correo EML y límites de la detección offline |
| [WINDOWS-SERVER.md](WINDOWS-SERVER.md) | Despliegue persistente sin sesión gráfica y configuración del servidor |
| [FLOTA-REMOTA.md](FLOTA-REMOTA.md) | Vigilar varios equipos desde un servidor: alta de equipos, identidades, TLS, cortafuegos, tarea de arranque y alerta de sensor sin señal |
| [PRUEBAS-PENDIENTES.md](PRUEBAS-PENDIENTES.md) | Lista de pruebas que necesitan un Windows real (sensor, Sysmon, flota remota, inteligencia, línea base, cuentas de la consola) |
| [../intel/README.md](../intel/README.md) | Listas de inteligencia offline: formato de los ficheros, qué se compara, recarga y límites |
| [SMART-APP-CONTROL.md](SMART-APP-CONTROL.md) | Diagnóstico de bloqueos de ejecución y distribución con firmas Authenticode |
| [PALETA-Y-PRUEBAS-NAVEGADOR.md](PALETA-Y-PRUEBAS-NAVEGADOR.md) | Paleta de comandos de la consola: foco modal, proteccion de atajos y pruebas Chromium de escritorio/movil |
| [OPERATIONS.md](OPERATIONS.md) | Guía de operación (inglés): instalación (Windows, Docker, fuente), referencia de flags y variables de entorno, API HTTP, Prometheus, almacenamiento, auth de ingest con rotación, sinks SIEM, notificaciones, supresiones, triaje, riesgo, beaconing, respuesta activa, inteligencia offline, línea base de procesos, cuentas de la consola, contenido de detección, CLI y CI/bench |
| [ROADMAP.md](ROADMAP.md) | Direccion del producto: entregas proximas por horizontal (deteccion, forense, sensor, consola) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitectura del sistema (inglés): diagrama, contrato del esquema de eventos, inventario de características y árbol del repositorio |
| [false-positive-control.md](false-positive-control.md) | Guía de control de ruido: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso |
| [api/openapi.yaml](api/openapi.yaml) | Contrato OpenAPI de la API del motor (mantenido en sincronía por el guard de CI) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes en `assets/src/` |
| `assets/src/` | Fuentes de capturas y portadas + utilidades de regeneración (Playwright, assemble_gif.py) |

## Documento de arquitectura

La arquitectura vigente está en [ARCHITECTURE.md](ARCHITECTURE.md). El PDF
técnico v0.11 se retiró porque ya no coincidía con el código; sus revisiones
anteriores siguen en los assets de GitHub Releases.

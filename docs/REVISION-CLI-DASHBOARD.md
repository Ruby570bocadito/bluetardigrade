# Revisión de CLI, dashboard y documentación

**Actualización del 1 de octubre de 2026:** los cuatro jobs de CI del
[PR #4](https://github.com/Ruby570bocadito/security-framework/pull/4) pasan
sobre `4b153af`, incluidos Bun, build Next.js, Go completo, comprobaciones
Rust y smoke nativo del motor en Windows. Véanse la evidencia y los límites
todavía vigentes en el [registro completo](RESUMEN-MEJORAS-2026-10-01.md).
El resto del informe conserva los resultados locales de esta primera ronda.

Primera ronda sobre `8c3b1d7`, preparada en
`codex/interactive-cli-dashboard-review`. Incluye cambios de código y
regresiones, además de la revisión; la publicación remota requiere acceso
de escritura a GitHub.

## Resultado

- CLI con vistas de alertas y reglas, búsqueda, severidad, selección
  estable, detalle desplazable, pausa y ayuda. Se adapta al terminal.
- Dashboard con prioridad de triaje, incidencias operativas, actualización
  manual y estados distintos para la API y el canal en vivo.
- README reducido y organizado por arranque, operación, arquitectura,
  desarrollo y siguientes mejoras; guía de inicio en español.
- Sin nuevas dependencias de ejecución para la interfaz. El comprobador
  DOM usa herramientas opcionales separadas de la aplicación.

## Hallazgos corregidos

| Hallazgo | Consecuencia anterior | Corrección |
|----------|----------------------|------------|
| La shell pasaba toda la query a `viewFromParam` | Recargar un enlace o navegar por historial volvía al panel | Leer `readOperatorState(search).view` |
| El gráfico dependía solo de cambios en eventos | La actividad antigua no desaparecía durante la inactividad | Reloj de cinco segundos y función de ventana temporal |
| El máximo del gráfico estaba forzado a uno | Un búfer vacío indicaba pico uno | Separar máximo real y escala mínima |
| KPIs sin lectura usaban cero | Un fallo podía parecer ausencia de alertas o errores | Mostrar `—` y «sin datos» |
| Caída de API conservaba eventos, alertas y reglas | Datos antiguos seguían visibles junto al estado offline | Vaciar las superficies al confirmar caída |
| Repeticiones SSE se insertaban e incrementaban contadores | Alertas duplicadas y totales inflados; posible pérdida del triaje | Deduplicar por identidad, preferir el triaje REST durante sync y conservar contadores del motor |
| Una sincronización sustituía la lista mientras llegaban frames | Podían perderse eventos recientes | Combinar snapshot y llegadas durante la lectura |
| Poller sin plazo y con intervalos solapables | Peticiones acumuladas o estado vivo bloqueado | Plazo de cinco segundos, lotes asentados y polling serial |
| Un 404 opcional conservaba respuesta activa anterior | Una superficie desactivada podía seguir apareciendo armada | Distinguir ausencia real de error transitorio |
| Reglas cargadas una sola vez | El catálogo no seguía al hot reload | Consultarlo también en el poller |
| Scroll podía llegar más allá de la última alerta | Lista vacía con alertas retenidas | Acotar selección y viewport |
| Llegadas/reloads desplazaban el detalle seleccionado | El operador podía pasar a otra evidencia sin elegirla | Identidad estable; cerrar detalle al expulsar/eliminar la entrada |
| Campos de telemetría se imprimían sin neutralizar controles | Saltos de línea, escapes y controles bidi alteraban el terminal | Limpiar solo la presentación; preservar JSON y evidencia |
| Banner TUI mostraba URL completa de webhook | Credenciales en userinfo, ruta o query podían quedar visibles | Reusar `redact.EndpointLabel` |
| Parser de Host separaba IPv6 por dos puntos | `[::1]:3000` quedaba rechazado | Parsear autoridad completa y rechazar delimitadores inválidos |
| Proxy materializaba triaje antes del límite del motor | Lectura local sin límite equivalente | Contar bytes, cancelar exceso y responder 413 antes de reenviar |
| Subcomandos aceptaban posicionales ignorados | Una errata podía ocultar banderas posteriores | Rechazo explícito en run/rules/validate/sigma |
| Varios comandos ignoraban el writer de Cobra | Salida difícil de capturar o integrar | Respetar writers en ayuda, reglas, validación, versión y Sigma |
| Makefile del sensor no indicaba su manifest | Compilar desde la raíz buscaba un Cargo.toml inexistente | Añadir `--manifest-path sensor/Cargo.toml` |

El encabezado agrupa chips sin desbordar la fila, la consola incluye un
salto al contenido para teclado y reconoce la fuente ETW real.
El límite del gráfico y la ventana de triaje se explican como muestras:
no son el histórico completo de un motor con mucho tráfico.

## Verificación

| Comprobación | Resultado |
|--------------|-----------|
| Go build, vet y compilación cruzada Windows | Correctos |
| Tests de CLI y redacción con `-race` | Correctos |
| Regresión de salida humana/JSON | Correcta; controles neutralizados, JSON original intacto |
| `engine validate` | 23 reglas, cuatro secuencias, cero avisos |
| Motor + devsensor + API reales, en loopback | 19 eventos, 18 alertas, 23 reglas |
| TypeScript de consola y hub | Correcto |
| Pruebas de consola existentes y nuevas | 79/79 con adaptador temporal Node `node:test` + `expect`; no ejecución nativa Bun |
| Flujos del provider y dashboard en DOM | 11/11 con el harness versionado, fixtures REST/SSE y React StrictMode |
| Dependencias directas de consola frente a `bun.lock` | Coinciden; Next 16.3.6 y Motion 13.4.5 |
| OpenAPI y autopruebas del guard | Correctos: 15 rutas, 36 campos Stats, 74 referencias y 13 variantes negativas |
| Diff y formato | Sin errores de whitespace; Go formateado |
| Targets Cargo corregidos | Receta revisada con `make -n`; compilación Rust pendiente |

El harness DOM comprueba: carga, replay y decisiones, recarga de reglas,
expiración de actividad sin eventos nuevos, navegación a la cola, 404 de
respuesta, evento y replay recibidos durante snapshot, decisiones de triaje
durante sincronización, aviso de canal reconectando,
caída sin datos antiguos, recuperación manual y cierre de conexiones.
Instrucciones: [scripts/dev-tests/README.md](../scripts/dev-tests/README.md#functional-console-dom-checks).

### Límites reales de este entorno

No se certifica `make ci` completo:

- Bun aborta incluso ejecutando una expresión mínima y no puede
  completar instalación congelada ni su batería nativa aquí.
- `next build`, tanto con Turbopack como con webpack, se detiene con
  `ENOENT: uv_resident_set_memory` por las restricciones del entorno.
  TypeScript y DOM pasan; falta confirmar el bundle de producción.
- La batería inicial de Go falla en las pruebas de respuesta que necesitan
  resolver `/proc/<pid>/exe`. La herramienta staticcheck también se bloquea
  al intentar resolver `/proc/self/exe`. No se han modificado ni saltado
  esas pruebas para aparentar una ejecución completa correcta.
- No hay runtime Windows/Rust ni Chromium operativo disponible. La
  compilación cruzada del motor no sustituye una ejecución Windows.
  El DOM no certifica layout, fuentes, capturas ni interacción en un navegador.

Los assets de captura anteriores se conservan con una referencia honesta
en el README. Se deben actualizar cuando pueda ejecutarse el stack completo.
El adaptador Node es una comprobación adicional, no reemplaza a Bun en CI.

## Siguientes mejoras, en orden

| Prioridad | Trabajo | Criterio de cierre |
|-----------|---------|--------------------|
| 1 | Confirmar CI de esta rama, build Next.js y smoke Windows; actualizar capturas | Batería nativa completa y pantallas reales revisadas en escritorio/móvil |
| 2 | Entregado en la [segunda ronda](REVISION-HISTORICO.md): filtros de ciclo de vida y paginación | Histórico del motor con cursores, límites y fuente visibles |
| 3 | Paleta de comandos y ayuda de teclado en la web | Acciones localizables, foco gestionado y accesibilidad verificable |
| 4 | Estado completo de detectores y avisos en la TUI | Metadatos también actualizados tras reload; logs de fondo integrados sin perturbar la pantalla |
| 5 | Pruebas reales de navegador en CI | Deep links, historial, triaje, recuperación, móvil y reduced motion |
| 6 | Ampliar sensor ETW y sus fixtures Windows | Cobertura documentada por proveedor y pruebas de eventos reales |

Esta ronda revisa los flujos citados y usa la batería disponible del proyecto.
No es una certificación exhaustiva de todo el código, dependencias, despliegue
o seguridad de producción.

## Aplicar el parche en otra copia

El parche parte del commit indicado al principio. En una copia compatible:

```bash
git switch -c mejora-cli-dashboard
git apply --check /ruta/security-framework-mejoras.patch
git apply /ruta/security-framework-mejoras.patch
```

Si main ha cambiado los mismos ficheros, el `--check` lo indica antes de
aplicar; rebase o revisa los conflictos sobre una rama propia.
La alternativa es descomprimir el proyecto completo, instalar las
dependencias con Bun y seguir la [guía de inicio](GUIA-INICIO.md).

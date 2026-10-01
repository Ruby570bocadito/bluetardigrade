# Segunda ronda: investigación y triaje histórico

**Actualización del 1 de octubre de 2026:** la entrega ya está publicada en
el [PR #4](https://github.com/Ruby570bocadito/security-framework/pull/4), con
los cuatro jobs de CI correctos sobre `4b153af`. El
[registro completo](RESUMEN-MEJORAS-2026-10-01.md) reúne ambas rondas y la
evidencia remota que resuelve las verificaciones pendientes del entorno local.
El resto del informe conserva los resultados de esta segunda ronda.

Parte de `68b8bc2`, la primera entrega, desarrollada en una rama local
de trabajo. El proyecto completo v2 incluye ambas rondas.
La rama de integración para GitHub se preparó sobre `c0aec2d` conservando
los cambios nuevos de TLS del sensor
y la separación del motor en flags/runtime.

## Cambios entregados

- Cola con modos **En vivo** e **Histórico**. El primero mantiene el
  búfer del navegador; el segundo consulta el motor.
- Filtros de todas, sin cerrar, nuevas, reconocidas y cerradas, combinados
  con severidad y texto de detección. Fuente y filtros sobreviven en la URL.
- Páginas de 25 alertas, Anterior/Siguiente y actualización explícita.
  Las páginas se ordenan por recepción, con cursores que fijan la secuencia
  superior. Una llegada posterior no desplaza páginas ya visitadas.
- Fuente visible: SQLite con retención configurada o últimas 256 alertas
  en memoria. No se presenta el tamaño de página como total histórico.
- Triaje sobre alertas fuera del búfer vivo. La respuesta correcta del
  POST actualiza la interfaz incluso si SSE está reconectando.
- Consultas obsoletas canceladas y descartadas, error de capacidad en
  motores antiguos y aviso explícito cuando la búsqueda debe continuar.

## Errores y límites de interfaz corregidos

| Antes | Ahora |
|-------|-------|
| La búsqueda solo veía las últimas 128 alertas del navegador | El histórico consulta el motor y, con SQLite, registros fuera del anillo |
| No había filtro por ciclo de vida | Estado filtrado en el motor antes del límite de página |
| Una alerta `info` se convertía en `low` | Tipo, badge, filtro y contador conservan `info` |
| Cola offline con skeleton permanente | Estado explícito de datos no disponibles |
| La clave visual de motores antiguos no incluía timestamp | Identidad compartida con el provider; re-alertas posteriores no colisionan |
| El detalle solo esperaba el frame SSE después del POST | Usa también el acuse válido del motor |
| Varias decisiones podían quedar reducidas a la última en un render | Búfer de actualizaciones por identidad para filas históricas |
| Un estado antiguo podía revertir un cierre reciente | Se compara `status_at` antes de aplicar un frame/acuse |
| Exportaciones junto al filtro podían parecer completas y filtradas | Tooltips explican límites por defecto y ausencia del filtro de vista |

## Contrato y límites

`GET /api/alerts/search` devuelve `items`, `source`, `has_more`,
`next_cursor`, `page_cursor`, `scanned` y `scan_limited`.
Admite `limit` de 1 a 100 (por defecto 25), estado, severidad, regla,
host, texto y ventana temporal. El OpenAPI documenta el contrato completo.
Los listados y exports existentes conservan su formato y orden anterior.

Los cursores son posiciones de lectura, no credenciales. Están asociados
a una fuente, consulta y ejecución del motor. Un reinicio o cambio de
filtros requiere reiniciar la búsqueda; responde 400 si se reutiliza una
posición incompatible. Los límites temporales relativos se fijan en la
primera página. `page_cursor` permite volver a la misma página sin incluir
nuevas inserciones.

El límite de trabajo de aplicación es 5000 candidatos de evidencia por
petición. El filtro de ciclo de vida se aplica después del filtro de
evidencia y antes de reunir la página. En búsquedas poco frecuentes una
página vacía puede tener `scan_limited=true` y un cursor de continuación:
**Seguir buscando** examina lo que queda; no promete otro resultado.
También hay un presupuesto temporal de cuatro segundos, cancelación
propagada a SQLite y respuesta 504 si vence. El índice SQL puede examinar
más filas físicas al evaluar un filtro de texto; `scanned` cuenta los
candidatos que la aplicación recibió, no trabajo interno de SQLite.

La retención, expulsión del anillo y nuevas decisiones de triaje pueden
cambiar la pertenencia de una fila. Las páginas no son una transacción
inmutable ni un histórico ilimitado. El almacén de ciclo de vida existente
conserva su límite independiente de 10.000 entradas; esta ronda no migra
ese estado a SQLite. Los filtros y el modo van en la URL, mientras que la
pila de páginas vive en la vista y se reinicia al recargar.

`q` del histórico busca evidencia de detección, como regla, host, usuario,
resumen, mensaje y tags. Las notas de triaje siguen siendo una búsqueda
de la vista en vivo. Los exports mantienen sus límites por defecto de
256 alertas o 1000 eventos y no aplican los filtros de la pantalla.

## Verificación

| Comprobación | Resultado |
|--------------|-----------|
| Tests nuevos de búsqueda API y páginas SQLite con `-race` | Correctos |
| Regresiones de filtros/export y CLI seleccionadas con `-race` | Correctas |
| Batería completa de `internal/store` con `-race` | Correcta |
| Build y vet de Go; compilación cruzada Windows | Correctos |
| TypeScript de la consola | Correcto |
| Motor + devsensor + SQLite + API paginada + POST reales | 19 eventos, 18 alertas, dos páginas sin duplicados y un resultado cerrado |
| Batería de consola con adaptador temporal Node | 84/84; no ejecución nativa Bun |
| Harness DOM con provider/dashboard/cola reales y fixtures REST/SSE | 18/18 en React StrictMode |
| OpenAPI y autopruebas del guard | 16 rutas, 36 campos Stats, 82 referencias; 13 variantes negativas |

Las pruebas API cubren memoria/SQLite, timestamps empatados, llegada tardía,
retroceso con página fijada, filtros antes de límite, rechazo de cursores
incompatibles, autenticación, ventana relativa fija y continuación tras
5000 candidatos. El caso persistente recupera una alerta fuera del anillo.
La prueba de SQLite verifica también cancelación del contexto.

El DOM cubre búsqueda sustituida, navegación hacia atrás, triaje por POST
sin SSE, restauración de estado por URL, decisiones agrupadas, límite de
memoria y motor antiguo, además de los flujos de la primera ronda.
No certifica layout ni sustituye una prueba real de navegador.

`next build` se volvió a ejecutar y falla con
`ENOENT: uv_resident_set_memory` en este entorno. La batería nativa Bun,
CI completa, navegador real, Rust y ejecución Windows siguen pendientes
según los límites del [primer informe](REVISION-CLI-DASHBOARD.md).

## Aplicación y próximas mejoras

El parche `security-framework-historico.patch` se aplica **sobre la primera
entrega** (`68b8bc2`):

```bash
git switch -c mejora-historico-triaje
git apply --check /ruta/security-framework-historico.patch
git apply /ruta/security-framework-historico.patch
```

El ZIP v2 contiene el proyecto completo. La publicación remota requiere acceso de escritura al repositorio de GitHub.

Siguientes pasos: CI y capturas reales, paleta de comandos accesible,
investigaciones guardadas, persistencia de lifecycle en SQLite y estado
completo de detectores en la TUI. El alcance sigue siendo una mejora
concreta de operación, no una auditoría exhaustiva de seguridad.

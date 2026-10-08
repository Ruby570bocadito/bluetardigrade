# Detecciones de ficheros y evidencia forense

Actualización: 2026-10-01. Esta entrega parte de `444473d`, conserva el
renombrado a **bluetardigrade** y amplía la capa de detección y forense.
El inventario cargado asciende a **114 reglas habilitadas**: 25 critical,
55 high, 28 medium, 3 low y 3 info, repartidas en doce tipos de evento.
Las trece secuencias existentes (4 de kill-chain, 2 laterales y 7 de
campaña) permanecen disponibles.

## Alarmas nuevas

El paquete [file-staging.yaml](../rules/windows/file-staging.yaml) requiere
eventos `file.write`, como los producidos por Sysmon 11 a través de
`sf-sensor`. Usa `file.path` y el proceso escritor; no depende del campo
opcional `file.extension`. Los nombres y las rutas se comparan sin
distinción de mayúsculas.

| Alarma | Nivel | Señal | Caso que debe permanecer silencioso |
|--------|-------|-------|-------------------------------------|
| Office escribe un payload | high | Office escribe ejecutables, scripts o DLL en AppData, Public, Downloads, Desktop o temporales | Guardar un documento `.docx` |
| Intérprete escribe una DLL | high | PowerShell, WScript, CScript o mshta escriben una DLL en AppData, Public o temporales | Escribir datos JSON o una DLL fuera de esas rutas |
| DLL candidata a carga lateral | medium | Navegador/descompresor escribe nombres como `version.dll` o `winmm.dll` en rutas de usuario | Otra DLL o una ubicación instalada en Program Files |
| Modificación de perfil PowerShell | medium | Escritura de perfiles en ubicaciones estándar de usuario/sistema | Un `profile.ps1` en `C:\Ops` o una copia `.bak` |
| Contenido activo al iniciar Office | high | Plantillas Word o libros/complementos activos Excel en STARTUP/XLSTART | Documento ordinario o directorio `XLSTART-backup` |
| Posible volcado LSASS en disco | high | Escritor capaz de volcar memoria crea un nombre `lsass*.dmp` | Un volcado de `notepad` o un documento `.dmp.txt` |

Las reglas describen señales para investigación. Un nombre de DLL no
demuestra carga lateral; un nombre de volcado no prueba su contenido.
Perfiles personalizados, complementos aprobados y paquetes legítimos
pueden coincidir. El pack tiene pruebas de gemelos benignos, pero su ruido
debe medirse con telemetría real de tu entorno Windows. Las ubicaciones
personalizadas fuera de las rutas cubiertas requieren reglas locales.

Las acciones nuevas son `alert`. Las notificaciones siguen la configuración
del motor y los umbrales de cada canal; no se arma respuesta activa al
instalar este pack. Para cambios conocidos, usa supresiones por ID de regla
y host con motivo y vencimiento, según [false-positive-control.md](false-positive-control.md).

La regla existente de la carpeta Inicio mantiene su ID, usa la extensión
del nombre real y corrige su etiqueta a **T1547.001**. Un campo `extension`
vacío, con punto inicial o contradictorio ya no oculta un `.exe`/`.lnk`.

## Contexto de procesos más fiable

- Eventos de fichero, red o registro que llevan solo PID conservan la
  identidad conocida; antes podían borrar el nombre de un padre Office
  y silenciar su alarma de creación de intérprete.
- Un `process.create` reinicia la identidad del PID. Un evento con una
  identidad incompatible no mezcla su nombre con la imagen anterior.
- El lookup del padre verifica los 30 minutos de TTL sin esperar al
  barrido. No se atribuye un proceso a sí mismo ni a un padre creado
  después de la fecha del evento.
- Cuando hay fechas, un evento retrasado de una encarnación anterior
  del PID no sustituye ni termina el proceso más reciente.
- Los seis campos derivados de usuario, imagen y padre se limpian y
  recalculan. Los datos recibidos no pueden imponer esos campos al motor;
  el evento bruto y otros campos de enriquecimiento se conservan.
- PID inválido, host vacío o identidad desconocida no consumen slots.

El seguimiento sigue siendo acotado por host y proceso. Es contexto de
telemetría, no una prueba de identidad criptográfica del proceso: sin
fechas o GUID de proceso no puede resolver todas las ambigüedades de
reutilización de PID y orden de llegada.

## Validación YAML

El guard compartido por los cargadores ahora comprueba el grafo de nodos
con una pila explícita. Detecta ciclos antes de la decodificación tipada,
cuenta referencias una sola vez y corta el cálculo de expansión antes
de desbordar su presupuesto. También mide la profundidad flow del grafo;
corchetes de cierre dentro de cadenas ya no pueden ocultarla al pre-scan.

Se mantienen los límites de 32 referencias, 100.000 nodos proyectados y
512 niveles flow, además de los límites de fichero de cada cargador.
Anclas legítimas pequeñas siguen admitidas; los errores de sintaxis
continúan a cargo del decodificador del cargador. El pre-scan bruto
conserva su comportamiento conservador con corchetes en literales.

## Evidencia y dashboard

Abre **Alertas**, selecciona una alerta y despliega **Línea de tiempo
forense**. La consulta se hace al abrir; la captura ya fue guardada por
el motor cuando detectó la alerta. `Reintentar evidencia` repite una
consulta fallida, y cerrar/abrir un panel fallido también la repite.
Seleccionar otra alerta descarta el resultado anterior, incluso cuando
su respuesta llega tarde.

El cliente valida ID, estructura, resumen y eventos antes de renderizar.
Admite colecciones vacías `null` de capturas antiguas normalizándolas a
arrays. Las nuevas capturas usan `[]`. Los errores de consulta y las
respuestas incompatibles muestran un estado recuperable.

| Respuesta del motor | Comportamiento |
|--------------------|----------------|
| `200` válido | Timeline y botones JSON/JSONL |
| `404` | No hay captura conservada para esa alerta |
| `501` | Captura forense desactivada |
| Error de transporte, autorización o evidencia incompatible | Estado de error y reintento |

Cada descarga conserva la alerta completa, metadatos, hashes,
enriquecimiento y eventos recibidos; no aplica el filtro de la vista.
El nombre es `forensic-<alert-id>.json` o `.jsonl`.

- **JSON**: documento completo de la captura.
- **JSONL v1**: primera línea `{record_type: "forensic.bundle", version: 1,
  bundle: <metadatos y alerta>}`; después una línea
  `{record_type: "forensic.event", event: <evento completo>}` por evento.
  Con cero eventos se conserva la primera línea. El JSON escapa saltos
  de línea dentro de los campos.

La captura contiene hasta cinco minutos anteriores a la alerta y su
evento disparador cuando sigue registrado, con un máximo de 200 eventos
seleccionados de un recorder de 256 por host. Un evento ajeno con fecha
posterior queda fuera. El recorte conserva el disparador y la cola más
reciente; no equivale a todo el histórico del equipo. La retención en
disco sigue siendo de 256 bundles y la captura aplica a high/critical.

El directorio predeterminado `forensics/` queda ignorado por Git. Si
eliges otro con `-forensic-dir`, mantén ese estado operativo fuera del
código versionado.

## Documentación verificable

[OPERATIONS.md](OPERATIONS.md) muestra el inventario completo generado
desde los YAML, con UUID enteros porque los nuevos packs comparten
prefijos. El guard de CI detecta IDs duplicados e inventario desactualizado.
README, guía de inicio y roadmap reflejan Go 1.26 y las entregas actuales.

```bash
python3 scripts/dev-tests/check_rule_inventory.py --write
python3 scripts/dev-tests/check_rule_inventory.py
go run ./cmd/engine validate
```

## Pruebas y límites de la verificación

Las pruebas Go cubren positivos/negativos del pack, aislamiento por tipo
de evento, Startup sin metadatos de extensión, supervivencia de la alarma
Office tras telemetría parcial, PID/TTL, ciclos y límites YAML, ventanas
forenses y conservación del disparador.

El smoke `smoke_file_forensics.py` envía once registros ficticios por TCP
autenticado a un motor real: comprueba ocho alertas, ausencia de la alarma
para un documento ordinario y seis bundles protegidos por el bearer de API.
La respuesta activa y los sinks externos permanecen desarmados. Se ejecuta
en CI y `make ci`, y también pasó en el workspace.
La prueba espera las alertas publicadas: `events_total` se actualiza antes
de que terminen la evaluación y la captura de evidencia.

En esta entrega de detección el cliente tenía **131 pruebas** y el fixture
DOM **23 comprobaciones**,
incluidas carga perezosa, reintento, cambio de alerta, respuesta tardía y
descarga con todos los campos. El runner Chromium tenía **13 casos** de
escritorio/móvil y comprueba descargas reales JSON/JSONL. Los datos de
estos fixtures están aislados; no son capturas de un laboratorio Windows.
La ampliación posterior a 153/27/17 y sus nuevos casos se documenta en
[Investigaciones guardadas y analista](INVESTIGACIONES-GUARDADAS-Y-ANALISTA.md).

```bash
go test -race -count=1 ./...
go build ./...
go vet ./...
staticcheck -checks 'all,-ST1000' ./...
staticcheck -checks 'ST1000,ST1020,ST1021,ST1022' ./...
python3 scripts/dev-tests/check_openapi.py
python3 scripts/dev-tests/check_openapi.py --self-test
go build -o bin/engine-file-smoke ./cmd/engine
python3 scripts/dev-tests/smoke_file_forensics.py --engine ./bin/engine-file-smoke
cd web/console && bun test && bun run typecheck && bun run build
```

En el workspace restringido, las pruebas de los paquetes modificados,
build/vet, tipos y el adaptador Node del cliente pasan. Las pruebas de
respuesta activa que consultan `/proc/<pid>/exe`, staticcheck y el build/
navegador nativos requieren un entorno con esas capacidades; CI ejecuta
los comprobadores completos, incluido el smoke conductual de Windows.
Las nuevas alarmas siguen pendientes de validación y ajuste con eventos
reales del laboratorio Windows, como recoge [ROADMAP.md](ROADMAP.md).

Referencias de las señales: [Startup](https://attack.mitre.org/techniques/T1547/001/),
[DLL](https://attack.mitre.org/techniques/T1574/001/),
[Office](https://attack.mitre.org/techniques/T1137/),
[perfil PowerShell](https://attack.mitre.org/detectionstrategies/DET0451/),
[ubicaciones de perfiles](https://learn.microsoft.com/es-es/powershell/module/microsoft.powershell.core/about/about_profiles?view=powershell-7.6)
y [XLSTART](https://learn.microsoft.com/en-us/troubleshoot/microsoft-365-apps/excel/files-open-automatically).

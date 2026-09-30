# Inicio rápido

Ejecuta estos pasos desde la raíz del repositorio. La demo usa eventos
simulados identificados como `sf-devsensor`; para datos reales de Windows
sigue la [guía de Sysmon](OPERATIONS.md#real-telemetry-with-sysmon-recommended).

## Compilar y validar

Necesitas Go 1.22+. En Linux/macOS o una terminal con `make`:

```bash
git clone https://github.com/Ruby570bocadito/security-framework.git
cd security-framework
make build
./bin/engine validate
```

En Windows puedes compilar directamente:

```powershell
go build -o bin/engine.exe ./cmd/engine
go build -o bin/devsensor.exe ./cmd/devsensor
.\bin\engine.exe validate
```

La [instalación de Windows](OPERATIONS.md#one-command-install-windows)
también incluye comandos `sf-*` y herramientas de Sysmon.

## CLI interactiva

Abre `./bin/engine run -i` —en Windows, `.\bin\engine.exe run -i`— y en
otra terminal ejecuta `./bin/devsensor -addr 127.0.0.1:7777`
o `.\bin\devsensor.exe -addr 127.0.0.1:7777`.

| Tecla | Uso |
|-------|-----|
| `1` / `2` / `Tab` | Alertas / reglas |
| `↑↓`, `j/k` | Seleccionar; desplazar detalle |
| `Enter` | Ver detalle |
| `/` | Buscar por regla, host, usuario, resumen o tag |
| `s` | Cambiar severidad |
| `p` / `Espacio` | Pausar únicamente la pantalla |
| `Esc` | Volver; limpiar filtros |
| `?` | Consultar ayuda |
| `q` / `Ctrl+C` | Apagar el motor |

El panel conserva las últimas 100 alertas. Al pausar continúan detección,
API y entregas; al reanudar ves el estado actual. Para guardar histórico,
inicia con `-store ./sf-store.db`: [persistencia](OPERATIONS.md#persistent-storage-sqlite-opt-in).

## Dashboard

Necesitas Bun. Mantén el motor encendido y abre otra terminal:

```bash
cd web/console
bun install --frozen-lockfile
bun run dev
```

Abre [localhost:3000](http://localhost:3000). El panel reúne críticas sin
cerrar, estado operativo, indicadores, hosts con riesgo y actividad.
Puedes actualizar manualmente y saltar a alertas o telemetría.
Los recuentos de triaje y el gráfico son muestras del búfer; los totales
del motor se muestran por separado. `—` indica que falta una lectura.

El analista IA es opcional. En otra terminal, desde la raíz:

```bash
cd web/console-service
bun install --frozen-lockfile
bun run dev
```

Configura el modelo siguiendo el [README de la consola](../web/console/README.md).
La telemetría y el triaje funcionan sin el hub.

## Conexión y problemas habituales

Copia [`web/console/.env.example`](../web/console/.env.example) a
`web/console/.env.local` cuando necesites cambiar los valores por defecto.
`ENGINE_API_URL` y `SF_API_TOKEN` se usan en el servidor. Los tokens
deben quedarse allí: las variables `NEXT_PUBLIC_*` llegan al navegador.

| Síntoma | Qué comprobar |
|---------|---------------|
| Motor offline | Motor encendido, API en 7778 y `ENGINE_API_URL` correcto |
| Error 401 | `SF_API_TOKEN` coincide con `-api-token`; reinicia Next.js tras cambiarlo |
| Error 403 | Hostname loopback o autorizado en `CONSOLE_ALLOWED_HOSTS` |
| CLI sin alertas | Sensor enviando datos; búsqueda y severidad sin filtros que los oculten |
| `-i` usa salida plana | La salida necesita un terminal; la redirección activa el modo plano |
| Analista desconectado | Hub de 3003 encendido y modelo configurado |
| Reglas no encontradas | Ejecutar desde la raíz o pasar `-rules` / `-sequences` explícitos |

## Verificar cambios

`make test` ejecuta los tests de Go. `make ci` ejecuta la batería completa
con los requisitos del Makefile: staticcheck, Bun, Rust y Python con PyYAML.
La inspección de procesos requiere un sistema compatible y ETW requiere Windows.

[README](../README.md) · [Revisión y siguientes mejoras](REVISION-CLI-DASHBOARD.md)

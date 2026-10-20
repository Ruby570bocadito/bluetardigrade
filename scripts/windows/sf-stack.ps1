# ======================================================================
# bluetardigrade stack: engine, hub, console and the ETW sensor together
#
#   sf-start                start everything, then open the browser
#   sf-start -NoBrowser     ... without opening the browser
#   sf-start -NoSensor      leave the ETW sensor service as it is
#   sf-stop                 stop the sensor first, then engine, hub, console
#   sf-stop -KeepSensor     keep the sensor capturing while the engine is
#                           off (it queues events and replays them on the
#                           next start)
#   sf-status               what is running
#
# sf-console (engine + hub + console) and sf-etw (the sensor service) keep
# working on their own; this script only orders them. The sensor is a
# Windows service: starting or stopping it needs administrator rights, so
# those two steps show one UAC prompt (sf-etw relaunches itself elevated)
# and are skipped when there is nothing to change.
# ======================================================================
param(
    [switch]$Start,
    [switch]$Stop,
    [switch]$Status,
    [switch]$NoBrowser,
    [switch]$NoSensor,
    [switch]$KeepSensor,
    [int]$ConsolePort = 3000,
    [int]$ServicePort = 3003
)

$ErrorActionPreference = 'Continue'
$ServiceName = 'bluetardigrade-sensor'
$consolePs1 = Join-Path $PSScriptRoot 'sf-console.ps1'
$etwPs1 = Join-Path $PSScriptRoot 'sensor-service.ps1'
$ports = @{ ConsolePort = $ConsolePort; ServicePort = $ServicePort }

function Get-SfSensorService {
    return Get-Service $ServiceName -ErrorAction SilentlyContinue
}

if ($Start) {
    # engine first: a sensor that starts before it only waits and queues
    & $consolePs1 -NoBrowser -StopHint 'sf-stop' @ports
    if (-not $NoSensor) {
        $svc = Get-SfSensorService
        if (-not $svc) {
            Write-Host '  sensor not installed as a service (install it once: sf-etw -Install)'
        } elseif ($svc.Status -eq 'Running') {
            Write-Host '  sensor already running'
        } else {
            Write-Host '  starting the sensor service (one UAC prompt)'
            & $etwPs1 -Start
        }
    }
    if (-not $NoBrowser) { Start-Process "http://localhost:$ConsolePort" }
    return
}

if ($Stop) {
    # sensor first: while the engine is still up it delivers what it holds
    # instead of queueing it for a replay at the next start
    if (-not $KeepSensor) {
        $svc = Get-SfSensorService
        if ($svc -and $svc.Status -ne 'Stopped') {
            Write-Host '  stopping the sensor service (one UAC prompt)'
            & $etwPs1 -Stop
        }
    }
    & $consolePs1 -Stop @ports
    $svc = Get-SfSensorService
    if ($KeepSensor -and $svc -and $svc.Status -eq 'Running') {
        Write-Host '  the sensor keeps capturing: its queue is replayed on the next sf-start'
    }
    return
}

# default: status
& $consolePs1 -Status @ports
& $etwPs1

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
#
# While the console has no accounts, sf-start offers to create the
# administrator account (sf-console -AddUser) so the console asks to sign
# in. Declining is remembered in tools\config\no-console-accounts.
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

# Only from an interactive sf-start: the logon autostart runs sf-console
# hidden, where a question would wait forever.
function Request-FirstAccount {
    $root = Split-Path -Parent $PSScriptRoot
    if (-not (Test-Path (Join-Path $root 'web'))) { $root = Split-Path -Parent $root }
    $config = Join-Path $root 'tools\config'
    $declined = Join-Path $config 'no-console-accounts'
    if ((Test-Path -LiteralPath (Join-Path $config 'console-users.json')) -or (Test-Path -LiteralPath $declined)) { return }
    if ($env:CONSOLE_ACCESS_TOKEN -or -not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { return }
    Write-Host '  the console has no accounts: anyone using this machine opens it without signing in'
    $answer = Read-Host '  create the administrator account now? [Y/n]'
    if ($answer -match '^\s*(n|no)\s*$') {
        New-Item -ItemType Directory -Path $config -Force | Out-Null
        New-Item -ItemType File -Path $declined -Force | Out-Null
        Write-Host '  not asking again; add one any time: sf-console -AddUser <name>'
        return
    }
    # the account name rules of the console (letters, digits, . _ @ -)
    $suggested = if ($env:USERNAME -match '^[\p{L}\p{N}._@-]{1,64}$') { $env:USERNAME } else { '' }
    for ($try = 1; $try -le 3; $try++) {
        $name = Read-Host "  account name [$suggested]"
        if (-not $name) { $name = $suggested }
        if ($name -notmatch '^[\p{L}\p{N}._@-]{1,64}$') {
            Write-Host '  use letters, digits and . _ @ - (no spaces)'
            continue
        }
        & $consolePs1 -AddUser $name -Role admin
        if ($LASTEXITCODE -eq 0) { return }
    }
    Write-Host '  no account created; the console opens without signing in (sf-console -AddUser <name>)' -ForegroundColor Yellow
}

if ($Start) {
    Request-FirstAccount
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

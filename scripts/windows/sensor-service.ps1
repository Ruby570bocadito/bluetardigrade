# sf-etw: the ETW sensor as a Windows service.
#
#   sf-etw                      status (same as -Status)
#   sf-etw -Install [-Addr host:port] [-Token <t>] [-TlsCa <ca.pem>]
#   sf-etw -Install -Addr host:port -EnrollToken <btenroll_...> [-TlsCa <ca.pem>]
#   sf-etw -Start | -Stop | -Restart
#   sf-etw -Uninstall [-Purge]
#
# Kernel ETW needs administrator rights. -Install asks for them once
# (UAC) and registers the 'bluetardigrade-sensor' service, which runs as
# SYSTEM, starts with Windows and restarts itself if it fails; after that
# no elevated window is needed. Run it from a normal PowerShell: the
# commands that change the service relaunch themselves elevated.
#
# The binary is copied to Program Files: a SYSTEM service must never run a
# file the user can replace (the install folder under %LOCALAPPDATA% is
# user-writable). Its data (spool, log, ingest token, CA) lives in
# ProgramData\bluetardigrade\sensor, readable only by SYSTEM and
# Administrators. The token is read from a file there, so it never shows
# in the service's command line. -Install again updates the binary and
# the settings in place.
#
# -EnrollToken joins the fleet with a token from the console (Equipos >
# Anadir equipos) instead of a shared token: on its first start the
# service trades it for a credential of its own (kept in ingest.token)
# and deletes it; the host then waits in the console until an
# administrator approves it. Updating later without -EnrollToken keeps
# that credential.

[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Status,
    [switch]$Start,
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Purge,
    [string]$Addr = '127.0.0.1:7777',
    [string]$Token = '',
    [string]$TokenFile = '',
    [string]$TlsCa = '',
    [string]$EnrollToken = '',
    [string]$EnrollTokenFile = '',
    # set by the relaunch: keep the elevated window open on a failure
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'bluetardigrade-sensor'
$ProgramDir = Join-Path $env:ProgramFiles 'bluetardigrade\sensor'
$DataDir = Join-Path $env:ProgramData 'bluetardigrade\sensor'
$SensorExe = Join-Path $ProgramDir 'security-sensor.exe'

# install root: installed copy lives at <root>\scripts\, the repo copy at
# <root>\scripts\windows\
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'bin'))) { $root = Split-Path -Parent $root }
. (Join-Path $PSScriptRoot 'runtime.ps1')

function Test-SfAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Relaunches this script elevated (one UAC prompt) with the same request
# and waits for it. A token given on the command line travels in a
# user-only temp file, never in the elevated process's arguments.
function Invoke-SfElevated {
    param([string[]]$Arguments)
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"") + $Arguments + @('-Elevated')
    if ($Token) {
        $tmp = Join-Path $env:TEMP ('sf-etw-token-' + [Guid]::NewGuid().ToString('N') + '.txt')
        [IO.File]::WriteAllText($tmp, $Token, [Text.Encoding]::ASCII)
        $argList += @('-TokenFile', "`"$tmp`"")
    }
    if ($EnrollToken) {
        $tmpEnroll = Join-Path $env:TEMP ('sf-etw-enroll-' + [Guid]::NewGuid().ToString('N') + '.txt')
        [IO.File]::WriteAllText($tmpEnroll, $EnrollToken, [Text.Encoding]::ASCII)
        $argList += @('-EnrollTokenFile', "`"$tmpEnroll`"")
    }
    Write-Host '  Windows will ask for administrator permission (UAC) for this step.'
    try {
        $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -Wait -PassThru
    } catch {
        throw 'Administrator permission was not granted; nothing was changed.'
    } finally {
        if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force }
        if ($tmpEnroll -and (Test-Path -LiteralPath $tmpEnroll)) { Remove-Item -LiteralPath $tmpEnroll -Force }
    }
    if ($p.ExitCode -ne 0) { throw "the elevated step failed (exit $($p.ExitCode)); its window showed the reason" }
}

function Wait-SfServiceState {
    param([string]$State, [int]$Seconds = 20)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
        if ($State -eq 'Gone' -and -not $svc) { return $true }
        if ($svc -and $svc.Status.ToString() -eq $State) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Show-SfLogTail {
    $log = Join-Path $DataDir 'sensor.log'
    if (-not (Test-Path -LiteralPath $log)) { return }
    try {
        $lines = Get-Content -LiteralPath $log -Tail 8 -ErrorAction Stop
        Write-Host '  last lines of the sensor log:'
        $lines | ForEach-Object { Write-Host "    $_" }
    } catch {
        Write-Host "  (the log at $log is readable by administrators only)"
    }
}

function Install-SfSensorService {
    $source = Join-Path $root 'bin\security-sensor.exe'
    if (-not (Test-Path -LiteralPath $source)) {
        throw 'bin\security-sensor.exe was not found: install or update bluetardigrade with the sensor first.'
    }
    # a sensor started by hand holds the same ETW sessions
    $manual = @(Get-Process security-sensor -ErrorAction SilentlyContinue | Where-Object { $_.Path -and -not $_.Path.StartsWith($ProgramDir, [StringComparison]::OrdinalIgnoreCase) })
    foreach ($p in $manual) {
        Write-Host "  stopping the sensor started by hand (pid $($p.Id)): the service replaces it"
        Stop-Process -Id $p.Id -Force
    }
    $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Stopped') {
        Stop-Service $ServiceName -Force
        [void](Wait-SfServiceState 'Stopped' 30)
    }

    New-Item -ItemType Directory -Force -Path $ProgramDir, $DataDir | Out-Null
    Copy-Item -LiteralPath $source -Destination $SensorExe -Force
    # SYSTEM and Administrators only (by SID: group names are localized)
    & icacls.exe $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not restrict the permissions of $DataDir" }

    $tokenPath = Join-Path $DataDir 'ingest.token'
    $enrollPath = Join-Path $DataDir 'enroll.token'
    $value = $Token
    if (-not $value -and $TokenFile) {
        $value = ([string](Get-Content -LiteralPath $TokenFile -First 1)).Trim()
    }
    $enrollValue = $EnrollToken
    if (-not $enrollValue -and $EnrollTokenFile) {
        $enrollValue = ([string](Get-Content -LiteralPath $EnrollTokenFile -First 1)).Trim()
    }
    $current = ''
    if (Test-Path -LiteralPath $tokenPath) { $current = ([string](Get-Content -LiteralPath $tokenPath -First 1)).Trim() }
    if ($enrollValue) {
        if (-not $enrollValue.StartsWith('btenroll_')) {
            throw 'an enrollment token starts with btenroll_: copy it from the console (Equipos > Anadir equipos)'
        }
        # enrolling (again): the service obtains a new credential on its first start
        if (Test-Path -LiteralPath $tokenPath) { Remove-Item -LiteralPath $tokenPath -Force }
        [IO.File]::WriteAllText($enrollPath, $enrollValue, [Text.Encoding]::ASCII)
    } elseif ($value) {
        [IO.File]::WriteAllText($tokenPath, $value, [Text.Encoding]::ASCII)
        if (Test-Path -LiteralPath $enrollPath) { Remove-Item -LiteralPath $enrollPath -Force }
    } elseif ($current.StartsWith('btsensor_') -or (Test-Path -LiteralPath $enrollPath)) {
        # an enrolled sensor keeps its own credential (or its pending enrollment) across updates
    } else {
        $value = Get-SfSetting $root 'SF_INGEST_TOKEN' 'ingest.token'
        if ($value) {
            [IO.File]::WriteAllText($tokenPath, $value, [Text.Encoding]::ASCII)
        } elseif (Test-Path -LiteralPath $tokenPath) {
            Remove-Item -LiteralPath $tokenPath -Force
        }
    }
    $enrolling = Test-Path -LiteralPath $enrollPath
    $caPath = Join-Path $DataDir 'ingest-ca.pem'
    if ($TlsCa) { Copy-Item -LiteralPath $TlsCa -Destination $caPath -Force }

    $arguments = "--service --addr $Addr --spool `"$DataDir\spool.ndjson`" --log `"$DataDir\sensor.log`""
    if ($enrolling -or (Test-Path -LiteralPath $tokenPath)) { $arguments += " --token-file `"$tokenPath`"" }
    if ($enrolling) { $arguments += " --enroll-token-file `"$enrollPath`"" }
    if (Test-Path -LiteralPath $caPath) { $arguments += " --tls-ca `"$caPath`"" }
    $binPath = "`"$SensorExe`" $arguments"

    if ($svc) {
        # the service key holds the command line; no quoting through sc.exe
        Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name ImagePath -Value $binPath
        Set-Service -Name $ServiceName -StartupType Automatic
    } else {
        New-Service -Name $ServiceName -BinaryPathName $binPath -DisplayName 'bluetardigrade sensor (ETW)' `
            -Description 'Telemetria de procesos, red, DNS y registro para el motor bluetardigrade. Solo envia datos; no recibe ordenes.' `
            -StartupType Automatic | Out-Null
    }
    # restart after 5 s, 10 s, then every minute; the failure count resets daily
    & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/60000 | Out-Null
    Start-Service $ServiceName
    if (-not (Wait-SfServiceState 'Running' 20)) { throw 'the service did not reach Running; see the log below' }
    Write-Host "  [ok] service $ServiceName running (starts with Windows, restarts if it fails)"
    $auth = 'none'
    if ($enrolling) {
        $auth = 'enrolling (the host then waits for approval in Equipos)'
    } elseif ($current.StartsWith('btsensor_') -and -not $value) {
        $auth = 'its own credential (enrolled)'
    } elseif (Test-Path -LiteralPath $tokenPath) {
        $auth = 'from ' + $tokenPath
    }
    Write-Host "  engine: $Addr   auth: $auth   TLS: $(if (Test-Path -LiteralPath $caPath) { 'verified with ' + $caPath } else { 'off' })"
}

function Uninstall-SfSensorService {
    $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -ne 'Stopped') {
            Stop-Service $ServiceName -Force
            [void](Wait-SfServiceState 'Stopped' 30)
        }
        & sc.exe delete $ServiceName | Out-Null
        [void](Wait-SfServiceState 'Gone' 15)
        Write-Host "  [ok] service $ServiceName removed"
    } else {
        Write-Host "  the service $ServiceName is not installed"
    }
    if (Test-Path -LiteralPath $ProgramDir) {
        Remove-Item -LiteralPath $ProgramDir -Recurse -Force
        $parent = Split-Path -Parent $ProgramDir
        if ((Test-Path -LiteralPath $parent) -and -not (Get-ChildItem -LiteralPath $parent -Force)) { Remove-Item -LiteralPath $parent -Force }
    }
    if ($Purge -and (Test-Path -LiteralPath $DataDir)) {
        Remove-Item -LiteralPath $DataDir -Recurse -Force
        Write-Host "  [ok] $DataDir removed (spool, log and token)"
    } elseif (Test-Path -LiteralPath $DataDir) {
        Write-Host "  kept $DataDir (spool and log); -Purge removes it"
    }
}

function Show-SfSensorStatus {
    $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Host "  the sensor is not installed as a service. Install it once with: sf-etw -Install"
        return
    }
    $startMode = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue).StartMode
    Write-Host "  service $ServiceName : $($svc.Status) (start: $startMode)"
    # what the engine sees: last heartbeat of this machine
    try {
        $apiToken = Get-SfSetting $root 'SF_API_TOKEN' 'api.token'
        $headers = @{}
        if ($apiToken) { $headers.Authorization = "Bearer $apiToken" }
        $fleet = Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:7778/api/fleet' -TimeoutSec 3
        $me = $fleet.hosts | Where-Object { $_.host -eq $env:COMPUTERNAME } | Select-Object -First 1
        if ($me -and $me.sensor) {
            Write-Host "  engine sees $($me.host): $($me.status), last heartbeat $($me.sensor.last_heartbeat), mode $($me.sensor.run_mode)"
        }
    } catch {
        Write-Host '  (the local engine did not answer; is sf-console running?)'
    }
    if (Test-SfAdmin) { Show-SfLogTail }
}

$action = if ($Install) { 'Install' } elseif ($Uninstall) { 'Uninstall' } elseif ($Start) { 'Start' } elseif ($Stop) { 'Stop' } elseif ($Restart) { 'Restart' } else { 'Status' }

if ($action -ne 'Status' -and -not (Test-SfAdmin)) {
    $forward = @("-$action")
    if ($action -eq 'Install') {
        $forward += @('-Addr', $Addr)
        if ($TlsCa) { $forward += @('-TlsCa', "`"$([IO.Path]::GetFullPath($TlsCa))`"") }
    }
    if ($Purge) { $forward += '-Purge' }
    Invoke-SfElevated $forward
    Show-SfSensorStatus
    exit 0
}

try {
    switch ($action) {
        'Install' { Install-SfSensorService; Show-SfLogTail }
        'Uninstall' { Uninstall-SfSensorService }
        'Start' { Start-Service $ServiceName; [void](Wait-SfServiceState 'Running' 20); Show-SfSensorStatus }
        'Stop' { Stop-Service $ServiceName -Force; [void](Wait-SfServiceState 'Stopped' 30); Show-SfSensorStatus }
        'Restart' { Restart-Service $ServiceName -Force; [void](Wait-SfServiceState 'Running' 20); Show-SfSensorStatus }
        default { Show-SfSensorStatus }
    }
} catch {
    Write-Host "  [!] $($_.Exception.Message)" -ForegroundColor Yellow
    Show-SfLogTail
    # an elevated window closes on exit: keep the reason on screen
    if ($Elevated) { [void](Read-Host '  Press Enter to close') }
    exit 1
} finally {
    foreach ($f in @($TokenFile, $EnrollTokenFile)) {
        if ($f -and $f.StartsWith($env:TEMP, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $f)) {
            Remove-Item -LiteralPath $f -Force
        }
    }
}

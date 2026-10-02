# ======================================================================
# security-framework console launcher (Windows)
#
#   sf-console              start hub + console, open the browser
#   sf-console -Stop        stop both
#   sf-console -Status      show what is running
#   sf-console -ConsolePort 3000 -ServicePort 3003   (custom ports)
# ======================================================================
param(
    [switch]$Stop,
    [switch]$Status,
    [switch]$NoBrowser,
    [int]$ConsolePort = 3000,
    [int]$ServicePort = 3003
)

# 'Continue' (the default the script used to override away): failures
# print in red AND the launcher keeps going to the next section. The
# old global 'SilentlyContinue' meant a failed spawn or corrupt pid
# file produced a console that "did nothing" with zero output - the
# empty-console failure mode needed three tools to diagnose.
$ErrorActionPreference = 'Continue'

# resolve install root: installed copy lives at <root>\scripts\
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'web'))) { $root = Split-Path -Parent $root }
. (Join-Path $PSScriptRoot 'runtime.ps1')
$env:SF_API_TOKEN = Get-SfSetting $root 'SF_API_TOKEN' 'api.token'

$web      = Join-Path $root 'web'
$run      = Join-Path $root 'run'
$tools    = Join-Path $root 'tools'
$bunExe   = Join-Path $tools 'bun.exe'
$nodeExe  = Join-Path $tools 'node\node.exe'
$engineExe = Join-Path $root 'bin\sf-engine.exe'
if (-not (Test-Path $engineExe)) { $engineExe = Join-Path $root 'bin\engine.exe' }
if (-not (Test-Path $bunExe))  { $bunExe  = 'bun' }
if (-not (Test-Path $nodeExe)) { $nodeExe = 'node' }

function Test-PortLocal {
    param([int]$Port)
    $c = New-Object Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $c.Close() }
}

function Wait-Port {
    param([int]$Port, [int]$Seconds)
    $i = 0
    while ($i -lt ($Seconds * 2)) {
        if (Test-PortLocal $Port) { return $true }
        Start-Sleep -Milliseconds 500
        $i++
    }
    return $false
}

function Read-PidFile {
    param([string]$Name)
    $p = Join-Path $run $Name
    if (Test-Path $p) {
        $v = Get-Content $p -ErrorAction SilentlyContinue
        if ($v -match '^\d+$') { return [int]$v }
    }
    return $null
}

function Write-PidFile {
    param([string]$Name, [int]$Value)
    New-Item -ItemType Directory -Path $run -Force | Out-Null
    Set-Content -Path (Join-Path $run $Name) -Value $Value
}

function Stop-Tracked { Stop-SfTrackedProcesses -Root $root }

if ($Status) {
    $svcPid = Read-PidFile -Name 'console-service.pid'
    $appPid = Read-PidFile -Name 'console.pid'
    $engPid = Read-PidFile -Name 'engine.pid'
    Write-Host '  security-framework console status'
    $svcState = 'stopped'
    if (Test-PortLocal $ServicePort) { $svcState = 'running' }
    if ($svcPid -and $svcState -eq 'running') { $svcState = "running (pid $svcPid)" }
    $appState = 'stopped'
    if (Test-PortLocal $ConsolePort) { $appState = 'running' }
    if ($appPid -and $appState -eq 'running') { $appState = "running (pid $appPid)" }
    Write-Host "  hub     :$ServicePort  $svcState"
    Write-Host "  console :$ConsolePort  $appState"
    if (Test-PortLocal 7777) {
        if ($engPid) { Write-Host "  engine  :7777  listening (pid $engPid)" }
        else         { Write-Host '  engine  :7777  listening (no pid file: started outside sf-console)' }
    } else {
        Write-Host '  engine  :7777  not running (start it with sf-engine)'
    }
    return
}

if ($Stop) {
    Stop-Tracked
    Write-Host '  console stopped'
    return
}

# ---- start -------------------------------------------------------------
if (-not (Test-Path (Join-Path $web 'console-service\index.ts'))) {
    Write-Host '  [x] console sources not found; reinstall with sf-update' -ForegroundColor Red
    return
}

# engine first: the console bridge picks it up from :7778
if (-not (Test-PortLocal 7777)) {
    if (Test-Path $engineExe) {
        $eng = Start-SfEngine -Root $root -Executable $engineExe
        Write-PidFile -Name 'engine.pid' -Value $eng.Id
        if (Wait-Port -Port 7777 -Seconds 10) {
            Write-Host '  engine started (:7777 + api :7778)'
        } else {
            Write-Host '  [!] engine did not come up on :7777' -ForegroundColor Yellow
        }
    } else {
        Write-Host '  [!] engine binary not found; install first (sf-update)' -ForegroundColor Yellow
    }
} else {
    Write-Host '  engine already running'
}

if (-not (Test-PortLocal $ServicePort)) {
    $env:CONSOLE_SERVICE_PORT = [string]$ServicePort
    $env:CONSOLE_CORS_ORIGIN = (@($env:CONSOLE_CORS_ORIGIN, "http://localhost:$ConsolePort", "http://127.0.0.1:$ConsolePort") | Where-Object { $_ }) -join ','
    $svc = Start-Process -FilePath $bunExe -ArgumentList "`"$web\console-service\index.ts`"" `
        -WorkingDirectory (Join-Path $web 'console-service') -WindowStyle Hidden -PassThru
    Write-PidFile -Name 'console-service.pid' -Value $svc.Id
    if (-not (Wait-Port -Port $ServicePort -Seconds 20)) {
        Write-Host '  [!] hub did not come up on port' $ServicePort -ForegroundColor Yellow
    }
} else {
    Write-Host '  hub already running'
}

if (-not (Test-PortLocal $ConsolePort)) {
    $nextBin = Join-Path $web 'console\node_modules\next\dist\bin\next'
    $app = Start-Process -FilePath $nodeExe -ArgumentList "`"$nextBin`"", 'start', '-H', '127.0.0.1', '-p', "$ConsolePort" `
        -WorkingDirectory (Join-Path $web 'console') -WindowStyle Hidden -PassThru
    Write-PidFile -Name 'console.pid' -Value $app.Id
    if (-not (Wait-Port -Port $ConsolePort -Seconds 60)) {
        Write-Host '  [!] console did not come up on port' $ConsolePort -ForegroundColor Yellow
        Write-Host '      try another port:  sf-console -ConsolePort 3100'
        return
    }
} else {
    Write-Host '  console already running'
}

if (-not $NoBrowser) { Start-Process "http://localhost:$ConsolePort" }
Write-Host "  console:  http://localhost:$ConsolePort"
Write-Host '  stop it:  sf-console -Stop'

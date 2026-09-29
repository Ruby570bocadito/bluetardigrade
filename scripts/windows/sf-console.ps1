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

$ErrorActionPreference = 'SilentlyContinue'

# resolve install root: installed copy lives at <root>\scripts\
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'web'))) { $root = Split-Path -Parent $root }

$web      = Join-Path $root 'web'
$run      = Join-Path $root 'run'
$tools    = Join-Path $root 'tools'
$bunExe   = Join-Path $tools 'bun.exe'
$nodeExe  = Join-Path $tools 'node\node.exe'
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

function Stop-Tracked {
    foreach ($f in @('console.pid', 'console-service.pid')) {
        $procId = Read-PidFile -Name $f
        if ($procId) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            Remove-Item (Join-Path $run $f) -Force -ErrorAction SilentlyContinue
        }
    }
    # fallback: any hub/console process running from the install tree
    $rootLow = $root.ToLower().TrimEnd('\')
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith($rootLow) -and
        ($_.CommandLine -match 'console-service|next|server\.js')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Status) {
    $svcPid = Read-PidFile -Name 'console-service.pid'
    $appPid = Read-PidFile -Name 'console.pid'
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
        Write-Host '  engine  :7777  listening'
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

if (-not (Test-PortLocal $ServicePort)) {
    $svc = Start-Process -FilePath $bunExe -ArgumentList 'index.ts' `
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
    $app = Start-Process -FilePath $nodeExe -ArgumentList "`"$nextBin`"", 'start', '-p', "$ConsolePort" `
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

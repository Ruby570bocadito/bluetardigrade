# ======================================================================
# security-framework console launcher (Windows)
#
#   sf-console              start hub + console, open the browser
#   sf-console -Stop        stop both
#   sf-console -Status      show what is running
#   sf-console -Restart     restart the console only (applies new accounts)
#   sf-console -ConsolePort 3100 -ServicePort 3003   (custom ports; the
#                           console port sticks for sf-start and sf-status)
#   sf-console -AddUser ana [-Role analyst]   create a console account
#                           (default role admin), or reset its password
#                           and role; the console then asks to sign in
#   sf-console -RemoveUser ana                remove one
#   sf-console -RequireMfa admin,analyst      roles that must use two-step
#                           sign-in (none: optional for everyone)
#   sf-console -ResetMfa ana                  remove an account's two-step
#                           sign-in (a lost phone)
#   sf-console -SetGroups ana -Groups madrid,servidores
#                           limit an account to engine host groups (none:
#                           every machine); -AddUser takes -Groups too
# ======================================================================
param(
    [switch]$Stop,
    [switch]$Status,
    [switch]$Restart,
    [switch]$NoBrowser,
    [int]$ConsolePort = 3000,
    [int]$ServicePort = 3003,
    # how to stop what was started (sf-start passes 'sf-stop': it also
    # stops the ETW sensor service)
    [string]$StopHint = 'sf-console -Stop',
    # console accounts, kept in tools\config\console-users.json
    [string]$AddUser,
    [ValidateSet('admin', 'analyst', 'viewer')]
    [string]$Role = 'admin',
    [string]$RemoveUser,
    [string]$ResetMfa,
    [string]$RequireMfa,
    # host groups an account is limited to (comma separated, or none)
    [string]$SetGroups,
    [string]$Groups,
    # sf-start restarts the console itself after the first account
    [switch]$NoRestartHint
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
# same token the engine is started with (created on first use)
$env:SF_API_TOKEN = Initialize-SfApiToken $root
# without -ConsolePort, the port the console last ran on
$consolePortGiven = $PSBoundParameters.ContainsKey('ConsolePort')
if (-not $consolePortGiven) { $ConsolePort = Get-SfConsolePort $root }

function Format-SfOwner($Owner) {
    if ($Owner.Name -and $Owner.Detail) { return "$($Owner.Name) ($($Owner.Detail), pid $($Owner.Pid))" }
    if ($Owner.Name) { return "$($Owner.Name) (pid $($Owner.Pid))" }
    return 'another program'
}

$web      = Join-Path $root 'web'
$run      = Join-Path $root 'run'
$tools    = Join-Path $root 'tools'
$bunExe   = Join-Path $tools 'bun.exe'
$nodeExe  = Join-Path $tools 'node\node.exe'
$engineExe = Join-Path $root 'bin\sf-engine.exe'
if (-not (Test-Path $engineExe)) { $engineExe = Join-Path $root 'bin\engine.exe' }
if (-not (Test-Path $bunExe))  { $bunExe  = 'bun' }
if (-not (Test-Path $nodeExe)) { $nodeExe = 'node' }
$usersFile = Join-Path $tools 'config\console-users.json'

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

function Write-SignInMode {
    if (Test-Path -LiteralPath $usersFile) { Write-Host "  sign-in:  console accounts ($usersFile)" }
    elseif ($env:CONSOLE_ACCESS_TOKEN) { Write-Host '  sign-in:  shared token (CONSOLE_ACCESS_TOKEN)' }
    else { Write-Host '  sign-in:  none, anyone on this machine opens the console (add an account: sf-console -AddUser <name>)' }
}

if ($SetGroups -and -not $Groups) {
    Write-Host '  [x] -SetGroups needs -Groups <grupo,grupo> (or -Groups none for every machine)' -ForegroundColor Red
    return
}
if ($AddUser -or $RemoveUser -or $ResetMfa -or $RequireMfa -or $SetGroups) {
    # the tool asks for the password (not echoed) and stores only its
    # PBKDF2 hash; it writes the file in one rename, and the console
    # re-reads it on its own
    $userTool = Join-Path $web 'console\scripts\console-user.mjs'
    if (-not (Test-Path -LiteralPath $userTool)) {
        Write-Host '  [x] console sources not found; reinstall with sf-update' -ForegroundColor Red
        return
    }
    $hadFile = Test-Path -LiteralPath $usersFile
    if ($AddUser) {
        & $nodeExe $userTool --file $usersFile $AddUser $Role
        if ($LASTEXITCODE -eq 0 -and $Groups) { & $nodeExe $userTool --file $usersFile --groups $AddUser $Groups }
    }
    elseif ($SetGroups) { & $nodeExe $userTool --file $usersFile --groups $SetGroups $Groups }
    elseif ($RemoveUser) { & $nodeExe $userTool --file $usersFile --remove $RemoveUser }
    elseif ($ResetMfa) { & $nodeExe $userTool --file $usersFile --reset-mfa $ResetMfa }
    else { & $nodeExe $userTool --file $usersFile --require-mfa $RequireMfa }
    if ($LASTEXITCODE -ne 0) { return }
    # a console started without the file never looks for it
    if (-not $hadFile -and -not $NoRestartHint -and (Get-SfPortOwner -Port $ConsolePort -Root $root -PidName 'console.pid').State -eq 'ours') {
        Write-Host '  the running console still opens without signing in; apply it now: sf-console -Restart' -ForegroundColor Yellow
    }
    return
}

if ($Status) {
    Write-Host '  bluetardigrade status'
    $parts = @(
        @{ Name = 'engine'; Port = 7777; PidName = 'engine.pid' },
        @{ Name = 'hub'; Port = $ServicePort; PidName = 'console-service.pid' },
        @{ Name = 'console'; Port = $ConsolePort; PidName = 'console.pid' }
    )
    $consoleUp = $false
    foreach ($part in $parts) {
        $owner = Get-SfPortOwner -Port $part.Port -Root $root -PidName $part.PidName
        $port = ":$($part.Port)"
        switch ($owner.State) {
            'ours'    { Write-SfStatusLine $part.Name $port 'ok' "running (pid $($owner.Pid))"; if ($part.Name -eq 'console') { $consoleUp = $true } }
            'free'    { Write-SfStatusLine $part.Name $port 'off' 'stopped' }
            'foreign' { Write-SfStatusLine $part.Name $port 'warn' "stopped; the port is used by $(Format-SfOwner $owner)" }
            'hidden'  { Write-SfStatusLine $part.Name $port 'warn' "the port is used by $(Format-SfOwner $owner), started as administrator: check it from an elevated window" }
            default   { Write-SfStatusLine $part.Name $port 'warn' 'stopped; another program answers on this port' }
        }
    }
    if ($consoleUp) { Write-Host "  console:  http://localhost:$ConsolePort" }
    Write-SignInMode
    return
}

if ($Stop) {
    Stop-Tracked
    # Stop-Tracked cannot see (let alone stop) processes started from an
    # elevated window: Win32_Process hides their path from a normal one.
    # Never claim a stop that did not happen.
    Start-Sleep -Milliseconds 500
    # only this installation's processes count: another program on the
    # same port is not something sf-console started or can stop
    $left = @()
    $mine = @('ours', 'hidden')
    if ((Get-SfPortOwner -Port 7777 -Root $root -PidName 'engine.pid').State -in $mine) { $left += 'engine :7777' }
    if ((Get-SfPortOwner -Port $ServicePort -Root $root -PidName 'console-service.pid').State -in $mine) { $left += "hub :$ServicePort" }
    if ((Get-SfPortOwner -Port $ConsolePort -Root $root -PidName 'console.pid').State -in $mine) { $left += "console :$ConsolePort" }
    if ($left.Count -gt 0) {
        Write-Host "  [!] still running: $($left -join ', ')" -ForegroundColor Yellow
        Write-Host '      if they were started from an Administrator window, run sf-console -Stop there' -ForegroundColor Yellow
        return
    }
    Write-Host '  console stopped'
    return
}

# ---- start -------------------------------------------------------------
if (-not (Test-Path (Join-Path $web 'console-service\index.ts'))) {
    Write-Host '  [x] console sources not found; reinstall with sf-update' -ForegroundColor Red
    return
}

# The console port is settled first: the hub is started with the
# console's origin allowed. A port another program holds moves the
# console to the next free one, unless -ConsolePort asked for it.
$previousPort = Get-SfConsolePort $root
$console = Get-SfPortOwner -Port $ConsolePort -Root $root -PidName 'console.pid'
if ($Restart -and $console.State -eq 'ours') {
    Stop-Process -Id $console.Pid -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 40 -and (Test-PortLocal $ConsolePort); $i++) { Start-Sleep -Milliseconds 250 }
    $console = Get-SfPortOwner -Port $ConsolePort -Root $root -PidName 'console.pid'
}
if ($console.State -ne 'ours' -and $console.State -ne 'free') {
    $taken = $ConsolePort
    if ($consolePortGiven) {
        Write-Host "  [x] port $taken is used by $(Format-SfOwner $console): choose another one, e.g. sf-console -ConsolePort $($taken + 100)" -ForegroundColor Red
        return
    }
    $free = 0
    foreach ($candidate in ($taken + 1)..($taken + 20)) {
        if ((Get-SfPortOwner -Port $candidate -Root $root).State -eq 'free') { $free = $candidate; break }
    }
    if (-not $free) {
        Write-Host "  [x] port $taken is used by $(Format-SfOwner $console) and the next 20 are taken too: sf-console -ConsolePort <port>" -ForegroundColor Red
        return
    }
    Write-Host "  [!] port $taken is used by $(Format-SfOwner $console); the console moves to :$free" -ForegroundColor Yellow
    $ConsolePort = $free
    $console = [pscustomobject]@{ State = 'free'; Pid = 0; Name = ''; Detail = '' }
}

# engine first: the console bridge picks it up from :7778
$engine = Get-SfPortOwner -Port 7777 -Root $root -PidName 'engine.pid'
if ($engine.State -eq 'free') {
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
} elseif ($engine.State -eq 'ours') {
    Write-Host "  engine already running (pid $($engine.Pid))"
} elseif ($engine.State -eq 'hidden') {
    Write-Host "  engine already running as administrator ($(Format-SfOwner $engine))"
} else {
    Write-Host "  [!] port 7777 is used by $(Format-SfOwner $engine), not by this installation's engine: close that program and run this again" -ForegroundColor Yellow
}

$hub = Get-SfPortOwner -Port $ServicePort -Root $root -PidName 'console-service.pid'
if ($hub.State -eq 'ours') {
    Write-Host "  hub already running (pid $($hub.Pid))"
    if ($ConsolePort -ne $previousPort) {
        Write-Host "      it was started for the console on :$previousPort; if the analyst does not answer, restart everything (sf-stop, then sf-start)" -ForegroundColor Yellow
    }
} elseif ($hub.State -eq 'hidden') {
    Write-Host "  hub already running as administrator ($(Format-SfOwner $hub))"
} elseif ($hub.State -ne 'free') {
    Write-Host "  [!] port $ServicePort is used by $(Format-SfOwner $hub), not by the hub: the analyst stays off (sf-console -ServicePort <port>)" -ForegroundColor Yellow
} else {
    $env:CONSOLE_SERVICE_PORT = [string]$ServicePort
    $env:CONSOLE_CORS_ORIGIN = (@($env:CONSOLE_CORS_ORIGIN, "http://localhost:$ConsolePort", "http://127.0.0.1:$ConsolePort") | Where-Object { $_ }) -join ','
    $svc = Start-Process -FilePath $bunExe -ArgumentList "`"$web\console-service\index.ts`"" `
        -WorkingDirectory (Join-Path $web 'console-service') -WindowStyle Hidden -PassThru
    Write-PidFile -Name 'console-service.pid' -Value $svc.Id
    if (Wait-Port -Port $ServicePort -Seconds 20) {
        Write-Host "  hub started (:$ServicePort)"
    } else {
        Write-Host '  [!] hub did not come up on port' $ServicePort -ForegroundColor Yellow
    }
}

if ($console.State -eq 'free') {
    # Analyst accounts (docs/OPERATIONS.md): only when the file exists;
    # without it the console keeps its loopback/token behavior. Console
    # writes are always audited under data\.
    # $env changes outlive this script in the operator's PowerShell, so a
    # deleted accounts file must also clear the variable it set, or the
    # next start would point the console at a missing file (locked).
    if (Test-Path -LiteralPath $usersFile) { $env:CONSOLE_USERS_FILE = $usersFile }
    elseif ($env:CONSOLE_USERS_FILE -eq $usersFile) { Remove-Item Env:CONSOLE_USERS_FILE -ErrorAction SilentlyContinue }
    # Domain sign-in (AD-7): the same file that arms the engine's
    # -domain-auth (runtime.ps1) offers «Cuenta del dominio» on the
    # login page; it needs the accounts file too (local accounts stay
    # as the fallback).
    if (Test-Path -LiteralPath (Join-Path $root 'tools\config\domain-auth.yaml')) { $env:CONSOLE_DOMAIN_AUTH = '1' }
    else { Remove-Item Env:CONSOLE_DOMAIN_AUTH -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Path (Join-Path $root 'data') -Force | Out-Null
    $env:CONSOLE_AUDIT_FILE = Join-Path $root 'data\console-audit.jsonl'
    $nextBin = Join-Path $web 'console\node_modules\next\dist\bin\next'
    $app = Start-Process -FilePath $nodeExe -ArgumentList "`"$nextBin`"", 'start', '-H', '127.0.0.1', '-p', "$ConsolePort" `
        -WorkingDirectory (Join-Path $web 'console') -WindowStyle Hidden -PassThru
    Write-PidFile -Name 'console.pid' -Value $app.Id
    if (-not (Wait-Port -Port $ConsolePort -Seconds 60)) {
        Write-Host '  [!] console did not come up on port' $ConsolePort -ForegroundColor Yellow
        Write-Host "      try another port:  sf-console -ConsolePort $($ConsolePort + 100)"
        return
    }
    Set-SfConsolePort $root $ConsolePort
    if ($Restart) { Write-Host "  console restarted (:$ConsolePort)" } else { Write-Host "  console started (:$ConsolePort)" }
} else {
    Set-SfConsolePort $root $ConsolePort
    Write-Host "  console already running (pid $($console.Pid))"
}

if (-not $NoBrowser) { Start-Process "http://localhost:$ConsolePort" }
Write-Host "  console:  http://localhost:$ConsolePort"
Write-SignInMode
Write-Host "  stop it:  $StopHint"

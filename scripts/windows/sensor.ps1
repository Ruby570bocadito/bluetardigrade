# ======================================================================
# security-framework - REAL sensor (Windows Sysmon edition)
#
# sf-sensor streams observed telemetry from your machine: it
# subscribes to the Microsoft-Windows-Sysmon/Operational event log in
# real time and translates every Sysmon record into the unified event
# schema, then ships it as NDJSON to the engine ingest port. The
# alerts you get from this sensor correspond to things that actually
# happened on this host.
#
# Prerequisite (one-time, admin): install Sysmon, the free Microsoft
#   telemetry driver:
#     winget install Sysinternals.Sysmon          (or download from
#       https://learn.microsoft.com/sysinternals/downloads/sysmon)
#     sysmon -accepteula -i <config.xml>
#   A permissive community config (SwiftOnSecurity's sysmon-config)
#   is a good starting point; Sysmon only reports what the config
#   includes, so log volume is under your control.
#
#   Reading the Sysmon log needs elevation OR membership in the
#   local "Event Log Readers" group (recommended for daily use).
#
# Usage:
#   sf-sensor                          (engine on 127.0.0.1:7777)
#   sf-sensor -SetupSysmon             (one-time: install Sysmon + apply
#                                       the bundled config; UAC prompt)
#   sf-sensor -Addr 10.0.0.5:7777
#   sf-sensor -Token <ingest-token>    (required when the engine runs
#                                       with -token; also read from
#                                       SF_INGEST_TOKEN)
#   sf-sensor -NoEngine                (never auto-start the engine)
#   sf-sensor -Quiet                   (suppress per-event console lines)
#   sf-sensor -SelfTest                (validate the mapping layer, no
#                                       telemetry; works on any OS)
#
# Mapped Sysmon IDs (v1): 1 process create, 3 network connect,
# 5 process terminate, 7 image load, 10 process access (credential
# dumping / injection handle grants), 11 file create, 12/13/14
# registry create/set/rename, 22 DNS query. All real telemetry.
#
# If the engine is not listening, this script starts it in the
# background first (hidden window,
# pid in run\engine.pid). Works on PowerShell 5.1+.
# ======================================================================
param(
    [string]$Addr = '127.0.0.1:7777',
    [string]$Token = '',
    [switch]$NoEngine,
    [switch]$Quiet,
    [switch]$SelfTest,
    [switch]$SetupSysmon,
    [string]$TranscriptLog = '',
    [int]$ReconnectSeconds = 5
)
$ErrorActionPreference = 'Stop'

# Same env fallback the engine honors, so an install that provisions
# SF_INGEST_TOKEN works with a bare `sf-sensor` invocation.
if (-not $Token) { $Token = [Environment]::GetEnvironmentVariable('SF_INGEST_TOKEN') }

$sysmonLog = 'Microsoft-Windows-Sysmon/Operational'
$watchedIds = 1, 3, 5, 7, 10, 11, 12, 13, 14, 22

# ======================================================================
# Mapping layer: Sysmon EventData -> unified event schema (pure
# functions, no Windows dependencies, covered by -SelfTest).
# ======================================================================

function Get-PathLeaf([string]$p) {
    if (-not $p) { return '' }
    $i = $p.LastIndexOf('\')
    if ($i -ge 0) { return $p.Substring($i + 1) }
    return $p
}

function Get-RegistryLeafAndKey([string]$targetObject) {
    # Sysmon TargetObject is the FULL path including the value name on
    # SetValue (e.g. HKCU\Software\...\Run\OneDriveSync). The key is
    # everything before the last separator; the leaf is the value name.
    if (-not $targetObject) { return @{ key = ''; name = '' } }
    $t = $targetObject.TrimEnd('\')
    $i = $t.LastIndexOf('\')
    if ($i -lt 0) { return @{ key = $t; name = '' } }
    return @{ key = $t.Substring(0, $i); name = $t.Substring($i + 1) }
}

function ConvertFrom-SysmonHashes([string]$hashes) {
    # Sysmon format: "SHA256=ABC,IMPHASH=DEF,MD5=123" -> @{ sha256 = ... }
    $out = @{}
    if (-not $hashes) { return $out }
    foreach ($pair in $hashes -split ',') {
        $kv = $pair -split '=', 2
        if ($kv.Count -eq 2 -and $kv[0]) { $out[$kv[0].ToLower()] = $kv[1] }
    }
    return $out
}

function Get-SfDnsAnswer([string]$Results) {
    # Sysmon EID 22 renders the answer like the DNS client does:
    # "type:  5 cdn.example.net;::ffff:93.184.216.34;2606:2800::1;" -
    # CNAME hops carry a "type:" prefix and IPv4 answers come IPv4-mapped.
    # Returns the first address, IPv4-mapped shown as IPv4, or $null.
    if (-not $Results -or $Results -eq '-') { return $null }
    foreach ($entry in ($Results -split ';')) {
        $e = $entry.Trim()
        if (-not $e -or $e.StartsWith('type:')) { continue }
        $e = $e -replace '^(A|AAAA):', ''
        if ($e.StartsWith('::ffff:')) { $e = $e.Substring(7) }
        $ip = $null
        if ([System.Net.IPAddress]::TryParse($e, [ref]$ip)) {
            if ($ip.Equals([System.Net.IPAddress]::Loopback) -or $ip.Equals([System.Net.IPAddress]::Any) -or $ip.Equals([System.Net.IPAddress]::IPv6Any)) { continue }
            return $ip.ToString()
        }
    }
    return $null
}

function New-SfEvent([string]$Type, [hashtable]$Data, [datetime]$Time) {
    # Shared envelope. Returns an ordered hashtable matching
    # pkg/model/model.go byte-for-byte (snake_case keys).
    $ev = [ordered]@{
        id        = [Guid]::NewGuid().ToString()
        timestamp = $Time.ToUniversalTime().ToString('o')
        type      = $Type
        source    = 'sysmon'
        host      = $env:COMPUTERNAME
    }
    if ($Data['User'] -and $Data['User'] -ne '-') { $ev['user'] = $Data['User'] }

    $proc = $null
    if ($Data['Image'] -or $Data['ProcessId']) {
        $proc = [ordered]@{
            pid  = [int]($Data['ProcessId'] -as [int])
            name = Get-PathLeaf $Data['Image']
        }
        if ($Data['Image']) { $proc['image'] = $Data['Image'] }
        if ($Data['CommandLine']) { $proc['command_line'] = $Data['CommandLine'] }
        if ($Data['ParentProcessId']) { $proc['ppid'] = [int]($Data['ParentProcessId'] -as [int]) }
        $hashes = ConvertFrom-SysmonHashes $Data['Hashes']
        if ($hashes.Count -gt 0) { $proc['hashes'] = $hashes }
        $ev['process'] = $proc
    }
    return $ev
}

function ConvertFrom-SysmonRecord([int]$EventId, [hashtable]$Data, [datetime]$Time) {
    # One Sysmon record -> one schema event. Returns $null for IDs we
    # do not map (callers skip those silently).
    switch ($EventId) {
        1 {
            $ev = New-SfEvent 'process.create' $Data $Time
            return $ev
        }
        3 {
            $ev = New-SfEvent 'network.connect' $Data $Time
            $net = [ordered]@{}
            if ($Data['Protocol']) { $net['protocol'] = $Data['Protocol'].ToLower() }
            if ($Data['SourceIp']) { $net['source_ip'] = $Data['SourceIp'] }
            if ($Data['SourcePort']) { $net['source_port'] = [int]($Data['SourcePort'] -as [int]) }
            if ($Data['DestinationIp']) { $net['destination_ip'] = $Data['DestinationIp'] }
            if ($Data['DestinationPort']) { $net['destination_port'] = [int]($Data['DestinationPort'] -as [int]) }
            if ($Data['DestinationHostname'] -and $Data['DestinationHostname'] -ne '-') { $net['domain'] = $Data['DestinationHostname'] }
            $ev['network'] = $net
            return $ev
        }
        10 {
            # ProcessAccess: source opened a handle on target with GrantedAccess.
            # Flagship real-telemetry signal: LSASS access = credential dumping.
            $ev = New-SfEvent 'process.access' @{
                Image = $Data['SourceImage']; ProcessId = $Data['SourceProcessId']; User = $Data['User']
            } $Time
            if ($Data['TargetImage'] -or $Data['TargetProcessId']) {
                $ev['target'] = [ordered]@{
                    pid  = [int]($Data['TargetProcessId'] -as [int])
                    name = Get-PathLeaf $Data['TargetImage']
                }
                if ($Data['TargetImage']) { $ev['target']['image'] = $Data['TargetImage'] }
            }
            $ev['access'] = [ordered]@{
                granted_access = $Data['GrantedAccess']
                call_trace     = $Data['CallTrace']
            }
            return $ev
        }
        22 {
            # DNS query: mapped to network.connect with protocol=dns. The
            # requested name is the domain; the first address of the answer
            # fills destination_ip (Get-SfDnsAnswer reads Sysmon's format).
            $ev = New-SfEvent 'network.connect' $Data $Time
            $name = $Data['QueryName']
            if ($name) { $name = $name.TrimEnd('.') }
            $net = [ordered]@{ protocol = 'dns' }
            if ($name -and $name -ne '-') { $net['domain'] = $name }
            $answer = Get-SfDnsAnswer $Data['QueryResults']
            if ($answer) { $net['destination_ip'] = $answer }
            $ev['network'] = $net
            return $ev
        }
        5 {
            $ev = New-SfEvent 'process.terminate' $Data $Time
            return $ev
        }
        7 {
            $ev = New-SfEvent 'image.load' $Data $Time
            $ev['file'] = [ordered]@{ path = $Data['ImageLoaded'] }
            return $ev
        }
        11 {
            $ev = New-SfEvent 'file.write' $Data $Time
            $file = [ordered]@{ path = $Data['TargetFilename'] }
            $leaf = Get-PathLeaf $Data['TargetFilename']
            $dot = $leaf.LastIndexOf('.')
            if ($dot -gt 0) { $file['extension'] = $leaf.Substring($dot + 1).ToLower() }
            $hashes = ConvertFrom-SysmonHashes $Data['Hashes']
            if ($hashes.Count -gt 0) { $file['hashes'] = $hashes }
            $ev['file'] = $file
            return $ev
        }
        12 {
            $ev = New-SfEvent 'registry.set' $Data $Time
            $op = if ($Data['EventType'] -eq 'DeleteKey') { 'DeleteKey' } else { 'CreateKey' }
            $ev['registry'] = [ordered]@{ key = $Data['TargetObject']; operation = $op }
            return $ev
        }
        13 {
            $ev = New-SfEvent 'registry.set' $Data $Time
            $split = Get-RegistryLeafAndKey $Data['TargetObject']
            $ev['registry'] = [ordered]@{
                key        = $split['key']
                value_name = $split['name']
                value      = $Data['Details']
                operation  = 'SetValue'
            }
            return $ev
        }
        14 {
            $ev = New-SfEvent 'registry.set' $Data $Time
            $ev['registry'] = [ordered]@{
                key       = $Data['TargetObject']
                value     = $Data['NewName']
                operation = 'RenameKey'
            }
            return $ev
        }
        default { return $null }
    }
}

# ======================================================================
# SelfTest: mapping fixtures shaped like real Sysmon EventData. Runs on
# any OS with PowerShell (used by the project E2E on the dev box).
# ======================================================================
# ---- health report for the engine's machine inventory (GET /api/fleet).
# sensor.heartbeat events are consumed by the engine and never reach rules
# or storage; a sensor that stops sending them raises "Sensor sin señal".
$HeartbeatSeconds = 60

function Get-OsLabel {
    try {
        $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    } catch { return '' }
    $product = "$($cv.ProductName)".Trim()
    $build = "$($cv.CurrentBuildNumber)".Trim()
    # Windows 11 still reports "Windows 10" in ProductName; build 22000+ is 11
    if ($product -like 'Windows 10*' -and ($build -as [int]) -ge 22000) { $product = $product -replace '^Windows 10', 'Windows 11' }
    $label = $product
    if ("$($cv.DisplayVersion)".Trim()) { $label = ($label + ' ' + "$($cv.DisplayVersion)".Trim()).Trim() }
    if ($build) { $label = ($label + " ($build)").Trim() }
    return $label
}

function New-HeartbeatEvent([string]$Os, [string]$Version, [datetime]$Started, [datetime]$Now, [long]$Sent) {
    $attrs = [ordered]@{
        sensor_kind = 'sysmon'
        capture     = 'sysmon event ids ' + ($watchedIds -join ',')
        interval_s  = "$HeartbeatSeconds"
        uptime_s    = '' + [long]($Now - $Started).TotalSeconds
        spooled     = '0'
        dropped     = '0'
        sent        = "$Sent"
    }
    if ($Version) { $attrs['sensor_version'] = $Version }
    if ($Os) { $attrs['os'] = $Os }
    return [ordered]@{
        id         = [Guid]::NewGuid().ToString()
        timestamp  = $Now.ToUniversalTime().ToString('o')
        type       = 'sensor.heartbeat'
        source     = 'sysmon'
        host       = $env:COMPUTERNAME
        attributes = $attrs
    }
}

function Invoke-SelfTest {
    $fails = 0
    function Check([string]$name, [bool]$ok) {
        if ($ok) { Write-Host "  PASS  $name" }
        else { Write-Host "  FAIL  $name" -ForegroundColor Red; $script:fails++ }
    }
    $t = [datetime]'2026-09-29T14:22:11.123Z'

    Write-Host '[SENSOR] self-test: mapping layer'
    $ev = ConvertFrom-SysmonRecord 1 @{
        ProcessId = '6612'; ParentProcessId = '4104'
        Image = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
        CommandLine = 'powershell.exe -nop -w hidden -enc SQBFAFgA'
        User = 'LAB-WKS-01\jdoe'
        Hashes = 'SHA256=AA11,MD5=BB22'
    } $t
    Check 'EID1 -> process.create' ($ev['type'] -eq 'process.create')
    Check 'EID1 process fields' ($ev['process']['name'] -eq 'powershell.exe' -and $ev['process']['pid'] -eq 6612 -and $ev['process']['ppid'] -eq 4104)
    Check 'EID1 hashes parsed' ($ev['process']['hashes']['sha256'] -eq 'AA11')
    Check 'EID1 user carried' ($ev['user'] -eq 'LAB-WKS-01\jdoe')

    $ev = ConvertFrom-SysmonRecord 3 @{
        Protocol = 'TCP'; SourceIp = '10.0.4.42'; SourcePort = '51520'
        DestinationIp = '185.220.101.47'; DestinationPort = '443'
        DestinationHostname = 'evil.example'; Image = 'C:\Windows\certutil.exe'; ProcessId = '6688'
    } $t
    Check 'EID3 -> network.connect' ($ev['type'] -eq 'network.connect')
    Check 'EID3 network fields' ($ev['network']['destination_ip'] -eq '185.220.101.47' -and $ev['network']['destination_port'] -eq 443 -and $ev['network']['protocol'] -eq 'tcp')
    Check 'EID3 domain carried' ($ev['network']['domain'] -eq 'evil.example')

    $ev = ConvertFrom-SysmonRecord 13 @{
        EventType = 'SetValue'; TargetObject = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run\OneDriveSync'
        Details = 'C:\Users\Public\payload.exe'; Image = 'C:\Windows\reg.exe'; ProcessId = '6733'
    } $t
    Check 'EID13 -> registry.set' ($ev['type'] -eq 'registry.set')
    Check 'EID13 key/value split' ($ev['registry']['key'] -eq 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' -and $ev['registry']['value_name'] -eq 'OneDriveSync')
    Check 'EID13 details as value' ($ev['registry']['value'] -eq 'C:\Users\Public\payload.exe')

    $ev = ConvertFrom-SysmonRecord 12 @{ EventType = 'CreateKey'; TargetObject = 'HKCU\Software\evil'; Image = 'C:\Windows\reg.exe' } $t
    Check 'EID12 -> registry.set CreateKey' ($ev['registry']['operation'] -eq 'CreateKey' -and $ev['registry']['key'] -eq 'HKCU\Software\evil')

    $ev = ConvertFrom-SysmonRecord 14 @{ EventType = 'RenameKey'; TargetObject = 'HKLM\SOFTWARE\old'; NewName = 'new'; Image = 'C:\Windows\reg.exe' } $t
    Check 'EID14 -> registry.set RenameKey' ($ev['registry']['operation'] -eq 'RenameKey')

    $ev = ConvertFrom-SysmonRecord 11 @{
        TargetFilename = 'C:\Users\Public\payload.exe'
        Hashes = 'SHA256=CC33'; Image = 'C:\Windows\certutil.exe'; ProcessId = '6688'
    } $t
    Check 'EID11 -> file.write' ($ev['type'] -eq 'file.write' -and $ev['file']['path'] -eq 'C:\Users\Public\payload.exe')
    Check 'EID11 extension + hashes' ($ev['file']['extension'] -eq 'exe' -and $ev['file']['hashes']['sha256'] -eq 'CC33')

    $ev = ConvertFrom-SysmonRecord 7 @{
        ImageLoaded = 'C:\Temp\hook.dll'; Image = 'C:\Program Files\app.exe'; ProcessId = '1234'
    } $t
    Check 'EID7 -> image.load' ($ev['type'] -eq 'image.load' -and $ev['file']['path'] -eq 'C:\Temp\hook.dll')

    $ev = ConvertFrom-SysmonRecord 5 @{ ProcessId = '4212'; Image = 'C:\Windows\notepad.exe' } $t
    Check 'EID5 -> process.terminate' ($ev['type'] -eq 'process.terminate' -and $ev['process']['pid'] -eq 4212)

    $ev = ConvertFrom-SysmonRecord 10 @{
        SourceImage = 'C:\Users\Public\dump.exe'; SourceProcessId = '700'
        TargetImage = 'C:\Windows\system32\lsass.exe'; TargetProcessId = '744'
        GrantedAccess = '0x1010'; CallTrace = 'C:\Windows\SYSTEM32\ntdll.dll+9d1a4|UNKNOWN(00007FF...)'
        User = 'LAB-WKS-01\jdoe'
    } $t
    Check 'EID10 -> process.access' ($ev['type'] -eq 'process.access' -and $ev['process']['name'] -eq 'dump.exe')
    Check 'EID10 target + access' ($ev['target']['name'] -eq 'lsass.exe' -and $ev['access']['granted_access'] -eq '0x1010')

    # the QueryResults format Sysmon really writes (CNAME hops, mapped IPv4)
    $ev = ConvertFrom-SysmonRecord 22 @{
        QueryName = 'evil.example.com.'; QueryResults = 'type:  5 cdn.example.net;type:  5 edge.example.net;::ffff:93.184.216.34;2606:2800:220:1::248;'
        ProcessId = '900'; Image = 'C:\Program Files\browser.exe'
    } $t
    Check 'EID22 -> network.connect dns' ($ev['type'] -eq 'network.connect' -and $ev['network']['protocol'] -eq 'dns')
    Check 'EID22 domain + resolved ip' ($ev['network']['domain'] -eq 'evil.example.com' -and $ev['network']['destination_ip'] -eq '93.184.216.34')
    Check 'EID22 IPv6-only answer' ((Get-SfDnsAnswer '2606:2800:220:1::248;') -eq '2606:2800:220:1::248')
    Check 'EID22 no answer' ($null -eq (Get-SfDnsAnswer '-') -and $null -eq (Get-SfDnsAnswer 'type:  5 only.cname.example;'))
    Check 'EID22 legacy A: form' ((Get-SfDnsAnswer 'A:198.51.100.4;') -eq '198.51.100.4')

    $ev = ConvertFrom-SysmonRecord 255 @{ Whatever = '1' } $t
    Check 'unknown EID skipped' ($null -eq $ev)

    $hb = New-HeartbeatEvent 'Windows 11 Pro 24H2 (26100)' 'abc1234' $t $t.AddSeconds(90) 42
    Check 'heartbeat type + host' ($hb['type'] -eq 'sensor.heartbeat' -and $hb['host'] -eq $env:COMPUTERNAME)
    Check 'heartbeat health fields' ($hb['attributes']['sensor_kind'] -eq 'sysmon' -and $hb['attributes']['interval_s'] -eq '60' -and $hb['attributes']['uptime_s'] -eq '90' -and $hb['attributes']['sent'] -eq '42')
    $json = $hb | ConvertTo-Json -Compress -Depth 6
    Check 'heartbeat attributes are strings' ($json -match '"uptime_s":"90"' -and $json -match '"os":"Windows 11 Pro 24H2 \(26100\)"')

    if ($fails -gt 0) { Write-Host "[SENSOR] self-test FAILED ($fails)" -ForegroundColor Red; exit 1 }
    Write-Host '[SENSOR] self-test OK'
    exit 0
}

if ($SelfTest) { Invoke-SelfTest }

# ======================================================================
# Live mode: subscribe to the Sysmon log and stream schema events.
# ======================================================================
$parts = $Addr -split ':', 2
$ip = $parts[0]; $port = [int]$parts[1]

# ---- resolve install root (installed: <root>\scripts\, repo: <root>\scripts\windows\) ----
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'bin'))) { $root = Split-Path -Parent $root }
. (Join-Path $PSScriptRoot 'runtime.ps1')
$Token = Get-SfSetting $root 'SF_INGEST_TOKEN' 'ingest.token' $Token

# ---- one-command Sysmon setup (-SetupSysmon): winget install + config --
function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Find-SysmonExe {
    $cmd = Get-Command sysmon64.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd = Get-Command sysmon.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Sysinternals.Sysmon*" -Directory -ErrorAction SilentlyContinue)) {
        $hit = Get-ChildItem $p.FullName -Filter 'sysmon64.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return ''
}

function Invoke-SysmonSetup {
    $config = Join-Path $root 'scripts\sysmon-config.xml'
    if (-not (Test-Path $config)) { $config = Join-Path $root 'sysmon-config.xml' }

    $sysmonExe = Find-SysmonExe
    if (-not $sysmonExe) {
        Write-Host '[SETUP] installing Sysinternals Sysmon via winget...'
        winget install --id Sysinternals.Sysmon --accept-source-agreements --accept-package-agreements --silent
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[SETUP] [!] winget failed (exit $LASTEXITCODE)" -ForegroundColor Red
            Write-Host '[SETUP]     download Sysmon from https://learn.microsoft.com/sysinternals/downloads/sysmon'
            Write-Host '[SETUP]     put sysmon64.exe on PATH, then re-run:  sf-sensor -SetupSysmon'
            exit 1
        }
        $sysmonExe = Find-SysmonExe
        if (-not $sysmonExe) {
            Write-Host '[SETUP] [!] sysmon64.exe not found after install' -ForegroundColor Red
            Write-Host '[SETUP]     open a NEW terminal and re-run:  sf-sensor -SetupSysmon'
            exit 1
        }
    }

    if (-not (Test-Path $config)) {
        Write-Host "[SETUP] [!] bundled config not found: $config" -ForegroundColor Red
        Write-Host '[SETUP]     re-run sf-update and try again'
        exit 1
    }

    Write-Host "[SETUP] sysmon: $sysmonExe"
    Write-Host "[SETUP] applying bundled config (tuned to the detections, low noise)"
    & $sysmonExe -accepteula -i $config
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[SETUP] [!] sysmon -i failed (exit $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }

    $svc = Get-Service -Name Sysmon64 -ErrorAction SilentlyContinue
    if (-not $svc) { $svc = Get-Service -Name Sysmon -ErrorAction SilentlyContinue }
    if ($svc) { Write-Host "[SETUP] Sysmon service: $($svc.Name) -> $($svc.Status)" }
    Write-Host '[SETUP] Sysmon is live. Now start real telemetry (normal terminal):  sf-sensor'
}

if ($SetupSysmon) {
    if (-not (Test-IsAdmin)) {
        $log = Join-Path $root 'run\sysmon-setup.log'
        New-Item -ItemType Directory -Path (Split-Path -Parent $log) -Force | Out-Null
        Write-Host '[SETUP] installing Sysmon needs admin - accept the UAC prompt...'
        try {
            Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -SetupSysmon -TranscriptLog `"$log`""
        } catch {
            Write-Host '[SETUP] [!] elevation cancelled or failed - run it again to retry.' -ForegroundColor Red
            exit 1
        }
        if (Test-Path $log) { Get-Content $log | ForEach-Object { Write-Host "  $_" } }
        exit 0
    }
    if ($TranscriptLog) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $TranscriptLog) -Force | Out-Null
        Start-Transcript -Path $TranscriptLog -Force | Out-Null
    }
    Invoke-SysmonSetup
    if ($TranscriptLog) { Stop-Transcript | Out-Null }
    exit 0
}

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
        Write-Host '[SENSOR] engine is not running - starting it in the background...'
        try {
            $eng = Start-SfEngine -Root $root -Executable $engineExe -IngestToken $Token
            New-Item -ItemType Directory -Path (Join-Path $root 'run') -Force | Out-Null
            Set-Content -Path (Join-Path $root 'run\engine.pid') -Value $eng.Id
            for ($i = 0; $i -lt 20; $i++) {
                Start-Sleep -Milliseconds 500
                if (Test-EngineUp) { $engineWasStarted = $true; break }
            }
            if ($engineWasStarted) { Write-Host '[SENSOR] engine started (:7777 + api :7778)' }
            else { Write-Host '[SENSOR] [!] engine did not come up on :7777' -ForegroundColor Yellow }
        } catch {
            Write-Host "[SENSOR] [!] could not start the engine: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

# ---- verify the Sysmon log exists (friendly guidance otherwise) --------
$session = [System.Diagnostics.Eventing.Reader.EventLogSession]::GlobalSession
if ($session.GetLogNames() -notcontains $sysmonLog) {
    Write-Host '[SENSOR] Sysmon is not installed on this machine - no real telemetry available.' -ForegroundColor Red
    Write-Host '[SENSOR] one-command setup (asks for admin once):   sf-sensor -SetupSysmon'
    Write-Host '[SENSOR] or manual, in an ADMIN terminal:'
    Write-Host '[SENSOR]   winget install Sysinternals.Sysmon'
    Write-Host "[SENSOR]   sysmon -accepteula -i `"$root\scripts\sysmon-config.xml`""
    Write-Host '[SENSOR] (the config ships with security-framework: tuned to the detections, low noise)'
    exit 1
}

$xpath = '<QueryList><Query Id="0" Path="' + $sysmonLog + '"><Select Path="' + $sysmonLog + '">*[System[(EventID=' + ($watchedIds -join ') or (EventID=') + ')]]</Select></Query></QueryList>'

function Get-NewestRecordId {
    try {
        $query = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery($sysmonLog, [System.Diagnostics.Eventing.Reader.PathType]::LogName)
        $query.ReverseDirection = $true
        $reader = New-Object System.Diagnostics.Eventing.Reader.EventLogReader($query)
        try {
            $newest = $reader.ReadEvent()
            if ($newest) { return [long]$newest.RecordId }
        } finally { $reader.Dispose() }
    } catch [System.Security.SecurityException], [UnauthorizedAccessException] {
        Write-Host '[SENSOR] access denied reading the Sysmon log. Run this terminal as admin, or (recommended)' -ForegroundColor Red
        Write-Host '[SENSOR] add your user to the local "Event Log Readers" group and re-open the session.'
        exit 1
    } catch { }
    return 0
}


# ---- reconnection continuity -----------------------------------------
# EventRecordID is monotonic inside one log, so remembering the last
# processed id is a complete bookmark: the live loop reads everything
# after it on every pass, and a reconnect simply continues from it.
# Events emitted during a cut are RE-SENT, never lost; a hard crash can
# re-send up to the last persisted id (duplicate telemetry - the honest
# failure direction for a detection pipeline).
$bookmarkFile = Join-Path $root 'run\sensor-bookmark.txt'

function Load-LastRecordId {
    try {
        if (Test-Path $bookmarkFile) {
            $v = [long](Get-Content -Path $bookmarkFile -ErrorAction Stop)
            if ($v -gt 0) { return $v }
        }
    } catch { }
    return 0
}

function Save-LastRecordId([long]$Id) {
    if ($Id -le 0) { return }
    try {
        New-Item -ItemType Directory -Path (Join-Path $root 'run') -Force | Out-Null
        Set-Content -Path $bookmarkFile -Value $Id -Encoding ASCII
    } catch {
        # persistence is best-effort: its only failure mode is
        # re-sending a bounded slice of telemetry after a hard crash
    }
}

# Read-BacklogSince returns every watched event with EventRecordID
# greater than AfterId, oldest first, as raw records (same mapping the
# live path applies). An empty log beyond AfterId returns nothing. The
# XPath is passed RAW to EventLogQuery (not embedded in an XML
# document), so the comparison is a literal '>' - an &gt; entity would
# never be decoded here and the query would fail to parse.
function Read-BacklogSince([long]$AfterId) {
    $ids = ($watchedIds -join ') or (EventID=')
    $xpathBacklog = '<QueryList><Query Id="0" Path="' + $sysmonLog + '"><Select Path="' + $sysmonLog + '">*[System[((EventID=' + $ids + ')) and (EventRecordID > ' + $AfterId + ')]]</Select></Query></QueryList>'
    $query = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery($sysmonLog, [System.Diagnostics.Eventing.Reader.PathType]::LogName, $xpathBacklog)
    $reader = New-Object System.Diagnostics.Eventing.Reader.EventLogReader($query)
    try {
        while (($rec = $reader.ReadEvent()) -ne $null) { , $rec }
    } finally {
        $reader.Dispose()
    }
}

function Send-EventLine([IO.StreamWriter]$W, [Net.Sockets.TcpClient]$C, [hashtable]$Ev) {
    $json = $Ev | ConvertTo-Json -Compress -Depth 6
    $W.WriteLine($json)
    $W.Flush()
}


Write-Host "[SENSOR] Sysmon subscription active ($sysmonLog) - streaming REAL activity to $Addr"
if ($Token) { Write-Host '[SENSOR] ingest auth: ENABLED (AUTH handshake as first line)' }
Write-Host '[SENSOR] press Ctrl+C to stop (engine keeps running)'

# ---- main loop: connect -> auth -> poll by record id + heartbeat -----
# Reading the newest record first also fails fast (with guidance) when
# this account cannot read the Sysmon log.
$newestRecordId = Get-NewestRecordId
$lastRecordId = Load-LastRecordId
if ($lastRecordId -gt 0) {
    Write-Host "[SENSOR] resuming after record id $lastRecordId (events during the cut are re-sent)"
} else {
    # first run: start from now, never replay the whole log
    $lastRecordId = $newestRecordId
}
$sent = 0
$sensorStarted = Get-Date
$osLabel = Get-OsLabel
$sensorVersion = ''
try {
    $git = Get-Command git -ErrorAction Stop
    $sensorVersion = (& $git.Source -C $root rev-parse --short HEAD 2>$null | Select-Object -First 1)
} catch { }
while ($true) {
    $client = New-Object Net.Sockets.TcpClient
    try { $client.Connect($ip, $port) } catch {
        Write-Host "[SENSOR] cannot reach engine at ${Addr}: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "[SENSOR] retrying in $ReconnectSeconds s..."
        Start-Sleep -Seconds $ReconnectSeconds
        continue
    }
    $stream = $client.GetStream()
    $writer = New-Object IO.StreamWriter($stream, (New-Object Text.UTF8Encoding($false)))
    $writer.NewLine = "`n"

    # ---- ingest auth: must be the FIRST line when the engine has a
    # token. A rejection is fatal on purpose - a wrong token never
    # heals by retrying, and looping forever made the sensor look
    # "connected" while the engine dropped every connection (the
    # empty-console failure mode).
    if ($Token) {
        try {
            $stream.ReadTimeout = 10000
            $writer.WriteLine("AUTH $Token")
            $writer.Flush()
            $reader = New-Object IO.StreamReader($stream, (New-Object Text.UTF8Encoding($false)))
            $ack = $reader.ReadLine()
            if (-not $ack -or $ack -notmatch '"ack":"ok"') {
                Write-Host "[SENSOR] auth rejected by engine: $ack" -ForegroundColor Red
                Write-Host '[SENSOR] the engine requires a matching token: pass -Token here (or set SF_INGEST_TOKEN),'
                Write-Host '[SENSOR] and make sure it is the SAME value the engine got via -token/SF_INGEST_TOKEN.'
                exit 1
            }
            $stream.ReadTimeout = 0
            Write-Host '[SENSOR] ingest auth accepted'
        } catch {
            Write-Host "[SENSOR] auth handshake failed: $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
    }

    # Live loop. Every pass sends everything the Sysmon log gained after
    # the last processed EventRecordID (monotonic inside one log, so the
    # id is a complete bookmark: a reconnect re-sends the cut, never
    # loses it), then a heartbeat once a minute. An idle pass sleeps one
    # second. (The previous EventLogWatcher path called a method .NET
    # does not have, so every pass threw and reconnected.)
    $lastBeat = [datetime]::MinValue
    try {
        while ($true) {
            $batch = 0
            foreach ($rec in (Read-BacklogSince $lastRecordId)) {
                $xml = [xml]$rec.ToXml()
                $rid = 0
                if ($xml.Event.System.EventRecordID) { $rid = [long]$xml.Event.System.EventRecordID }
                if ($rid -gt $lastRecordId) { $lastRecordId = $rid }
                $data = @{}
                foreach ($d in $xml.Event.EventData.Data) {
                    if ($d.Name) { $data[$d.Name] = $d.'#text' }
                }
                $ev = ConvertFrom-SysmonRecord $rec.Id $data $rec.TimeCreated
                if ($null -eq $ev) { continue }
                Send-EventLine $writer $client $ev
                $sent++
                $batch++
                if (-not $Quiet) {
                    $detail = '-'
                    if ($ev.Contains('process') -and $ev['process']) { $detail = $ev['process']['name'] }
                    elseif ($ev.Contains('file') -and $ev['file']) { $detail = $ev['file']['path'] }
                    elseif ($ev.Contains('network') -and $ev['network']) { $detail = $ev['network']['destination_ip'] }
                    elseif ($ev.Contains('registry') -and $ev['registry']) { $detail = $ev['registry']['key'] }
                    Write-Host ('[SENSOR] {0,5} {1,-18} {2}' -f $sent, $ev['type'], $detail)
                }
            }
            # persistence bounds how much a hard crash can re-send
            if ($batch -gt 0) { Save-LastRecordId $lastRecordId }
            $now = Get-Date
            if (($now - $lastBeat).TotalSeconds -ge $HeartbeatSeconds) {
                # also detects a dead connection while the host is quiet
                Send-EventLine $writer $client (New-HeartbeatEvent $osLabel $sensorVersion $sensorStarted $now $sent)
                $lastBeat = $now
            }
            if ($batch -eq 0) { Start-Sleep -Seconds 1 }
        }
    } catch [Exception] {
        Write-Host "[SENSOR] stream interrupted: $($_.Exception.Message)"
        Write-Host "[SENSOR] reconnecting in $ReconnectSeconds s (the cut is covered by the record-id bookmark)..."
    } finally {
        # persist the exact resume point before tearing down
        Save-LastRecordId $lastRecordId
        $writer.Dispose()
        $client.Close()
    }
    Start-Sleep -Seconds $ReconnectSeconds
}

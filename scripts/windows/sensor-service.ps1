# sf-etw: the ETW sensor as a Windows service.
#
#   sf-etw                      status (same as -Status)
#   sf-etw -Install [-Addr host:port] [-Token <t> | -TokenFile <file>] [-TlsCa <ca.pem>]
#   sf-etw -Install -Addr host:port -EnrollToken <btenroll_...> -TlsCa <ca.pem>
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
# ProgramData\bluetardigrade-sensor, readable only by SYSTEM and
# Administrators. The token is read from a file there, so it never shows
# in the service's command line. -Install again updates the binary and
# the settings in place.
#
# The data used to live in ProgramData\bluetardigrade\sensor, which is
# also where a server install (install.ps1 -Server, root
# ProgramData\bluetardigrade) keeps the sensor's SOURCE crate: tokens,
# spool and log landed in the source tree and -Uninstall -Purge deleted
# the sources. -Install moves the data of an older service to the new
# directory; a directory that is a source tree is never touched.
#
# An engine on another machine needs -TlsCa: without TLS the token the
# sensor sends first (AUTH / ENROLL) and every event would cross the
# network in clear, so -Install refuses. -AllowPlaintextToken installs
# without TLS anyway (a lab, a link protected below).
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
    # install towards another machine without TLS (see the header)
    [switch]$AllowPlaintextToken,
    # set by the relaunch: keep the elevated window open on a failure
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'bluetardigrade-sensor'
$ProgramDir = Join-Path $env:ProgramFiles 'bluetardigrade\sensor'
$DataDir = Join-Path $env:ProgramData 'bluetardigrade-sensor'
# where the data lived before (see the header): migrated on -Install
$LegacyDataDir = Join-Path $env:ProgramData 'bluetardigrade\sensor'
# the files a sensor data directory holds; nothing else is ever moved
$SfDataFiles = @('ingest.token', 'enroll.token', 'ingest-ca.pem', 'spool.ndjson', 'spool.ndjson.draining', 'sensor.log', 'sensor.log.1')
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

# host:port, and nothing that could be read as another argument: the
# address goes unquoted into the service's command line.
function Test-SfAddr {
    param([string]$Addr)
    return [bool]($Addr -match '^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+):\d{1,5}$')
}

# Whether host:port names this machine. Any other name counts as remote.
function Test-SfLoopbackAddr {
    param([string]$Addr)
    return [bool]($Addr -match '^(127(\.\d{1,3}){3}|localhost|\[::1\]):\d{1,5}$')
}

# Whether the connection to the engine is protected, or does not leave
# the machine, or the operator accepted it in clear. KnownCa: CA files
# an earlier install left, which the service keeps using.
function Test-SfTransportProtected {
    param([string]$Addr, [string]$TlsCa, [bool]$AllowPlaintextToken, [string[]]$KnownCa = @())
    if ((Test-SfLoopbackAddr $Addr) -or $TlsCa -or $AllowPlaintextToken) { return $true }
    foreach ($ca in $KnownCa) {
        if ($ca -and (Test-Path -LiteralPath $ca -PathType Leaf)) { return $true }
    }
    return $false
}

# Absolute form of a path the user typed, relative to the PowerShell
# location (not to the process directory, which [IO.Path]::GetFullPath
# uses and which an interactive session rarely keeps in step).
function Resolve-SfFullPath {
    param([string]$Path)
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

# The arguments the elevated relaunch repeats. Everything the user gave
# must travel: a relaunch that forgot -TokenFile installed a service
# without its token and said nothing. File paths go absolute (the
# elevated process starts in another directory) and quoted, and a file
# that is not there fails here, before the UAC prompt.
function Get-SfElevatedArguments {
    param([string]$Action, [string]$Addr, [string]$TlsCa, [string]$TokenFile, [string]$EnrollTokenFile, [bool]$Purge, [bool]$AllowPlaintextToken)
    $forward = @("-$Action")
    if ($Action -eq 'Install') {
        if (-not (Test-SfAddr $Addr)) { throw "-Addr $Addr is not host:port" }
        $forward += @('-Addr', $Addr)
        foreach ($pair in @(@('-TlsCa', $TlsCa), @('-TokenFile', $TokenFile), @('-EnrollTokenFile', $EnrollTokenFile))) {
            if (-not $pair[1]) { continue }
            $full = Resolve-SfFullPath $pair[1]
            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "$($pair[0]) $($pair[1]): the file does not exist" }
            $forward += @($pair[0], "`"$full`"")
        }
        if ($AllowPlaintextToken) { $forward += '-AllowPlaintextToken' }
    }
    if ($Purge) { $forward += '-Purge' }
    return $forward
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

# ------------------------------------------------- privileged directories
# A directory whose contents end up running as SYSTEM or elevated must
# never be one an ordinary user prepared. ProgramData lets any local
# account create folders, so a pre-created root with a planted toolchain
# or with an ACE of its own would hand that account code execution (or
# the tokens) as soon as an administrator installs into it.
function Get-SfTrustedSids {
    # SYSTEM, Administrators, TrustedInstaller and the (already verified
    # elevated) account running this script.
    $sids = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($me) { $sids += $me.Value }
    return $sids
}

function Test-SfDirectoryTrusted {
    # -Strict: owner trusted, inheritance cut and every Allow ACE belongs
    # to a trusted SID (what this installer itself produces).
    # Without it: owner trusted and nobody else may delete or replace
    # children, change the ACL or take ownership (enough for a parent).
    param([string]$Path, [string[]]$TrustedSids = (Get-SfTrustedSids), [switch]$Strict)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $false }
    $sidType = [Security.Principal.SecurityIdentifier]
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if ($TrustedSids -notcontains $acl.GetOwner($sidType).Value) { return $false }
    if ($Strict -and -not $acl.AreAccessRulesProtected) { return $false }
    $dangerous = [Security.AccessControl.FileSystemRights]'Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
    foreach ($rule in $acl.GetAccessRules($true, $true, $sidType)) {
        if ($rule.AccessControlType -ne 'Allow' -or $TrustedSids -contains $rule.IdentityReference.Value) { continue }
        if ($Strict) { return $false }
        if ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
        if ($rule.FileSystemRights -band $dangerous) { return $false }
    }
    return $true
}

function Initialize-SfProtectedDirectory {
    # Creates Path already restricted to SYSTEM and Administrators (the
    # ACL is part of the creation, so there is no window with the
    # inherited one) or, when it exists, accepts it only in that state.
    param([string]$Path, [string[]]$TrustedSids = (Get-SfTrustedSids))
    if (-not (Test-Path -LiteralPath $Path)) {
        $parent = Split-Path -Parent $Path
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "The parent directory of $Path does not exist." }
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
        foreach ($sid in @('S-1-5-32-544', 'S-1-5-18')) {
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
        }
        try {
            if ('System.IO.FileSystemAclExtensions' -as [type]) { [void][IO.FileSystemAclExtensions]::CreateDirectory($acl, $Path) }
            else { [void][IO.Directory]::CreateDirectory($Path, $acl) }
        } catch {
            # Without the privilege to assign another owner (tests, odd
            # policies) the directory keeps the creator as owner.
            $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
            if ('System.IO.FileSystemAclExtensions' -as [type]) { [void][IO.FileSystemAclExtensions]::CreateDirectory($acl, $Path) }
            else { [void][IO.Directory]::CreateDirectory($Path, $acl) }
        }
    }
    if (-not (Test-SfDirectoryTrusted -Path $Path -TrustedSids $TrustedSids -Strict)) {
        throw "$Path already exists and is not restricted to SYSTEM and Administrators (owner, inherited permissions or an entry for another account). It may have been prepared by another user: inspect it and remove it, or choose another directory."
    }
}

# Whether Path is a sensor data directory left by an older install:
# it holds sensor data, it is not a source tree (a server install keeps
# the sensor crate at this very path) and it is still restricted to
# SYSTEM and Administrators, the state the installer created it in.
function Test-SfLegacyDataDir {
    param([string]$Path, [string[]]$TrustedSids = (Get-SfTrustedSids))
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    foreach ($source in @('Cargo.toml', 'Cargo.lock', 'src')) {
        if (Test-Path -LiteralPath (Join-Path $Path $source)) { return $false }
    }
    $data = @('ingest.token', 'enroll.token', 'spool.ndjson', 'sensor.log') | Where-Object { Test-Path -LiteralPath (Join-Path $Path $_) -PathType Leaf }
    if (-not $data) { return $false }
    try { return (Test-SfDirectoryTrusted -Path $Path -TrustedSids $TrustedSids -Strict) } catch { return $false }
}

# Moves the data files of an older install into Target (which already
# exists, protected). A file Target already has is left where it is: the
# new location wins. Returns the names moved; the old directory goes
# when nothing is left in it.
function Move-SfLegacyDataDir {
    param([string]$Legacy, [string]$Target, [string[]]$TrustedSids = (Get-SfTrustedSids))
    if (-not (Test-SfLegacyDataDir -Path $Legacy -TrustedSids $TrustedSids)) { return @() }
    $moved = @()
    foreach ($name in $SfDataFiles) {
        $from = Join-Path $Legacy $name
        if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { continue }
        if ((Get-Item -LiteralPath $from -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $to = Join-Path $Target $name
        if (Test-Path -LiteralPath $to) { continue }
        Move-Item -LiteralPath $from -Destination $to
        $moved += $name
    }
    if (-not (Get-ChildItem -LiteralPath $Legacy -Force)) { Remove-Item -LiteralPath $Legacy -Force }
    return $moved
}

function Install-SfSensorService {
    $source = Join-Path $root 'bin\security-sensor.exe'
    if (-not (Test-Path -LiteralPath $source)) {
        throw 'bin\security-sensor.exe was not found: install or update bluetardigrade with the sensor first.'
    }
    if (-not (Test-SfAddr $Addr)) { throw "-Addr $Addr is not host:port" }
    # Checked before anything is stopped or copied. A CA an earlier
    # install left (here, or in the old data directory about to be
    # migrated) keeps the connection on TLS.
    $knownCa = @((Join-Path $DataDir 'ingest-ca.pem'))
    if (Test-SfLegacyDataDir -Path $LegacyDataDir) { $knownCa += (Join-Path $LegacyDataDir 'ingest-ca.pem') }
    if (-not (Test-SfTransportProtected -Addr $Addr -TlsCa $TlsCa -AllowPlaintextToken ([bool]$AllowPlaintextToken) -KnownCa $knownCa)) {
        throw "refusing to install: $Addr is another machine and no -TlsCa was given. Without TLS the token the sensor sends first (AUTH or ENROLL) and every event would cross the network in clear. Copy the engine's certificate to this machine and add -TlsCa <ingest-cert.pem>. Nothing was changed. (-AllowPlaintextToken installs without TLS anyway: only for a lab or a link that is already protected.)"
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

    New-Item -ItemType Directory -Force -Path $ProgramDir | Out-Null
    Copy-Item -LiteralPath $source -Destination $SensorExe -Force
    # The data directory holds the tokens and the CA the service trusts,
    # and SYSTEM writes its spool and log there: SYSTEM and Administrators
    # only (by SID: group names are localized), from the moment it
    # exists. One that is already there with another owner or with an
    # entry for another account is refused instead of being trusted.
    $dataParent = Split-Path -Parent $DataDir
    if (-not (Test-Path -LiteralPath $dataParent)) { New-Item -ItemType Directory -Path $dataParent | Out-Null }
    if (-not (Test-SfDirectoryTrusted -Path $dataParent)) { throw "$dataParent is owned or controlled by an unprivileged account: inspect it and remove it before installing the service." }
    Initialize-SfProtectedDirectory -Path $DataDir
    # the service is stopped: its old data directory can move
    $migrated = @(Move-SfLegacyDataDir -Legacy $LegacyDataDir -Target $DataDir)
    if ($migrated.Count -gt 0) {
        Write-Host "  [ok] moved the sensor data from $LegacyDataDir to $DataDir ($($migrated -join ', '))"
    } elseif ((Test-Path -LiteralPath $LegacyDataDir -PathType Container) -and -not (Test-SfLegacyDataDir -Path $LegacyDataDir)) {
        $stray = @($SfDataFiles | Where-Object { Test-Path -LiteralPath (Join-Path $LegacyDataDir $_) -PathType Leaf })
        if ($stray.Count -gt 0) {
            Write-Host "  [!] $LegacyDataDir holds sensor data ($($stray -join ', ')) but is a source tree or is not restricted to SYSTEM and Administrators: it was NOT migrated. The service now uses $DataDir; move or delete those files by hand." -ForegroundColor Yellow
        }
    }

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
    if (-not $TlsCa -and (Test-SfLoopbackAddr $Addr)) {
        # with its certificate in place the engine of this install speaks
        # only TLS: the local sensor trusts exactly that certificate
        $localCert = Join-Path $root 'tools\config\ingest-cert.pem'
        if (Test-Path -LiteralPath $localCert) { $TlsCa = $localCert }
    }
    if ($TlsCa) { Copy-Item -LiteralPath $TlsCa -Destination $caPath -Force }

    $arguments = "--service --addr $Addr --spool `"$DataDir\spool.ndjson`" --log `"$DataDir\sensor.log`""
    if ($enrolling -or (Test-Path -LiteralPath $tokenPath)) { $arguments += " --token-file `"$tokenPath`"" }
    if ($enrolling) { $arguments += " --enroll-token-file `"$enrollPath`"" }
    if (Test-Path -LiteralPath $caPath) { $arguments += " --tls-ca `"$caPath`"" }
    elseif ($AllowPlaintextToken -and -not (Test-SfLoopbackAddr $Addr)) { $arguments += ' --allow-plaintext-token' }
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
    $recovery = ($LASTEXITCODE -eq 0)
    # Without the failure-actions flag those actions only apply to a
    # process that dies without a word. The sensor reports its errors
    # (SERVICE_STOPPED with an exit code), which the service manager then
    # takes for a normal stop: it would stay stopped.
    & sc.exe failureflag $ServiceName 1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $recovery = $false }
    Start-Service $ServiceName
    if (-not (Wait-SfServiceState 'Running' 20)) { throw 'the service did not reach Running; see the log below' }
    if ($recovery) {
        Write-Host "  [ok] service $ServiceName running (starts with Windows, restarts if it fails)"
    } else {
        Write-Host "  [ok] service $ServiceName running (starts with Windows)"
        Write-Host "  [!] the restart-on-failure settings could not be applied (sc.exe failure / failureflag): the service will not restart by itself" -ForegroundColor Yellow
    }
    $auth = 'none'
    if ($enrolling) {
        $auth = 'enrolling (the host then waits for approval in Equipos)'
    } elseif ($current.StartsWith('btsensor_') -and -not $value) {
        $auth = 'its own credential (enrolled)'
    } elseif (Test-Path -LiteralPath $tokenPath) {
        $auth = 'from ' + $tokenPath
    }
    Write-Host "  engine: $Addr   auth: $auth   TLS: $(if (Test-Path -LiteralPath $caPath) { 'verified with ' + $caPath } else { 'off' })"
    if (-not (Test-Path -LiteralPath $caPath) -and -not (Test-SfLoopbackAddr $Addr)) {
        Write-Host "  [!] no TLS towards $Addr (-AllowPlaintextToken): the token and the events travel in clear" -ForegroundColor Yellow
    }
}

function Uninstall-SfSensorService {
    $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -ne 'Stopped') {
            Stop-Service $ServiceName -Force
            # deleting a service that is still stopping leaves its
            # binary locked and the files below in place
            if (-not (Wait-SfServiceState 'Stopped' 30)) { throw "the service $ServiceName did not stop within 30 s; nothing was removed. Run sf-etw -Uninstall again in a moment." }
        }
        & sc.exe delete $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "sc.exe delete $ServiceName failed (exit $LASTEXITCODE); nothing was removed" }
        if (Wait-SfServiceState 'Gone' 15) {
            Write-Host "  [ok] service $ServiceName removed"
        } else {
            Write-Host "  [!] service $ServiceName is marked for deletion but still listed: it goes when the last handle on it closes (close services.msc / Task Manager) or at the next boot" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  the service $ServiceName is not installed"
    }
    # a sensor that did not stop cleanly leaves its ETW sessions in the kernel
    $sessions = @(Stop-SfEtwSessions)
    if ($sessions.Count -gt 0) {
        Write-Host "  [!] ETW sessions still running: $($sessions -join ', '). Stop each one with: logman stop <name> -ets" -ForegroundColor Yellow
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
    # The data directory of an older install, when it was never migrated.
    # Only its data files, and only when it is a data directory: a server
    # install keeps the sensor's source crate at this same path.
    if (Test-SfLegacyDataDir -Path $LegacyDataDir) {
        if ($Purge) {
            foreach ($name in $SfDataFiles) {
                $old = Join-Path $LegacyDataDir $name
                if (Test-Path -LiteralPath $old -PathType Leaf) { Remove-Item -LiteralPath $old -Force }
            }
            if (-not (Get-ChildItem -LiteralPath $LegacyDataDir -Force)) { Remove-Item -LiteralPath $LegacyDataDir -Force }
            Write-Host "  [ok] sensor data of an older install removed from $LegacyDataDir"
        } else {
            Write-Host "  kept $LegacyDataDir (data of an older install); -Purge removes it"
        }
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

# Whether Path is one of the temp files Invoke-SfElevated writes a token
# to. Only those are deleted afterwards: a -TokenFile the user keeps
# under %TEMP% is theirs.
function Test-SfRelaunchTokenFile {
    param([string]$Path)
    if (-not $Path -or -not $env:TEMP) { return $false }
    if (-not $Path.StartsWith($env:TEMP, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    return [bool]((Split-Path -Leaf $Path) -match '^sf-etw-(token|enroll)-[0-9a-f]{32}\.txt$')
}

# Dot-sourcing the script only defines its functions (the checks in
# scripts\dev-tests exercise them against temp directories).
if ($MyInvocation.InvocationName -ne '.') {

$action = if ($Install) { 'Install' } elseif ($Uninstall) { 'Uninstall' } elseif ($Start) { 'Start' } elseif ($Stop) { 'Stop' } elseif ($Restart) { 'Restart' } else { 'Status' }

if ($action -ne 'Status' -and -not (Test-SfAdmin)) {
    try {
        # a token on the command line travels in a temp file (Invoke-SfElevated)
        $tokenFileArg = $TokenFile
        if ($Token) { $tokenFileArg = '' }
        $enrollFileArg = $EnrollTokenFile
        if ($EnrollToken) { $enrollFileArg = '' }
        $forward = Get-SfElevatedArguments -Action $action -Addr $Addr -TlsCa $TlsCa -TokenFile $tokenFileArg -EnrollTokenFile $enrollFileArg -Purge ([bool]$Purge) -AllowPlaintextToken ([bool]$AllowPlaintextToken)
        Invoke-SfElevated $forward
    } catch {
        Write-Host "  [!] $($_.Exception.Message)" -ForegroundColor Yellow
        exit 1
    }
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
        if ((Test-SfRelaunchTokenFile $f) -and (Test-Path -LiteralPath $f)) {
            Remove-Item -LiteralPath $f -Force
        }
    }
}

}

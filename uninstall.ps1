# ======================================================================
# bluetardigrade uninstaller for Windows PowerShell 5.1+
#
#   sf-uninstall          (if installed - recommended)
#
#   irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/uninstall.ps1 | iex
#
# Removes: running processes, logon entries (HKCU Run + legacy scheduled
# tasks), the firewall rule, the user PATH entry and the whole install
# directory (binaries, rules, web console and the portable Go/Node/Bun
# tools inside it).
#
# Keeps:   any system-wide toolchain you had before (Go, Node, Bun,
#          Rust/MSVC) - the uninstaller never touches third-party tools.
# ======================================================================
param(
    [string]$InstallDir = ''
)

$ErrorActionPreference = 'Continue'

function Write-Ok($m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Write-Warn2($m){ Write-Host "    [!]  $m" -ForegroundColor Yellow }
function Write-Info($m) { Write-Host "    $m" }

function Assert-SfRemovalTree {
    param([string]$Root)
    $ancestor = $Root
    while ($ancestor) {
        $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to uninstall through a junction or symbolic link.' }
        $parent = Split-Path -Parent $ancestor
        if ($parent -eq $ancestor) { break }
        $ancestor = $parent
    }
    $queue = New-Object 'System.Collections.Generic.Queue[string]'
    $queue.Enqueue($Root)
    while ($queue.Count -gt 0) {
        foreach ($item in (Get-ChildItem -LiteralPath ($queue.Dequeue()) -Force -ErrorAction Stop)) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation contains a junction/symbolic link; remove the link explicitly before uninstalling. No recursive deletion was attempted.' }
            if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
        }
    }
}

function Assert-SfServerRemovalAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Removing server boot tasks requires elevated PowerShell; no installation files were deleted.' }
}

function Remove-SfServerBootTasks {
    param([string]$Root)
    # Inspect ownership independently of server.json, so even a partial setup
    # or a manually removed configuration marker cannot orphan SYSTEM tasks.
    $tasks = @()
    foreach ($component in @('engine', 'hub', 'console', 'sysmon', 'etw')) {
        $errors = @()
        $task = Get-ScheduledTask -TaskPath '\' -TaskName ('bluetardigrade-server-' + $component) -ErrorAction SilentlyContinue -ErrorVariable errors
        foreach ($entry in $errors) {
            if ($entry.CategoryInfo.Category -ne 'ObjectNotFound') { throw 'Cannot verify server task ownership; installation was kept.' }
        }
        if ($task -and $task.Description -eq ('bluetardigrade server root=' + $Root)) { $tasks += $task }
    }
    if ($tasks.Count -eq 0) { return }
    Assert-SfServerRemovalAdmin
    foreach ($task in $tasks) {
        Stop-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -Confirm:$false -ErrorAction Stop
        Write-Ok "removed server boot task $($task.TaskName)"
        # the task was ended without a Ctrl+C: its sensor could not stop
        # its own ETW sessions
        if ($task.TaskName -eq 'bluetardigrade-server-etw') { Stop-SfEtwSessions }
    }
}

# The ETW sensor's sessions live in the kernel, not in its process: a
# sensor that is killed (a stopped task, a service deleted while it
# stops) leaves them consuming buffers until the next boot. Stopped by
# name once no sensor process is left (while one runs they are its own);
# a session that is not running is not an error. Says which ones are
# still there (stopping them needs elevation). The names are the ones in
# sensor\src\collector\config.rs.
function Stop-SfEtwSessions {
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Process -Name 'security-sensor' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if (Get-Process -Name 'security-sensor' -ErrorAction SilentlyContinue) { return }
    $left = @()
    foreach ($name in @('bluetardigrade-sensor-netreg', 'bluetardigrade-sensor-file', 'bluetardigrade-sensor')) {
        # logman reports "not found" on stdout with a non-zero exit code
        & logman.exe stop $name -ets | Out-Null
        & logman.exe query $name -ets | Out-Null
        if ($LASTEXITCODE -eq 0) { $left += $name }
    }
    if ($left.Count -gt 0) {
        Write-Warn2 "ETW sessions still running: $($left -join ', '). From an elevated terminal: logman stop <name> -ets"
    }
}

function Wait-SfSensorServiceStopped {
    param([int]$Seconds = 30)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $svc = Get-Service 'bluetardigrade-sensor' -ErrorAction SilentlyContinue
        if (-not $svc -or $svc.Status -eq 'Stopped') { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# The ETW sensor service runs a copy under Program Files as SYSTEM: it
# must go before the install directory, and removing it needs elevation.
# Each step is checked: a service still stopping keeps its binary locked,
# and announcing "removed" over files that are still there would hide it.
function Remove-SfSensorService {
    $svc = Get-Service 'bluetardigrade-sensor' -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'The ETW sensor runs as a Windows service: remove it first with "sf-etw -Uninstall" (it asks for administrator), then run sf-uninstall again.'
    }
    if ($svc.Status -ne 'Stopped') {
        Stop-Service 'bluetardigrade-sensor' -Force -ErrorAction SilentlyContinue
        if (-not (Wait-SfSensorServiceStopped 30)) { throw 'the service bluetardigrade-sensor did not stop within 30 s; try again in a moment' }
    }
    & sc.exe delete 'bluetardigrade-sensor' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe delete bluetardigrade-sensor failed (exit $LASTEXITCODE)" }
    Stop-SfEtwSessions
    $program = Join-Path $env:ProgramFiles 'bluetardigrade\sensor'
    if (Test-Path -LiteralPath $program) { Remove-Item -LiteralPath $program -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $program) {
        Write-Warn2 "the ETW sensor service was deleted, but its files are still in $program (in use?): delete that folder by hand"
    } else {
        Write-Ok 'removed the ETW sensor service and its binary'
    }
    $dataDirs = @(@((Join-Path $env:ProgramData 'bluetardigrade-sensor'), (Join-Path $env:ProgramData 'bluetardigrade\sensor')) | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'sensor.log') })
    if ($dataDirs.Count -gt 0) { Write-Info "its data (spool, log, token) stays in $($dataDirs -join ', '); delete it by hand if you do not need it" }
}

function Remove-LogonEntries {
    foreach ($v in @('security-framework-engine', 'security-framework-console')) {
        try {
            $rk = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
            if (Get-ItemProperty -Path $rk -Name $v -ErrorAction SilentlyContinue) {
                Remove-ItemProperty -Path $rk -Name $v -Force
                Write-Ok "removed logon entry $v (HKCU Run)"
            }
        } catch { }
    }
}

function Stop-SfProcesses {
    param([string]$Root)
    # trailing separator required: a plain StartsWith(prefix) would also
    # match unrelated installs whose directory NAME extends this one
    # (e.g. 'security-framework-backup') and stop their processes too.
    # ExecutablePath always points to a file inside the install root,
    # so 'root\' is the correct, strictly narrower prefix.
    $rootLow = $Root.ToLower().TrimEnd('\') + '\'
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith($rootLow)
        } | ForEach-Object {
            Write-Info "stopping $($_.Name) (pid $($_.ProcessId))"
            try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
        }
    } catch { }
    $runDir = Join-Path $Root 'run'
    if (Test-Path $runDir) {
        Get-ChildItem $runDir -Filter *.pid -ErrorAction SilentlyContinue | ForEach-Object {
            $rawPID = Get-Content $_.FullName -First 1 -ErrorAction SilentlyContinue
            $reportedPID = 0
            if ($rawPID -and [int]::TryParse($rawPID.Trim(), [ref]$reportedPID) -and $reportedPID -gt 0 -and $reportedPID -ne $PID) {
                # A stale PID can now belong to an unrelated process. Verify
                # its executable or command line still belongs to this install.
                $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $reportedPID" -ErrorAction SilentlyContinue
                $owned = $candidate -and (
                    ($candidate.ExecutablePath -and $candidate.ExecutablePath.ToLower().StartsWith($rootLow)) -or
                    ($candidate.CommandLine -and $candidate.CommandLine.ToLower().Contains($rootLow)))
                if ($owned) { Stop-Process -Id $reportedPID -Force -ErrorAction SilentlyContinue }
                elseif ($candidate) { Write-Warn2 "stale PID $reportedPID belongs to another process; it was left running" }
            }
            Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
    foreach ($t in @('security-framework-engine', 'security-framework-console')) {
        try {
            if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
                Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
                Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue
                Write-Ok "removed scheduled task $t"
            }
        } catch { }
    }
    Remove-LogonEntries
}

# Reading the rule needs no elevation, deleting it does: an uninstall
# from a normal terminal used to leave inbound TCP 7777 open without a
# word. Returns 'absent', 'removed' or 'kept'.
function Remove-FirewallRule {
    $rule = 'name=security-framework engine'
    try {
        netsh advfirewall firewall show rule $rule | Out-Null
        if ($LASTEXITCODE -ne 0) { return 'absent' }
        netsh advfirewall firewall delete rule $rule | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok 'firewall rule removed'
            return 'removed'
        }
    } catch { }
    Write-Warn2 'the inbound firewall rule "security-framework engine" (TCP 7777) is STILL in place: removing it needs administrator rights.'
    Write-Info '  from an elevated terminal:  netsh advfirewall firewall delete rule name="security-framework engine"'
    return 'kept'
}

# The user PATH is read and written through the registry API, like the
# installer does (install.ps1, Get-UserPathRaw): reg.exe output is
# decoded with the console code page, so a folder with an accent came
# back garbled and was written back that way, and 'reg add' re-parses the
# value as a command-line argument. -KeyPath lets the checks use a
# scratch key.
function Get-UserPathRaw {
    param([string]$KeyPath = 'Environment')
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($KeyPath)
    if (-not $key) { return $null }
    try { return $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    finally { $key.Close() }
}

function Set-UserPathRaw {
    param([string]$Value, [string]$KeyPath = 'Environment')
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($KeyPath)
    try {
        if ($Value) { $key.SetValue('Path', $Value, [Microsoft.Win32.RegistryValueKind]::ExpandString) }
        else { $key.DeleteValue('Path', $false) }
    } finally { $key.Close() }
    if ($KeyPath -eq 'Environment') {
        # broadcast WM_SETTINGCHANGE so new terminals see the change
        [Environment]::SetEnvironmentVariable('BLUETARDIGRADE_PATH_REFRESH', '1', 'User')
        [Environment]::SetEnvironmentVariable('BLUETARDIGRADE_PATH_REFRESH', $null, 'User')
    }
}

function Remove-FromUserPath {
    param([string]$Dir, [string]$KeyPath = 'Environment')
    $dirLow = $Dir.TrimEnd('\').ToLower()
    try { $raw = Get-UserPathRaw -KeyPath $KeyPath }
    catch { Write-Warn2 "could not read user PATH: $($_.Exception.Message)"; return }
    if (-not $raw) { return }
    $raw = [string]$raw
    $kept = @($raw -split ';' | Where-Object {
        $_ -and ([Environment]::ExpandEnvironmentVariables($_).Trim().TrimEnd('\').ToLower()) -ne $dirLow
    })
    $new = $kept -join ';'
    if ($new -ne $raw) {
        try {
            Set-UserPathRaw -Value $new -KeyPath $KeyPath
            Write-Ok "removed from user PATH (already-open terminals keep it until reopened)"
        } catch { Write-Warn2 "PATH cleanup failed: $($_.Exception.Message)" }
    }
}

if ($MyInvocation.InvocationName -ne '.') {

    if (-not $InstallDir) {
        $base = $env:LOCALAPPDATA
        if (-not $base) { $base = $env:USERPROFILE }
        if (-not $base) { throw 'Set -InstallDir: LOCALAPPDATA and USERPROFILE are unavailable.' }
        $InstallDir = Join-Path $base 'bluetardigrade'
    }
    $root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\', '/')
    foreach ($blocked in @([IO.Path]::GetPathRoot($root), $env:USERPROFILE, $env:LOCALAPPDATA, $env:SystemRoot, [IO.Path]::GetTempPath())) {
        if ($blocked -and $root -ieq ([IO.Path]::GetFullPath($blocked).TrimEnd('\', '/'))) { throw 'Refusing to uninstall a profile, system folder or drive root.' }
    }
    if ((Test-Path $root) -and -not (Test-Path (Join-Path $root 'install.ps1'))) { throw 'Directory is not a bluetardigrade installation; nothing was removed.' }
    if (Test-Path -LiteralPath $root) { Assert-SfRemovalTree $root }
    # Never delete privileged task code while SYSTEM entries remain. This
    # also removes owned tasks when the install directory is already absent.
    try { Remove-SfSensorService }
    catch { throw "The sensor service could not be removed; installation was kept: $($_.Exception.Message)" }
    try { Remove-SfServerBootTasks $root }
    catch { throw "Server boot tasks could not be removed; installation was kept: $($_.Exception.Message)" }

    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' bluetardigrade uninstaller'
    Write-Host " target : $root"
    Write-Host '============================================================'

    if (Test-Path $root) {
        Write-Host ''
        Write-Host '==> stopping processes and tasks'
        Stop-SfProcesses -Root $root
        $firewall = Remove-FirewallRule

        Write-Host ''
        Write-Host '==> removing install directory'
        Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $root) {
            Start-Sleep -Seconds 2
            Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $root) {
            Write-Warn2 "some files could not be deleted (a terminal may be inside the folder)"
            Write-Info "close it and run this uninstaller again"
        } else {
            Write-Ok "$root removed"
        }
    } else {
        Write-Info "$root not found (already removed?)"
        $firewall = Remove-FirewallRule
        foreach ($t in @('security-framework-engine', 'security-framework-console')) {
            try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch { }
        }
        Remove-LogonEntries
    }

    Write-Host ''
    Write-Host '==> cleaning user PATH'
    Remove-FromUserPath -Dir (Join-Path $root 'bin')

    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' uninstall complete'
    if ($firewall -eq 'kept') {
        Write-Host ' - the firewall rule for TCP 7777 is still there (see above):' -ForegroundColor Yellow
        Write-Host '   it needs an elevated terminal to be removed' -ForegroundColor Yellow
    }
    Write-Host ' - portable Go / Node / Bun went with the install folder'
    Write-Host ' - toolchains you had before (Rust, MSVC, system Go...) are'
    Write-Host '   untouched; remove them with winget if you want'
    Write-Host '============================================================'
}

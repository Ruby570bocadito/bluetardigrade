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

function Remove-FirewallRule {
    try {
        $out = netsh advfirewall firewall delete rule "name=security-framework engine"
        if ($LASTEXITCODE -eq 0) { Write-Ok "firewall rule removed" }
    } catch { }
}

function Remove-FromUserPath {
    param([string]$Dir)
    $dirLow = $Dir.TrimEnd('\').ToLower()
    $raw = $null
    try {
        $q = reg query HKCU\Environment /v Path
        if ($q) {
            foreach ($l in $q) {
                if ($l -match '^\s*Path\s+REG_(EXPAND_)?SZ\s+(.*)$') { $raw = $Matches[2] }
            }
        }
    } catch { }
    if (-not $raw) { return }
    $kept = $raw -split ';' | Where-Object {
        $_ -and ([Environment]::ExpandEnvironmentVariables($_).TrimEnd('\').ToLower()) -ne $dirLow
    }
    $new = $kept -join ';'
    if ($new -ne $raw) {
        try {
            if ($new -eq '') {
                reg delete HKCU\Environment /v Path /f | Out-Null
            } else {
                reg add HKCU\Environment /v Path /t REG_EXPAND_SZ /d $new /f | Out-Null
            }
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

    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' bluetardigrade uninstaller'
    Write-Host " target : $root"
    Write-Host '============================================================'

    if (Test-Path $root) {
        Write-Host ''
        Write-Host '==> stopping processes and tasks'
        Stop-SfProcesses -Root $root
        Remove-FirewallRule

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
        Remove-FirewallRule
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
    Write-Host ' - portable Go / Node / Bun went with the install folder'
    Write-Host ' - toolchains you had before (Rust, MSVC, system Go...) are'
    Write-Host '   untouched; remove them with winget if you want'
    Write-Host '============================================================'
}

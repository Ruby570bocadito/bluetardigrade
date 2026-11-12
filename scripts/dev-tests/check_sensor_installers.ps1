# Behavior checks for the sensor installers on Windows. Safe on a developer
# machine and without elevation: the scripts are dot-sourced (which only
# defines their functions), the data-directory logic runs against a temp
# directory, the user PATH logic against a scratch registry key
# (HKCU\Software\BluetardigradeSensorInstallerTest), and the command shims
# are generated into a temp install whose scripts are stubs. No service,
# task, firewall rule, PATH entry or ProgramData directory is touched.
param([string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this check on native Windows PowerShell 5.1 or newer.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('sf-sensor-installers-' + [guid]::NewGuid().ToString('N'))
$scratchRoot = 'Software\BluetardigradeSensorInstallerTest'
$scratchKey = $scratchRoot + '\Environment'
$checks = 0
$originalTemp = $env:TEMP
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Check($Name, [scriptblock]$Body) { & $Body; $script:checks++; Write-Host "PASS: $Name" }
function Read-Scratch {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($scratchKey)
    try {
        if ($key.GetValueNames() -notcontains 'Path') { return $null }
        return @{ Raw = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'); Kind = $key.GetValueKind('Path') }
    } finally { $key.Close() }
}
function Throws([scriptblock]$Body) {
    try { & $Body | Out-Null } catch { return $_.Exception.Message }
    return $null
}
# a profile name with letters outside ASCII (built from code points: this
# file stays ASCII so it reads the same under any code page)
$accented = 'Jos' + [char]0xE9 + ' Mu' + [char]0xF1 + 'oz'
try {
    New-Item -ItemType Directory $work -Force | Out-Null

    # ------------------------------------------------------------ shims
    . (Join-Path $RepoRoot 'install.ps1')
    function Write-Ok($m) { }
    function Write-Warn2($m) { $script:warned = $m }
    function Write-Info($m) { }

    $installRoot = Join-Path $work ($accented + '\bluetardigrade')
    $shimScripts = Join-Path $installRoot 'scripts'
    New-Item -ItemType Directory $shimScripts -Force | Out-Null
    $marker = Join-Path $work 'shim-marker.txt'
    # Stubs in place of the real scripts: each one only records where it
    # ran from and what it was given.
    $stub = '[IO.File]::WriteAllText($env:SF_SHIM_MARKER, ($PSScriptRoot + "|" + ($args -join " ")), [Text.Encoding]::UTF8)'
    foreach ($name in @('sf-stack.ps1', 'sf-console.ps1', 'sensor.ps1', 'sensor-service.ps1')) {
        Set-Content -LiteralPath (Join-Path $shimScripts $name) -Value $stub -Encoding ASCII
    }
    $stubWithDir = 'param([string]$InstallDir, [switch]$Update, [string]$Repo, [string]$Branch)' + "`r`n" +
        '[IO.File]::WriteAllText($env:SF_SHIM_MARKER, ([IO.Path]::GetFullPath($InstallDir) + "|" + $Update + "|" + $Repo + "|" + $Branch), [Text.Encoding]::UTF8)'
    foreach ($name in @('install.ps1', 'uninstall.ps1')) {
        Set-Content -LiteralPath (Join-Path $shimScripts $name) -Value $stubWithDir -Encoding ASCII
    }
    $script:warned = $null
    Write-Shims -Root $installRoot -RepoId 'example/bluetardigrade' -Ref 'main'
    $binDir = Join-Path $installRoot 'bin'
    # the driver sets the console code page and then runs the shim named
    # by an environment variable (expanded by cmd without any code page)
    $driver = Join-Path $work 'run-shim.cmd'
    Set-Content -LiteralPath $driver -Encoding ASCII -Value "@echo off`r`nchcp %1 >nul`r`ncall `"%SF_SHIM%`" %2`r`n"
    $env:SF_SHIM_MARKER = $marker
    # sf-update / sf-uninstall copy themselves to %TEMP%: keep that in the sandbox
    $shimTemp = Join-Path $work 'shim-temp'
    New-Item -ItemType Directory $shimTemp -Force | Out-Null
    $env:TEMP = $shimTemp
    function Invoke-Shim([string]$Name, [int]$CodePage, [string]$Argument) {
        Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
        $env:SF_SHIM = Join-Path $binDir $Name
        $p = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', "`"$driver`" $CodePage $Argument") -WindowStyle Hidden -Wait -PassThru
        if (-not (Test-Path -LiteralPath $marker)) { return "(the shim did not reach its script; cmd exit $($p.ExitCode))" }
        return [IO.File]::ReadAllText($marker, [Text.Encoding]::UTF8)
    }

    Check 'the command shims are pure ASCII and carry no absolute path' {
        Assert ($script:warned -notmatch 'non-ASCII') "Write-Shims warned: $script:warned"
        foreach ($shim in (Get-ChildItem -LiteralPath $binDir -Filter '*.cmd')) {
            $bytes = [IO.File]::ReadAllBytes($shim.FullName)
            Assert (-not ($bytes | Where-Object { $_ -gt 127 })) "$($shim.Name) contains non-ASCII bytes"
            $text = [Text.Encoding]::ASCII.GetString($bytes)
            Assert ($text -notmatch [regex]::Escape($work)) "$($shim.Name) embeds the install path"
            Assert ($text -match '%~dp0|%~2') "$($shim.Name) does not locate the install from its own path"
        }
    }
    Check 'a shim under a profile with accents runs its script under any console code page' {
        foreach ($cp in @(437, 850, 1252, 65001)) {
            $got = Invoke-Shim 'sf-status.cmd' $cp 'probe'
            Assert ($got -eq ($shimScripts + '|-Status probe')) "code page ${cp}: sf-status ran '$got', expected '$shimScripts|-Status probe'"
        }
        $got = Invoke-Shim 'sf-etw.cmd' 850 '-Status'
        Assert ($got -eq ($shimScripts + '|-Status')) "sf-etw ran '$got'"
    }
    Check 'sf-update and sf-uninstall, which run from a copy in TEMP, still name the install' {
        $got = Invoke-Shim 'sf-update.cmd' 850 ''
        Assert ($got -eq ($installRoot + '|True|example/bluetardigrade|main')) "sf-update ran '$got'"
        $got = Invoke-Shim 'sf-uninstall.cmd' 437 ''
        Assert ($got -like ($installRoot + '|*')) "sf-uninstall ran '$got'"
        Assert (Test-Path -LiteralPath (Join-Path $shimTemp 'sf-uninstall.ps1')) 'sf-uninstall did not copy the uninstaller out of the install first'
    }
    $env:TEMP = $originalTemp

    Check 'the firewall hint printed for a manual run keeps the rule off public networks' {
        $source = Get-Content -LiteralPath (Join-Path $RepoRoot 'install.ps1') -Raw
        $manual = @([regex]::Matches($source, 'Write-Info "netsh [^\r\n]*add rule[^\r\n]*') | ForEach-Object { $_.Value })
        foreach ($line in $manual) { Assert ($line -match 'profile=') "manual firewall command without a profile: $line" }
        Assert ($source -match 'Write-Info "netsh \$netshArgs"') 'the manual hint no longer prints the command the installer runs'
        Assert ($source -match '\$netshArgs = "[^\r\n]*profile=\$profiles') 'the installer rule lost its profile restriction'
    }

    # ----------------------------------------------------- uninstall PATH
    . (Join-Path $RepoRoot 'uninstall.ps1')
    $ErrorActionPreference = 'Stop'   # uninstall.ps1 runs with Continue
    function Write-Ok($m) { }
    function Write-Warn2($m) { $script:warned = $m }
    function Write-Info($m) { }
    $mine = Join-Path $installRoot 'bin'
    $other = 'C:\Users\' + $accented + '\tools'

    Check 'the uninstaller removes only its PATH entry and keeps accents and %VARIABLES% intact' {
        Set-UserPathRaw -KeyPath $scratchKey -Value "%SystemRoot%\system32;$other;$mine\;%USERPROFILE%\.cargo\bin"
        Remove-FromUserPath -Dir $mine -KeyPath $scratchKey
        $after = Read-Scratch
        Assert ($after.Raw -eq "%SystemRoot%\system32;$other;%USERPROFILE%\.cargo\bin") "unexpected PATH: $($after.Raw)"
        Assert ($after.Kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) "PATH lost REG_EXPAND_SZ: $($after.Kind)"
    }
    Check 'a PATH without the install is left alone, and the last entry removes the value' {
        $before = (Read-Scratch).Raw
        Remove-FromUserPath -Dir $mine -KeyPath $scratchKey
        Assert ((Read-Scratch).Raw -eq $before) 'PATH changed although the install was not in it'
        Set-UserPathRaw -KeyPath $scratchKey -Value $mine
        Remove-FromUserPath -Dir $mine -KeyPath $scratchKey
        Assert ($null -eq (Read-Scratch)) 'an emptied PATH value was not removed'
    }
    Check 'the uninstaller no longer goes through reg.exe for the PATH' {
        $source = Get-Content -LiteralPath (Join-Path $RepoRoot 'uninstall.ps1') -Raw
        Assert ($source -notmatch '(?m)^[^#\r\n]*\breg (query|add|delete)\b') 'uninstall.ps1 still calls reg.exe'
    }

    # ------------------------------------------------ sensor-service.ps1
    . (Join-Path $RepoRoot 'scripts\windows\sensor-service.ps1')

    Check 'the service data directory is not the sensor source crate of a server install' {
        $serverRoot = Join-Path $env:ProgramData 'bluetardigrade'
        Assert ($DataDir -eq (Join-Path $env:ProgramData 'bluetardigrade-sensor')) "unexpected data directory: $DataDir"
        Assert (-not $DataDir.StartsWith($serverRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'the data directory is inside the server install root'
        Assert ($LegacyDataDir -eq (Join-Path $serverRoot 'sensor')) "unexpected legacy directory: $LegacyDataDir"
        # its parent is ProgramData itself now: the installer must accept it
        Assert (Test-SfDirectoryTrusted -Path $env:ProgramData) 'ProgramData does not pass the parent trust check'
    }
    Check 'loopback and remote engine addresses are told apart' {
        foreach ($local in @('127.0.0.1:7777', '127.8.9.10:7777', 'localhost:7777', 'LOCALHOST:7777', '[::1]:7777')) {
            Assert (Test-SfLoopbackAddr $local) "$local should be loopback"
            Assert (Test-SfAddr $local) "$local should be a valid address"
        }
        foreach ($remote in @('10.0.0.5:7777', 'engine.lab:7777', 'localhost.evil.example:7777', '[fe80::1]:7777', '127.0.0.1.evil.example:7777')) {
            Assert (-not (Test-SfLoopbackAddr $remote)) "$remote should not be loopback"
            Assert (Test-SfAddr $remote) "$remote should be a valid address"
        }
        foreach ($bad in @('', 'no-port', '10.0.0.5:7777 --token x', '10.0.0.5:7777" --log "C:\x', 'host:port')) {
            Assert (-not (Test-SfAddr $bad)) "'$bad' was accepted as an address"
        }
    }
    Check 'an install towards another machine without TLS is refused unless the operator opts in' {
        $ca = Join-Path $work 'ca.pem'
        Set-Content -LiteralPath $ca -Value 'x' -Encoding ASCII
        Assert (-not (Test-SfTransportProtected -Addr '10.0.0.5:7777' -TlsCa '' -AllowPlaintextToken $false)) 'remote without TLS was accepted'
        Assert (-not (Test-SfTransportProtected -Addr '10.0.0.5:7777' -TlsCa '' -AllowPlaintextToken $false -KnownCa @((Join-Path $work 'missing.pem')))) 'a CA that is not there counted'
        Assert (Test-SfTransportProtected -Addr '127.0.0.1:7777' -TlsCa '' -AllowPlaintextToken $false) 'loopback was refused'
        Assert (Test-SfTransportProtected -Addr '10.0.0.5:7777' -TlsCa $ca -AllowPlaintextToken $false) 'remote with -TlsCa was refused'
        Assert (Test-SfTransportProtected -Addr '10.0.0.5:7777' -TlsCa '' -AllowPlaintextToken $true) 'the explicit opt-in was refused'
        Assert (Test-SfTransportProtected -Addr '10.0.0.5:7777' -TlsCa '' -AllowPlaintextToken $false -KnownCa @($ca)) 'the CA of an earlier install did not count'
    }
    Check 'the elevated relaunch repeats every file the user gave, with absolute paths' {
        $files = Join-Path $work ($accented + '\secrets')
        New-Item -ItemType Directory $files -Force | Out-Null
        foreach ($name in @('token.txt', 'enroll.txt', 'ca.pem')) { Set-Content -LiteralPath (Join-Path $files $name) -Value 'x' -Encoding ASCII }
        Push-Location -LiteralPath $files
        try {
            $forward = @(Get-SfElevatedArguments -Action 'Install' -Addr '10.0.0.5:7777' -TlsCa '.\ca.pem' -TokenFile 'token.txt' -EnrollTokenFile '.\enroll.txt' -Purge $false -AllowPlaintextToken $true)
        } finally { Pop-Location }
        $joined = $forward -join ' '
        $expected = '-Install -Addr 10.0.0.5:7777 -TlsCa "' + (Join-Path $files 'ca.pem') + '" -TokenFile "' + (Join-Path $files 'token.txt') + '" -EnrollTokenFile "' + (Join-Path $files 'enroll.txt') + '" -AllowPlaintextToken'
        Assert ($joined -eq $expected) "unexpected relaunch arguments: $joined"
        $missing = Throws { Get-SfElevatedArguments -Action 'Install' -Addr '127.0.0.1:7777' -TokenFile (Join-Path $files 'nope.txt') }
        Assert ($missing -match 'does not exist') "a missing -TokenFile was not reported before the relaunch: $missing"
        $badAddr = Throws { Get-SfElevatedArguments -Action 'Install' -Addr '10.0.0.5:7777 -Purge' }
        Assert ($badAddr -match 'host:port') "an address carrying another argument was forwarded: $badAddr"
        $uninstall = @(Get-SfElevatedArguments -Action 'Uninstall' -Addr '127.0.0.1:7777' -TokenFile 'ignored.txt' -Purge $true)
        Assert (($uninstall -join ' ') -eq '-Uninstall -Purge') "unexpected uninstall arguments: $($uninstall -join ' ')"
    }
    Check 'only the relaunch''s own token files are deleted afterwards' {
        $own = Join-Path $env:TEMP ('sf-etw-token-' + [guid]::NewGuid().ToString('N') + '.txt')
        Assert (Test-SfRelaunchTokenFile $own) 'the relaunch temp file was not recognised'
        Assert (Test-SfRelaunchTokenFile ($own -replace 'sf-etw-token-', 'sf-etw-enroll-')) 'the enrollment temp file was not recognised'
        Assert (-not (Test-SfRelaunchTokenFile (Join-Path $env:TEMP 'my-token.txt'))) 'a user file under TEMP would be deleted'
        Assert (-not (Test-SfRelaunchTokenFile 'C:\secrets\sf-etw-token-0123456789abcdef0123456789abcdef.txt')) 'a file outside TEMP would be deleted'
        Assert (-not (Test-SfRelaunchTokenFile '')) 'an empty path matched'
    }

    $programData = Join-Path $work 'ProgramData'
    # What the installer creates, with this account in the place of SYSTEM
    # and Administrators (a test without elevation could not write into a
    # directory that only they may touch): inheritance cut, one trusted owner.
    function New-ProtectedTestDir([string]$Path) {
        $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetOwner($me)
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($me, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
        [void][IO.Directory]::CreateDirectory($Path, $acl)
        Assert (Test-SfDirectoryTrusted -Path $Path -Strict) "the test directory $Path does not pass the strict trust check"
    }
    function New-LegacyDir([string]$Name, [string[]]$Files, [switch]$Unprotected) {
        $parent = Join-Path $programData $Name
        New-Item -ItemType Directory $parent -Force | Out-Null
        $dir = Join-Path $parent 'sensor'
        if ($Unprotected) { New-Item -ItemType Directory $dir | Out-Null } else { New-ProtectedTestDir $dir }
        foreach ($file in $Files) { Set-Content -LiteralPath (Join-Path $dir $file) -Value "old-$file" -Encoding ASCII }
        return $dir
    }
    function New-TargetDir([string]$Name) {
        $dir = Join-Path $programData ($Name + '-sensor')
        New-ProtectedTestDir $dir
        return $dir
    }

    Check 'the data of an older service moves to the new directory' {
        $legacy = New-LegacyDir 'a' @('ingest.token', 'ingest-ca.pem', 'spool.ndjson', 'sensor.log', 'notes.txt')
        $target = New-TargetDir 'a'
        Assert (Test-SfLegacyDataDir -Path $legacy) 'a real data directory was not recognised'
        $moved = @(Move-SfLegacyDataDir -Legacy $legacy -Target $target)
        Assert (($moved -join ',') -eq 'ingest.token,ingest-ca.pem,spool.ndjson,sensor.log') "unexpected files moved: $($moved -join ',')"
        foreach ($file in $moved) {
            Assert ((Get-Content -LiteralPath (Join-Path $target $file) -Raw).Trim() -eq "old-$file") "$file did not arrive intact"
            Assert (-not (Test-Path -LiteralPath (Join-Path $legacy $file))) "$file was left behind"
        }
        # a file the installer does not know is not its to move: it stays, and so does the directory
        Assert (Test-Path -LiteralPath (Join-Path $legacy 'notes.txt')) 'a file that is not sensor data was moved or deleted'
        Remove-Item -LiteralPath (Join-Path $legacy 'notes.txt') -Force
        $legacy2 = New-LegacyDir 'a2' @('ingest.token')
        $target2 = New-TargetDir 'a2'
        [void](Move-SfLegacyDataDir -Legacy $legacy2 -Target $target2)
        Assert (-not (Test-Path -LiteralPath $legacy2)) 'the emptied old directory was not removed'
    }
    Check 'a source tree at the old path is never taken for a data directory' {
        $legacy = New-LegacyDir 'b' @('ingest.token', 'spool.ndjson', 'Cargo.toml')
        New-Item -ItemType Directory (Join-Path $legacy 'src') | Out-Null
        $target = New-TargetDir 'b'
        Assert (-not (Test-SfLegacyDataDir -Path $legacy)) 'a directory with Cargo.toml was taken for a data directory'
        $moved = @(Move-SfLegacyDataDir -Legacy $legacy -Target $target)
        Assert ($moved.Count -eq 0) "files were moved out of a source tree: $($moved -join ',')"
        foreach ($file in @('ingest.token', 'spool.ndjson', 'Cargo.toml', 'src')) { Assert (Test-Path -LiteralPath (Join-Path $legacy $file)) "$file disappeared from the source tree" }
    }
    Check 'an old directory another account could have prepared is not migrated' {
        $legacy = New-LegacyDir 'c' @('ingest.token', 'sensor.log') -Unprotected
        $target = New-TargetDir 'c'
        $moved = @(Move-SfLegacyDataDir -Legacy $legacy -Target $target)
        Assert ($moved.Count -eq 0) 'an unprotected directory was trusted'
        Assert (-not (Test-Path -LiteralPath (Join-Path $target 'ingest.token'))) 'a token from an untrusted directory reached the data directory'
        $empty = New-LegacyDir 'c2' @()
        Assert (-not (Test-SfLegacyDataDir -Path $empty)) 'an empty directory was taken for a data directory'
        Assert (-not (Test-SfLegacyDataDir -Path (Join-Path $programData 'missing\sensor'))) 'a missing directory was taken for a data directory'
    }
    Check 'what the new directory already holds wins over the old copy' {
        $legacy = New-LegacyDir 'd' @('ingest.token', 'sensor.log')
        $target = New-TargetDir 'd'
        Set-Content -LiteralPath (Join-Path $target 'ingest.token') -Value 'current' -Encoding ASCII
        $moved = @(Move-SfLegacyDataDir -Legacy $legacy -Target $target)
        Assert (($moved -join ',') -eq 'sensor.log') "unexpected files moved: $($moved -join ',')"
        Assert ((Get-Content -LiteralPath (Join-Path $target 'ingest.token') -Raw).Trim() -eq 'current') 'the current token was overwritten'
        Assert (Test-Path -LiteralPath (Join-Path $legacy 'ingest.token')) 'the old token was deleted instead of kept'
    }
    Check 'the install script arms restart-on-failure and cleans the ETW sessions' {
        $source = Get-Content -LiteralPath (Join-Path $RepoRoot 'scripts\windows\sensor-service.ps1') -Raw
        Assert ($source -match '(?m)^\s*& sc\.exe failureflag \$ServiceName 1') 'sc.exe failureflag is missing: a reported error would leave the service stopped'
        Assert ($source -match "(?m)^\s*if \(-not \(Wait-SfServiceState 'Stopped' 30\)\) \{ throw") 'the uninstall no longer waits for the service to stop'
        $names = @('bluetardigrade-sensor', 'bluetardigrade-sensor-netreg', 'bluetardigrade-sensor-file')
        $config = Get-Content -LiteralPath (Join-Path $RepoRoot 'sensor\src\collector\config.rs') -Raw
        foreach ($file in @('scripts\windows\runtime.ps1', 'uninstall.ps1')) {
            $text = Get-Content -LiteralPath (Join-Path $RepoRoot $file) -Raw
            foreach ($name in $names) {
                Assert ($config -match ('"' + [regex]::Escape($name) + '"')) "the sensor no longer names a session $name"
                Assert ($text -match ("'" + [regex]::Escape($name) + "'")) "$file does not stop the ETW session $name"
            }
        }
    }

    # ---------------------------------------------------- Sysmon bookmark
    Check 'a bookmark past the end of the Sysmon log is dropped, any other is kept' {
        $r = Resolve-SfRecordBookmark -Bookmark 90000 -Newest 120
        Assert ($r.Reset -and $r.Id -eq 0) 'a bookmark above the newest record survived a cleared log'
        $r = Resolve-SfRecordBookmark -Bookmark 90000 -Newest 0
        Assert ($r.Reset -and $r.Id -eq 0) 'a bookmark survived an emptied log'
        $r = Resolve-SfRecordBookmark -Bookmark 100 -Newest 120
        Assert (-not $r.Reset -and $r.Id -eq 100) 'a valid bookmark was dropped'
        $r = Resolve-SfRecordBookmark -Bookmark 120 -Newest 120
        Assert (-not $r.Reset -and $r.Id -eq 120) 'a bookmark on the newest record was dropped'
        $r = Resolve-SfRecordBookmark -Bookmark 90000 -Newest -1
        Assert (-not $r.Reset -and $r.Id -eq 90000) 'a log that could not be read was taken for a cleared one'
        $r = Resolve-SfRecordBookmark -Bookmark 0 -Newest 50
        Assert (-not $r.Reset -and $r.Id -eq 0) 'no bookmark was reported as a reset'
    }
    Check 'the Sysmon sensor moves its bookmark only after the event was sent' {
        $source = Get-Content -LiteralPath (Join-Path $RepoRoot 'scripts\windows\sensor.ps1') -Raw
        $send = $source.IndexOf('Send-EventLine $writer $client $ev')
        $advance = $source.IndexOf('if ($rid -gt $lastRecordId) { $lastRecordId = $rid }', $send)
        $count = $source.IndexOf('$sent++', $send)
        Assert ($send -gt 0 -and $advance -gt $send -and $advance -lt $count) 'the bookmark no longer advances right after a successful send'
        # ...and not where it used to: on the line after the id is read
        $read = $source.IndexOf('$rid = [long]$xml.Event.System.EventRecordID')
        $next = ($source.Substring($read) -split "`n")[1]
        Assert ($next -notmatch 'lastRecordId = \$rid') 'the bookmark advances before the send again'
    }

    Write-Host "Sensor installer checks: $checks/$checks passed."
} finally {
    $env:TEMP = $originalTemp
    Remove-Item Env:\SF_SHIM, Env:\SF_SHIM_MARKER -ErrorAction SilentlyContinue
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($scratchRoot, $false)
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

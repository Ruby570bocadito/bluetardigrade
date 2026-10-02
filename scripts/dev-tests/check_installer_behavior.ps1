# Behavioral installer checks on disposable directories under Windows.
# No Sysmon deployment, firewall changes or automatic startup is requested.
param([string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this check on native Windows PowerShell 5.1 or newer.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('sf-installer-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work -Force | Out-Null
$originalPath = $env:Path
$originalUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$checks = 0
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Check($Name, [scriptblock]$Body) { & $Body; $script:checks++; Write-Host "PASS: $Name" }
function Throws([scriptblock]$Body) {
    $caught = $false
    try { & $Body | Out-Null } catch { $caught = $true }
    Assert $caught 'Expected failure was not reported.'
}
function Put($Path, $Text) {
    New-Item -ItemType Directory (Split-Path $Path -Parent) -Force | Out-Null
    Set-Content -LiteralPath $Path -Value $Text -Encoding ascii
}
try {
    . (Join-Path $RepoRoot 'install.ps1')
    Check 'native stderr with zero exit is accepted on PowerShell 5.1' {
        $lines = Invoke-Native -Command { & $env:ComSpec /d /c 'echo native-progress 1>&2 & exit /b 0' } -Quiet
        Assert ("$lines" -match 'native-progress') 'Native diagnostic was lost.'
        Assert ($LASTEXITCODE -eq 0) 'Successful native exit was lost.'
    }
    Check 'native nonzero exit is rejected even after a successful command' {
        Throws { Invoke-Native -Command { & $env:ComSpec /d /c 'exit /b 4' } -Quiet }
        Assert ($LASTEXITCODE -eq 4) 'Failing native exit was lost.'
    }
    Check 'version parsing consumes an array as scalar text without stale Matches' {
        'stale99' -match '(99)' | Out-Null
        $go = Get-ToolVersion $env:ComSpec @('/d', '/c', 'echo go version go1.26.8 windows/amd64') 'go version go(\d+\.\d+(?:\.\d+)?)'
        $node = Get-ToolVersion $env:ComSpec @('/d', '/c', 'echo v22.14.0') '^v(\d+\.\d+\.\d+)'
        $bun = Get-ToolVersion $env:ComSpec @('/d', '/c', 'echo 1.3.14') '^(\d+\.\d+\.\d+)'
        Assert ($go -eq [version]'1.26.8' -and $node -eq [version]'22.14.0' -and $bun -eq [version]'1.3.14') 'Version probes did not parse correctly.'
    }
    Check 'failed version probe cannot reuse success-looking output' {
        $v = Get-ToolVersion $env:ComSpec @('/d', '/c', 'echo v22.14.0 & exit /b 3') '^v(\d+\.\d+\.\d+)'
        Assert ($null -eq $v) 'Failing executable accepted as a toolchain.'
    }
    Check 'checksum indexes parse binary HTTP content and CRLF without accepting an invalid hash' {
        $script:checksumText = (('a' * 64) + "  bun-windows-x64-baseline.zip`r`n")
        function Invoke-WebRequest { param([switch]$UseBasicParsing, [string]$Uri)
            return [pscustomobject]@{ Content = [Text.Encoding]::UTF8.GetBytes($script:checksumText) }
        }
        try {
            Assert ((Get-DistSha256 'https://example.invalid/checksums' 'bun-windows-x64-baseline\.zip$') -eq ('a' * 64)) 'Binary/CRLF checksum was not decoded.'
            $script:checksumText = "bad-hash  bun-windows-x64-baseline.zip`r`n"
            Assert ($null -eq (Get-DistSha256 'https://example.invalid/checksums' 'bun-windows-x64-baseline\.zip$')) 'Invalid checksum was accepted.'
        } finally { Remove-Item Function:Invoke-WebRequest }
    }
    Check 'dangerous and unrelated installation roots are refused' {
        Throws { Resolve-InstallRoot ([IO.Path]::GetPathRoot($work)) }
        Throws { Resolve-InstallRoot $env:USERPROFILE }
        Throws { Resolve-InstallRoot ([IO.Path]::GetTempPath()) }
        $other = Join-Path $work 'unrelated'
        Put (Join-Path $other 'keep.txt') 'operator data'
        Throws { Resolve-InstallRoot $other }
        Throws { & (Join-Path $RepoRoot 'uninstall.ps1') -InstallDir $other }
        Assert (Test-Path (Join-Path $other 'keep.txt')) 'Unrelated directory was modified.'
    }
    Check 'installer self-replacement is detected even at the same running path' {
        $stale = Join-Path $work 'stale'
        $path = Join-Path $stale 'install.ps1'
        Put $path 'old installer'
        $hash = (Get-FileHash $path).Hash
        Put $path 'new installer'
        Assert (Test-InstallerStale $stale $path $hash) 'Same-path stale installer was missed.'
        Assert (-not (Test-InstallerStale $stale $path (Get-FileHash $path).Hash)) 'Identical installer marked stale.'
    }
    Check 'stale PID cannot stop an unrelated process' {
        $pidRoot = Join-Path $work 'pid test'
        $child = Start-Process -FilePath $env:ComSpec -ArgumentList '/d /c ping -n 30 127.0.0.1 >nul' -WindowStyle Hidden -PassThru
        try {
            Put (Join-Path $pidRoot 'run\engine.pid') ([string]$child.Id)
            Stop-SfProcesses $pidRoot
            Assert ($null -ne (Get-Process -Id $child.Id -ErrorAction SilentlyContinue)) 'Stale PID killed an unrelated process.'
        } finally { if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() } }
    }
    # Spy only on process stopping; these source checks never run services.
    $script:stops = 0
    function Stop-SfProcesses { param([string]$Root); $script:stops++ }
    $seed = Join-Path $work 'git seed'
    $checkout = Join-Path $work 'git install'
    New-Item -ItemType Directory $seed -Force | Out-Null
    Invoke-Native { & git -C $seed init -b main } -Quiet | Out-Null
    Invoke-Native { & git -C $seed config user.name InstallerTest } -Quiet | Out-Null
    Invoke-Native { & git -C $seed config user.email installer-test@example.invalid } -Quiet | Out-Null
    Put (Join-Path $seed 'install.ps1') 'installer marker'
    Put (Join-Path $seed 'source.txt') 'v1'
    Invoke-Native { & git -C $seed add . } -Quiet | Out-Null
    Invoke-Native { & git -C $seed commit -m initial } -Quiet | Out-Null
    Invoke-Native { & git clone --no-local --depth 1 $seed $checkout } -Quiet | Out-Null
    Put (Join-Path $checkout 'reports\keep.md') 'case evidence'
    Put (Join-Path $seed 'source.txt') 'v2'
    Invoke-Native { & git -C $seed commit -am next } -Quiet | Out-Null
    Check 'shallow git install updates by fast-forward and preserves reports' {
        Get-SourceTree $checkout 'unused/unused' main $true | Out-Null
        Assert ((Get-Content (Join-Path $checkout 'source.txt')) -eq 'v2') 'Git update did not advance.'
        Assert ((Get-Content (Join-Path $checkout 'reports\keep.md')) -eq 'case evidence') 'Report lost during git update.'
    }
    Check 'tracked local edits are preserved and reject an update before stopping' {
        Put (Join-Path $checkout 'source.txt') 'local edit'
        $before = $script:stops
        Throws { Get-SourceTree $checkout 'unused/unused' main $true }
        Assert ($script:stops -eq $before) 'Services stopped for a rejected update.'
        Assert ((Get-Content (Join-Path $checkout 'source.txt')) -eq 'local edit') 'Local edit was reset.'
    }
    Invoke-Native { & git -C $checkout config user.name InstallerTest } -Quiet | Out-Null
    Invoke-Native { & git -C $checkout config user.email installer-test@example.invalid } -Quiet | Out-Null
    Invoke-Native { & git -C $checkout commit -am local } -Quiet | Out-Null
    Check 'divergent git history is refused without resetting or stopping' {
        $before = $script:stops
        Throws { Get-SourceTree $checkout 'unused/unused' main $true }
        Assert ($script:stops -eq $before) 'Divergent update stopped services.'
        Assert ((Get-Content (Join-Path $checkout 'source.txt')) -eq 'local edit') 'Divergent history was reset.'
    }
    # ZIP fallback uses actual compression/extraction and file operations,
    # with only the HTTP download replaced by an inert local archive.
    function Get-Command { [CmdletBinding()] param([string]$Name)
        if ($Name -eq 'git') { return $null }
        Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
    }
    $archiveRoot = Join-Path $work 'archive source'
    $archiveRepo = Join-Path $archiveRoot 'repo'
    Put (Join-Path $archiveRepo 'install.ps1') 'new source installer'
    Put (Join-Path $archiveRepo 'go.mod') 'module example.invalid/test'
    Put (Join-Path $archiveRepo 'cmd\engine\main.go') 'package main'
    $script:archiveToDeliver = Join-Path $work 'source.zip'
    Compress-Archive -Path $archiveRepo -DestinationPath $script:archiveToDeliver
    $script:downloadFails = $false
    function Invoke-Download { param($Url, $OutFile, $ExpectedSha256, [switch]$UnverifiedOk)
        if ($script:downloadFails) { throw 'test download unavailable' }
        $script:downloadURL = $Url
        Copy-Item $script:archiveToDeliver $OutFile -Force
    }
    $zipInstall = Join-Path $work 'zip install'
    Put (Join-Path $zipInstall 'install.ps1') 'old source installer'
    foreach ($file in @('tools\config\ingest.token', 'sf-store.db', 'alert-lifecycle.json', 'respond-audit.jsonl', 'suppressions.yaml', 'forensics\keep.json', 'reports\case.md', 'custom.txt')) { Put (Join-Path $zipInstall $file) 'keep' }
    Check 'ZIP update preserves runtime evidence, secrets, reports and custom files' {
        Get-SourceTree $zipInstall 'test/source' 'release/v1' $true | Out-Null
        Assert ($script:downloadURL -match '/zipball/release%2Fv1$') 'Ref was not safely encoded for branch/tag ZIP fallback.'
        Assert (Test-Path (Join-Path $zipInstall 'cmd\engine\main.go')) 'Nested source was not copied correctly.'
        foreach ($file in @('tools\config\ingest.token', 'sf-store.db', 'alert-lifecycle.json', 'respond-audit.jsonl', 'suppressions.yaml', 'forensics\keep.json', 'reports\case.md', 'custom.txt')) {
            Assert ((Get-Content (Join-Path $zipInstall $file)) -eq 'keep') "Runtime file lost: $file"
        }
    }
    Check 'failed source download leaves an existing installation running and intact' {
        $script:downloadFails = $true
        $before = $script:stops
        Throws { Get-SourceTree $zipInstall 'test/source' main $true }
        Assert ($script:stops -eq $before) 'Failed download stopped services.'
        Assert ((Get-Content (Join-Path $zipInstall 'install.ps1')) -eq 'new source installer') 'Failed download modified source.'
    }
    Check 'incomplete source archive is refused before modifying the install' {
        $script:downloadFails = $false
        $badRoot = Join-Path $work 'incomplete'
        Put (Join-Path $badRoot 'repo\install.ps1') 'bad source'
        $script:archiveToDeliver = Join-Path $work 'bad.zip'
        Compress-Archive -Path (Join-Path $badRoot 'repo') -DestinationPath $script:archiveToDeliver
        $before = $script:stops
        Throws { Get-SourceTree $zipInstall 'test/source' main $true }
        Assert ($script:stops -eq $before) 'Incomplete archive stopped services.'
        Assert ((Get-Content (Join-Path $zipInstall 'install.ps1')) -eq 'new source installer') 'Incomplete archive replaced source.'
    }
    Remove-Item Function:Get-Command
    $installed = Join-Path $work 'real install with spaces'
    Check 'real NoConsole installer builds engine and collector with system Go and removes old demo commands' {
        New-Item -ItemType Directory $installed -Force | Out-Null
        foreach ($entry in @('install.ps1', 'uninstall.ps1', 'go.mod', 'go.sum', 'cmd', 'internal', 'pkg', 'rules', 'sequences', 'configs', 'scripts')) {
            Copy-Item (Join-Path $RepoRoot $entry) $installed -Recurse -Force
        }
        foreach ($legacy in @('bin\sf-devsensor.cmd', 'bin\sf-devsensor.exe', 'bin\devsensor.exe', 'scripts\devsensor.ps1', 'cmd\devsensor\main.go')) { Put (Join-Path $installed $legacy) 'obsolete demo' }
        & (Join-Path $installed 'install.ps1') -SourceReady -NoConsole -InstallDir $installed
        Assert (Test-Path (Join-Path $installed 'bin\engine.exe')) 'Engine did not build.'
        Assert (Test-Path (Join-Path $installed 'bin\collector.exe')) 'Collector did not build.'
        Assert (Test-Path (Join-Path $installed 'bin\sf-collector.exe')) 'Collector command was not installed.'
        Assert (-not (Test-Path (Join-Path $installed 'tools\bun.exe'))) 'NoConsole installed Bun.'
        Assert (-not (Test-Path (Join-Path $installed 'tools\node'))) 'NoConsole installed portable Node.'
        foreach ($legacy in @('bin\sf-devsensor.cmd', 'bin\sf-devsensor.exe', 'bin\devsensor.exe', 'scripts\devsensor.ps1', 'cmd\devsensor')) { Assert (-not (Test-Path (Join-Path $installed $legacy))) "Old demo remains: $legacy" }
        Invoke-Native { & (Join-Path $installed 'bin\sf-engine.exe') validate } -Quiet | Out-Null
        Invoke-Native { & (Join-Path $installed 'bin\sf-collector.exe') -h } -Quiet | Out-Null
    }
    Check 'real console installer provisions verified Bun and completes frozen install plus Next build on Windows' {
        Copy-Item (Join-Path $RepoRoot 'web') $installed -Recurse -Force
        & (Join-Path $installed 'install.ps1') -SourceReady -InstallDir $installed
        Assert (Test-Path (Join-Path $installed 'web\console\.next\BUILD_ID')) 'Windows Next build did not complete.'
        Assert (Test-Path (Join-Path $installed 'bin\sf-console.cmd')) 'Console command was not installed.'
        $update = Get-Content (Join-Path $installed 'bin\sf-update.cmd') -Raw
        Assert ($update -notmatch '-NoConsole') 'Updater incorrectly retained an excluded console.'
        Assert ($update -match '-Repo' -and $update -match '-Branch') 'Updater lost source selection.'
    }
    Write-Host "Installer behavioral checks: $checks/$checks passed."
} finally {
    $env:Path = $originalPath
    [Environment]::SetEnvironmentVariable('Path', $originalUserPath, 'User')
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

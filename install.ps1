# ======================================================================
# bluetardigrade - one-command installer for Windows PowerShell 5.1+
# (also works in PowerShell 7). No admin account required.
#
#   irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/install.ps1 | iex
#
# With parameters:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/install.ps1))) -WithSensor -AutoStart
#
# What it does:
#   1. Downloads the repository (git if available, GitHub zip otherwise)
#   2. Provisions portable Go + Node + Bun under <InstallDir>\tools
#      (reuses any compatible tool already on your PATH)
#   3. Builds the Go detection engine and observed-log collector
#   4. Builds the web console (Next.js) unless -NoConsole
#   5. Puts sf-engine, sf-collector, sf-sensor, sf-console, sf-update
#      and sf-uninstall on your user PATH
#
# Switches:
#   -InstallDir <path>   install location (default %LOCALAPPDATA%\bluetardigrade)
#   -Repo <owner/name>   GitHub repository        (default Ruby570bocadito/bluetardigrade)
#   -Branch <name>       branch or tag to install (default main)
#   -NoConsole           skip the web console (engine + rules only)
#   -WithSensor          also build the Rust ETW sensor (needs Rust + MSVC)
#   -Firewall            open TCP 7777 for remote sensors, domain and
#                        private profiles only (asks via UAC); pair it
#                        with:  sf-engine -addr 0.0.0.0:7777
#   -AutoStart           start engine + console at logon (HKCU Run, no admin)
#   -WebhookUrl <url>    POST every alert as JSON to this SIEM/SOAR endpoint;
#                        persisted, engine autostart delivers it (empty clears)
#   -WebhookToken <t>    bearer token the deliveries carry as
#                        'Authorization: Bearer' (env SF_WEBHOOK_TOKEN also
#                        works at runtime; empty disables)
#   -IngestToken <t>     shared secret sensors must send ('AUTH <token>');
#                        persisted, engine autostart enforces it. -Firewall
#                        REQUIRES it: an open 7777 without a token lets any
#                        LAN host inject events (empty clears)
#   -Update              refresh an existing install and rebuild
#   -SkipBuild           fetch sources + tools but skip compiling (debug)
#   -SourceReady         internal: source already fetched (the updater
#                        re-runs the freshly downloaded installer with
#                        this flag instead of downloading twice)
# ======================================================================
param(
    [string]$InstallDir = '',
    [string]$Repo = 'Ruby570bocadito/bluetardigrade',
    [string]$Branch = 'main',
    [switch]$NoConsole,
    [switch]$WithSensor,
    [switch]$Firewall,
    [switch]$AutoStart,
    [string]$WebhookUrl = '',
    [string]$WebhookToken = '',
    [string]$IngestToken = '',
    [switch]$Update,
    [switch]$SkipBuild,
    [switch]$SourceReady
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest usable on PS 5.1

$GO_VERSION   = '1.26.8'
$NODE_VERSION = 'v22.23.3'
$BUN_VERSION  = 'v1.4.2'
$ENGINE_PORT  = 7777
$CONSOLE_PORT = 3000
$SERVICE_PORT = 3003

# Snapshot of the running installer, taken BEFORE Get-SourceTree can
# replace scripts\install.ps1 mid-run. Runtime data survives source updates.
# sf-update.cmd always invokes <Root>\scripts\install.ps1, which is the
# copy left by the PREVIOUS install - without the snapshot + re-exec
# below, an update would rebuild everything with new code but regenerate
# shims and print the summary with the OLD installer logic.
$scriptInstallerPath = $PSCommandPath
$scriptInstallerHash = $null
if ($scriptInstallerPath -and (Test-Path $scriptInstallerPath)) {
    try { $scriptInstallerHash = (Get-FileHash $scriptInstallerPath).Hash } catch { }
}

# ---------------------------------------------------------------- log
function Write-Step($m)  { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok($m)    { Write-Host "    [ok] $m" -ForegroundColor Green }
function Write-Warn2($m) { Write-Host "    [!]  $m" -ForegroundColor Yellow }
function Write-Err2($m)  { Write-Host "    [x]  $m" -ForegroundColor Red }
function Write-Info($m)  { Write-Host "    $m" }

function Get-TempDir {
    if ($env:TEMP)  { return $env:TEMP }
    if ($env:TMPDIR) { return $env:TMPDIR }
    return [IO.Path]::GetTempPath()
}

function Invoke-Native {
    # Native commands (git, netsh, reg, go, node, bun) write progress and
    # diagnostics to STDERR, and 'git clone' ALWAYS opens with one
    # ("Cloning into ..."). Under $ErrorActionPreference = 'Stop' (this
    # script's default), PowerShell 5.1 turns the first REDIRECTED stderr
    # line into a terminating NativeCommandError: both 2>&1 and 2>$null
    # materialize the ErrorRecord before discarding it, so the whole
    # installer died on git's own progress banner. Judge by exit code
    # instead: run with EAP=Continue while stderr is merged, stringify
    # the records so they can never become terminating, and keep the text
    # for diagnostics. -AllowFailure marks a non-zero exit as an expected
    # outcome (reg/netsh probes); -Quiet suppresses the echo of output
    # lines; -Activity names the operation in the failure message.
    param(
        [Parameter(Mandatory)][ScriptBlock]$Command,
        [switch]$AllowFailure,
        [switch]$Quiet,
        [string]$Activity
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = -1
    try {
        $lines = @(. $Command 2>&1 | ForEach-Object { "$_" })
    } finally {
        $ErrorActionPreference = $prev
    }
    if (-not $Quiet) {
        foreach ($l in $lines) { Write-Info $l }
    }
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
        $detail = ($lines | Where-Object { $_ }) -join ' '
        if ($Activity) { throw "$Activity failed (exit $LASTEXITCODE): $detail" }
        throw "native command failed (exit $LASTEXITCODE): $detail"
    }
    return ,$lines
}

function Get-ToolVersion {
    param([string]$Executable, [string[]]$Arguments, [string]$Pattern)
    # Invoke-Native always returns a string array. Collection -match does
    # not populate $Matches, so version parsing must use a scalar string.
    $text = ((Invoke-Native -Command { & $Executable @Arguments } -Quiet -AllowFailure) -join "`n").Trim()
    if ($LASTEXITCODE -ne 0) { return $null }
    $match = [regex]::Match($text, $Pattern)
    if (-not $match.Success) { return $null }
    return [version]$match.Groups[1].Value
}

function Resolve-InstallRoot {
    param([string]$Path)
    if (-not $Path) {
        $base = $env:LOCALAPPDATA
        if (-not $base) { $base = $env:USERPROFILE }
        if (-not $base) { throw 'Set -InstallDir: LOCALAPPDATA and USERPROFILE are unavailable.' }
        $Path = Join-Path $base 'bluetardigrade'
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $forbidden = @([IO.Path]::GetPathRoot($full), $env:USERPROFILE, $env:LOCALAPPDATA, $env:SystemRoot, (Get-TempDir))
    foreach ($entry in $forbidden) {
        if ($entry -and $full -ieq ([IO.Path]::GetFullPath($entry).TrimEnd('\', '/'))) {
            throw 'Choose a dedicated installation directory, not a drive root, profile or system folder.'
        }
    }
    if (Test-Path $full) {
        if (-not (Test-Path $full -PathType Container)) { throw 'InstallDir must be a directory.' }
        if (-not (Test-Path (Join-Path $full 'install.ps1')) -and @(Get-ChildItem $full -Force).Count -gt 0) {
            throw 'Existing directory is not a bluetardigrade installation. Choose an empty directory.'
        }
    }
    return $full
}

# ---------------------------------------------------------------- net
function Invoke-Download {
    # Fail-closed by default: a toolchain binary with no verifiable
    # checksum is a supply-chain hole, not a convenience. The only
    # exception is the repository source zip (-UnverifiedOk), for which
    # no published checksum exists; the engine it builds is reviewed
    # code, while the toolchains below run as build tooling.
    param([string]$Url, [string]$OutFile, [string]$ExpectedSha256, [switch]$UnverifiedOk)
    if (Test-Path $OutFile) { Remove-Item $OutFile -Force -ErrorAction SilentlyContinue }
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
    try { Unblock-File $OutFile -ErrorAction SilentlyContinue } catch { }
    if ($ExpectedSha256) {
        $h = (Get-FileHash $OutFile -Algorithm SHA256).Hash.ToLower()
        if ($h -ne $ExpectedSha256.ToLower()) { throw "sha256 mismatch for $Url (got $h, want $ExpectedSha256)" }
        Write-Info "sha256 verified"
    } elseif (-not $UnverifiedOk) {
        throw "cannot verify ${Url}: no sha256 available (checksum source unreachable). Refusing to install an unverified binary - retry, or pin the hash manually."
    }
}

function Get-GoSha256 {
    # official checksum published by go.dev for the pinned version
    try {
        $json = Invoke-RestMethod -UseBasicParsing "https://go.dev/dl/?mode=json&include=all"
        foreach ($rel in $json) {
            if ($rel.version -eq "go$GO_VERSION") {
                foreach ($f in $rel.files) {
                    if ($f.filename -eq "go$GO_VERSION.windows-amd64.zip") { return $f.sha256 }
                }
            }
        }
    } catch { }
    return $null
}

function Get-DistSha256 {
    param([string]$IndexUrl, [string]$FilePattern)
    try {
        $raw = (Invoke-WebRequest -UseBasicParsing $IndexUrl).Content
        # Release assets use application/octet-stream. PowerShell 5.1
        # returns byte[] for those responses, not a decoded string.
        if ($raw -is [byte[]]) { $raw = [Text.Encoding]::UTF8.GetString($raw) }
        foreach ($line in ($raw -split "`n")) {
            $line = $line.Trim()
            if ($line -match $FilePattern) {
                $digest = ($line -split '\s+')[0]
                if ($digest -match '^[a-fA-F0-9]{64}$') { return $digest }
            }
        }
    } catch { }
    return $null
}

function Test-PortLocal {
    param([int]$Port)
    $c = New-Object Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $c.Close() }
}

function Test-InstallerStale {
    # true when the RUNNING installer differs from the freshly fetched
    # <Root>\install.ps1 (so the update must re-exec the new one).
    # False when run via irm|iex (no script file), or contents are identical.
    param([string]$Root, [string]$RunningPath, [string]$RunningHash)
    if (-not $RunningPath -or -not $RunningHash) { return $false }
    $fresh = Join-Path $Root 'install.ps1'
    if (-not (Test-Path $fresh)) { return $false }
    try {
        if ((Get-FileHash $fresh).Hash -ieq $RunningHash) { return $false }
    } catch { return $false }
    return $true
}

# ---------------------------------------------------------------- tools
function Ensure-Go {
    param([string]$Tools)
    $portable = Join-Path $Tools 'go\bin\go.exe'
    if (Test-Path $portable) {
        $version = Get-ToolVersion -Executable $portable -Arguments @('version') -Pattern 'go version go(\d+\.\d+(?:\.\d+)?)'
        if ($version -and $version -ge [version]'1.26.0') {
            $env:Path = "$Tools\go\bin;" + $env:Path
            Write-Ok "Go $version (portable)"
            return
        }
        Write-Warn2 'Portable Go is incompatible or cannot run; replacing it.'
    }
    $sys = Get-Command go.exe -ErrorAction SilentlyContinue
    if (-not $sys) { $sys = Get-Command go -ErrorAction SilentlyContinue }
    if ($sys) {
        $v = Get-ToolVersion -Executable $sys.Source -Arguments @('version') -Pattern 'go version go(\d+\.\d+(?:\.\d+)?)'
        if ($v) {
            if ($v -ge [version]'1.26.0') {
                Write-Ok "Go $v (system)"
                return
            }
            Write-Warn2 "system Go is $v (need 1.26+); installing a portable one"
        }
    }
    Write-Step "Downloading Go $GO_VERSION (portable, ~105 MB)"
    $zip = Join-Path $Tools 'go.zip'
    Invoke-Download -Url "https://go.dev/dl/go$GO_VERSION.windows-amd64.zip" -OutFile $zip -ExpectedSha256 (Get-GoSha256)
    Write-Info "extracting..."
    Expand-Archive -Path $zip -DestinationPath $Tools -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    $env:Path = "$Tools\go\bin;" + $env:Path
    Write-Ok "Go installed (portable)"
}

function Ensure-Node {
    # returns the full path to a usable node.exe (portable or system)
    param([string]$Tools)
    $portable = Join-Path $Tools 'node\node.exe'
    if (Test-Path $portable) {
        $version = Get-ToolVersion -Executable $portable -Arguments @('--version') -Pattern '^v(\d+\.\d+\.\d+)'
        if ($version -and $version -ge [version]'20.9.0') {
            $env:Path = "$Tools\node;" + $env:Path
            Write-Ok "Node.js $version (portable)"
            return $portable
        }
        Write-Warn2 'Portable Node is incompatible or cannot run; replacing it.'
    }
    $sys = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $sys) { $sys = Get-Command node -ErrorAction SilentlyContinue }
    if ($sys) {
        $v = Get-ToolVersion -Executable $sys.Source -Arguments @('--version') -Pattern '^v(\d+\.\d+\.\d+)'
        if ($v) {
            if ($v -ge [version]'20.9.0') { Write-Ok "Node.js $v (system)"; return $sys.Source }
            Write-Warn2 "system Node $v is too old (need 20.9+); installing a portable one"
        }
    }
    Write-Step "Downloading Node.js $NODE_VERSION (portable, ~30 MB)"
    $zip = Join-Path $Tools 'node.zip'
    $url = "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
    $sha = Get-DistSha256 -IndexUrl "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -FilePattern "node-$NODE_VERSION-win-x64\.zip"
    Invoke-Download -Url $url -OutFile $zip -ExpectedSha256 $sha
    $dest = Join-Path $Tools 'node-tmp'
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    if (Test-Path (Join-Path $Tools 'node')) { Remove-Item (Join-Path $Tools 'node') -Recurse -Force }
    Move-Item (Join-Path $dest "node-$NODE_VERSION-win-x64") (Join-Path $Tools 'node')
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    $env:Path = "$Tools\node;" + $env:Path
    Write-Ok "Node.js installed (portable)"
    return (Join-Path $Tools 'node\node.exe')
}

function Ensure-Bun {
    param([string]$Tools)
    if (Test-Path (Join-Path $Tools 'bun.exe')) {
        $version = Get-ToolVersion -Executable (Join-Path $Tools 'bun.exe') -Arguments @('--version') -Pattern '^(\d+\.\d+\.\d+)'
        if ($version -and $version -ge [version]$BUN_VERSION.TrimStart('v')) {
            $env:Path = "$Tools;" + $env:Path
            Write-Ok "Bun $version (portable)"
            return
        }
        Write-Warn2 'Portable Bun is incompatible or cannot run; replacing it.'
    }
    $sys = Get-Command bun.exe -ErrorAction SilentlyContinue
    if (-not $sys) { $sys = Get-Command bun -ErrorAction SilentlyContinue }
    if ($sys) {
        $v = Get-ToolVersion -Executable $sys.Source -Arguments @('--version') -Pattern '^(\d+\.\d+\.\d+)'
        if ($v -and $v -ge [version]$BUN_VERSION.TrimStart('v')) { Write-Ok "Bun $v (system)"; return }
    }
    Write-Step "Downloading Bun $BUN_VERSION (portable)"
    $zip = Join-Path $Tools 'bun.zip'
    $url = "https://github.com/oven-sh/bun/releases/download/bun-$BUN_VERSION/bun-windows-x64-baseline.zip"
    $sha = Get-DistSha256 -IndexUrl "https://github.com/oven-sh/bun/releases/download/bun-$BUN_VERSION/SHASUMS256.txt" -FilePattern 'bun-windows-x64-baseline\.zip$'
    Invoke-Download -Url $url -OutFile $zip -ExpectedSha256 $sha
    $dest = Join-Path $Tools 'bun-tmp'
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    $exe = Join-Path $dest 'bun-windows-x64-baseline\bun.exe'
    if (-not (Test-Path $exe)) {
        $exe = Get-ChildItem $dest -Recurse -Filter bun.exe | Select-Object -First 1 -ExpandProperty FullName
    }
    Copy-Item $exe (Join-Path $Tools 'bun.exe') -Force
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    $env:Path = "$Tools;" + $env:Path
    Write-Ok "Bun installed (portable)"
}

# ---------------------------------------------------------------- source
function Get-SourceTree {
    param([string]$Root, [string]$RepoId, [string]$Br, [bool]$IsUpdate)
    $Root = Resolve-InstallRoot $Root
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ((Test-Path (Join-Path $Root '.git')) -and $git) {
        Write-Step "Updating source (git)"
        Push-Location $Root
        try {
            $changes = ((Invoke-Native -Command { & git status --porcelain --untracked-files=no } -Quiet -Activity 'git status') -join "`n").Trim()
            if ($changes) { throw 'Tracked source files have local changes. Commit or back them up before updating; no reset was performed.' }
            Invoke-Native -Command { & git fetch origin $Br } -Quiet -Activity 'git fetch'
            # Confirm fast-forward before stopping services or modifying files.
            Invoke-Native -Command { & git merge-base --is-ancestor HEAD FETCH_HEAD } -Quiet -Activity 'update fast-forward preflight'
            Stop-SfProcesses -Root $Root
            Invoke-Native -Command { & git merge --ff-only FETCH_HEAD } -Quiet -Activity 'git fast-forward'
        } finally { Pop-Location }
        Write-Ok "source updated"
        return
    }
    if (Test-Path (Join-Path $Root '.git')) { throw 'This installation uses git; restore git on PATH before updating it.' }
    # Stage and validate a complete download before touching an existing
    # install. Overlay source files; never wipe operator data or toolchains.
    $tmp = Join-Path (Get-TempDir) ("sf-source-" + [guid]::NewGuid().ToString('N'))
    $zip = $tmp + '.zip'
    try {
        if ($git) {
            Write-Step "Cloning $RepoId ($Br) into staging"
            Invoke-Native -Command { & git clone --depth 1 --branch $Br "https://github.com/$RepoId.git" $tmp } -Quiet -Activity 'git clone'
            $source = $tmp
        } else {
            Write-Step "Downloading source zip ($RepoId@$Br)"
            # Source refs may be branches or tags; the GitHub zipball API
            # resolves both, unlike /zip/refs/heads/<tag>.
            $ref = [Uri]::EscapeDataString($Br)
            Invoke-Download -Url "https://api.github.com/repos/$RepoId/zipball/$ref" -OutFile $zip -UnverifiedOk
            Expand-Archive -Path $zip -DestinationPath $tmp -Force
            $inner = @(Get-ChildItem $tmp -Directory)
            if ($inner.Count -ne 1) { throw 'Source archive must contain exactly one repository directory.' }
            $source = $inner[0].FullName
        }
        foreach ($required in @('install.ps1', 'go.mod', 'cmd\engine\main.go')) {
            if (-not (Test-Path (Join-Path $source $required))) { throw "Incomplete source download: $required is missing." }
        }
        Stop-SfProcesses -Root $Root
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
        foreach ($entry in Get-ChildItem $source -Force) {
            Copy-Item -LiteralPath $entry.FullName -Destination $Root -Recurse -Force
        }
        Write-Ok "source ready"
    } finally {
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        if (Test-Path $zip) { Remove-Item $zip -Force }
    }
}

# ---------------------------------------------------------------- build
function Build-Engine {
    param([string]$Root)
    Write-Step "Building engine (Go, first build downloads modules)"
    New-Item -ItemType Directory -Path (Join-Path $Root 'bin') -Force | Out-Null
    Push-Location $Root
    try {
        $env:GOTOOLCHAIN = 'local'
        Invoke-Native -Command { & go build -o (Join-Path $Root 'bin\engine.exe') ./cmd/engine } -Activity 'go build ./cmd/engine'
        Invoke-Native -Command { & go build -o (Join-Path $Root 'bin\collector.exe') ./cmd/collector } -Activity 'go build ./cmd/collector'
    } finally { Pop-Location }
    Write-Ok "bin\engine.exe + bin\collector.exe"
}

function Build-Console {
    param([string]$Root, [string]$NodeExe)
    $web = Join-Path $Root 'web'
    if (-not (Test-Path (Join-Path $web 'console\package.json'))) {
        throw 'Web console sources are missing; use -NoConsole for an engine-only install.'
    }
    # resolve a working node.exe: explicit path, then whatever is on PATH
    if (-not $NodeExe -or -not (Test-Path $NodeExe)) {
        $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $cmd) { $cmd = Get-Command node -ErrorAction SilentlyContinue }
        if (-not $cmd) { throw "node.exe not found for the console build" }
        $NodeExe = $cmd.Source
    }
    Write-Step "Installing console dependencies (bun)"
    Push-Location (Join-Path $web 'console-service')
    try {
        Invoke-Native -Command { & bun install --frozen-lockfile } -Activity 'bun install (console-service)'
    } finally { Pop-Location }
    Push-Location (Join-Path $web 'console')
    try {
        Invoke-Native -Command { & bun install --frozen-lockfile } -Activity 'bun install (console)'
        Write-Step "Building web console (Next.js, 1-2 min)"
        $env:NEXT_TELEMETRY_DISABLED = '1'
        Invoke-Native -Command { & $NodeExe (Join-Path $web 'console\node_modules\next\dist\bin\next') build } -Activity 'next build'
    } finally { Pop-Location }
    Write-Ok "web console ready (start it with sf-console)"
}

function Build-Sensor {
    param([string]$Root)
    $cargo = Get-Command cargo -ErrorAction SilentlyContinue
    if (-not $cargo) {
        Write-Warn2 "Rust/cargo not found; sensor build skipped. To enable it:"
        Write-Info "1) winget install Rustlang.Rustup"
        Write-Info "2) install Visual Studio 2022 Build Tools with the C++ workload"
        Write-Info "3) re-run this installer with -Update -WithSensor"
        return
    }
    Write-Step "Building Rust sensor (release)"
    Push-Location (Join-Path $Root 'sensor')
    try {
        Invoke-Native -Command { & cargo build --release --locked } -Activity 'cargo build'
    } finally { Pop-Location }
    $exe = Join-Path $Root 'sensor\target\release\security-sensor.exe'
    if (Test-Path $exe) {
        Copy-Item $exe (Join-Path $Root 'bin\security-sensor.exe') -Force
        Write-Ok "bin\security-sensor.exe (run with --addr 127.0.0.1:7777)"
    }
}

# ---------------------------------------------------------------- integrate
function Copy-RuntimeScripts {
    param([string]$Root)
    $scripts = Join-Path $Root 'scripts'
    New-Item -ItemType Directory -Path $scripts -Force | Out-Null
    Copy-Item (Join-Path $Root 'scripts\windows\sf-console.ps1') (Join-Path $scripts 'sf-console.ps1') -Force
    Copy-Item (Join-Path $Root 'scripts\windows\sensor.ps1') (Join-Path $scripts 'sensor.ps1') -Force
    if (Test-Path (Join-Path $Root 'scripts\windows\sysmon-config.xml')) {
        Copy-Item (Join-Path $Root 'scripts\windows\sysmon-config.xml') (Join-Path $scripts 'sysmon-config.xml') -Force
    }
    Copy-Item (Join-Path $Root 'install.ps1')  (Join-Path $scripts 'install.ps1')  -Force
    Copy-Item (Join-Path $Root 'uninstall.ps1') (Join-Path $scripts 'uninstall.ps1') -Force
}

function Write-Shims {
    param([string]$Root, [string]$RepoId = 'Ruby570bocadito/bluetardigrade', [string]$Ref = 'main', [bool]$ConsoleExcluded = $false)
    $bin = Join-Path $Root 'bin'
    $scripts = Join-Path $Root 'scripts'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $nl = "`r`n"
    $enc = $null
    try { $enc = [Text.Encoding]::GetEncoding(0) } catch { $enc = [Text.Encoding]::ASCII }
    $consolePs1   = Join-Path $scripts 'sf-console.ps1'
    $sensorPs1    = Join-Path $scripts 'sensor.ps1'
    $installPs1   = Join-Path $scripts 'install.ps1'
    $uninstallPs1 = Join-Path $scripts 'uninstall.ps1'
    $updateArgs = "-Update -InstallDir `"$Root`" -Repo `"$RepoId`" -Branch `"$Ref`""
    if ($ConsoleExcluded) { $updateArgs += ' -NoConsole' }
    # sf-engine is exposed as a hard-linked exe, not a .cmd wrapper:
    # Ctrl+C on a batch wrapper makes cmd ask 'Terminate batch job
    # (Y/N)?'. The engine resolves rules next to its own exe.
    # NOTE: single pair - do not use foreach over @(@('a','b')) here,
    # PowerShell unrolls a one-element array-of-arrays into a flat array
    # and $pair[0] becomes a char (real bug caught by the shim test).
    $link = Join-Path $bin 'sf-engine.exe'
    $target = Join-Path $bin 'engine.exe'
    if (Test-Path $link) { Remove-Item $link -Force -ErrorAction SilentlyContinue }
    try {
        New-Item -ItemType HardLink -Path $link -Target $target -ErrorAction Stop | Out-Null
    } catch {
        if (Test-Path $target) { Copy-Item $target $link -Force }
        else { Write-Warn2 "engine.exe not found; sf-engine shim skipped" }
    }
    Remove-Item (Join-Path $bin 'sf-engine.cmd') -Force -ErrorAction SilentlyContinue
    # Remove obsolete shipped demo code and launchers on upgrade.
    foreach ($obsolete in @('bin\sf-devsensor.exe', 'bin\sf-devsensor.cmd', 'bin\devsensor.exe', 'scripts\devsensor.ps1', 'scripts\windows\devsensor.ps1', 'cmd\devsensor', 'cmd\bench')) {
        Remove-Item (Join-Path $Root $obsolete) -Recurse -Force -ErrorAction SilentlyContinue
    }
    $collectorLink = Join-Path $bin 'sf-collector.exe'
    $collectorTarget = Join-Path $bin 'collector.exe'
    Remove-Item $collectorLink -Force -ErrorAction SilentlyContinue
    if (Test-Path $collectorTarget) {
        try { New-Item -ItemType HardLink -Path $collectorLink -Target $collectorTarget -ErrorAction Stop | Out-Null }
        catch { Copy-Item $collectorTarget $collectorLink -Force }
    }
    # sf-update/sf-uninstall self-copy to %TEMP% and run the copy: they
    # delete files under <Root>\bin (their own folder) while running, and
    # cmd prints "The system cannot find the path specified" if it has to
    # keep reading the original .cmd after that. Invoking the copy without
    # CALL transfers control, so the original is never read again.
    # (built as line arrays: avoids "$nlif"-style variable-name pitfalls)
    $shims = [ordered]@{
        'sf-console.cmd' = "@echo off$nl powershell -NoProfile -ExecutionPolicy Bypass -File `"$consolePs1`" %*$nl"
        'sf-sensor.cmd' = "@echo off$nl powershell -NoProfile -ExecutionPolicy Bypass -File `"$sensorPs1`" %*$nl"
        'sf-update.cmd' = (@(
            '@echo off'
            'if "%~1"=="-run" goto :run'
            'copy /y "%~f0" "%TEMP%\sf-update.cmd" >nul'
            '"%TEMP%\sf-update.cmd" -run'
            ':run'
            "powershell -NoProfile -ExecutionPolicy Bypass -File `"$installPs1`" $updateArgs"
        ) -join $nl) + $nl
        'sf-uninstall.cmd' = (@(
            '@echo off'
            'if "%~1"=="-run" goto :run'
            'copy /y "%~f0" "%TEMP%\sf-uninstall.cmd" >nul'
            "copy /y `"$uninstallPs1`" `"%TEMP%\sf-uninstall.ps1`" >nul"
            '"%TEMP%\sf-uninstall.cmd" -run'
            ':run'
            "powershell -NoProfile -ExecutionPolicy Bypass -File `"%TEMP%\sf-uninstall.ps1`" -InstallDir `"$Root`""
        ) -join $nl) + $nl
    }
    foreach ($k in $shims.Keys) {
        [IO.File]::WriteAllText((Join-Path $bin $k), $shims[$k], $enc)
    }
    Write-Ok "sf-engine / sf-collector / sf-sensor / sf-console / sf-update / sf-uninstall"
}

function Add-ToUserPath {
    param([string]$Dir)
    $dirLow = $Dir.TrimEnd('\').ToLower()
    $raw = $null
    try {
        $q = Invoke-Native -Command { & reg query HKCU\Environment /v Path } -Quiet -AllowFailure
        if ($q) {
            foreach ($l in $q) {
                if ($l -match '^\s*Path\s+REG_(EXPAND_)?SZ\s+(.*)$') { $raw = $Matches[2] }
            }
        }
    } catch { }
    if ($null -eq $raw) {
        try {
            [Environment]::SetEnvironmentVariable('Path', $Dir, 'User')
            Write-Ok "user PATH created"
        } catch { Write-Warn2 "could not write user PATH: $($_.Exception.Message)" }
        return
    }
    $have = [Environment]::ExpandEnvironmentVariables($raw).ToLower()
    if (($have -split ';') -contains $dirLow) { Write-Ok "PATH already up to date"; return }
    try {
        reg add HKCU\Environment /v Path /t REG_EXPAND_SZ /d "$raw;$Dir" /f | Out-Null
        Write-Ok "added to user PATH (open a NEW terminal to use sf-*)"
    } catch { Write-Warn2 "could not write user PATH: $($_.Exception.Message)" }
}

function Add-FirewallRule {
    # Scope note: this rule only makes sense when the engine is
    # explicitly started with -addr 0.0.0.0:7777 (the default bind is
    # loopback). Restricted to the domain/private profiles: an
    # unauthenticated NDJSON ingest must never be reachable from
    # public networks (cafes, airports, hotspots).
    #
    # Token gate: beyond those profiles, opening 7777 without a shared
    # token hands the whole LAN an event-injection channel, so the rule
    # is REFUSED until -IngestToken configures one. A rule left behind
    # by a pre-gate install is removed to keep the firewall state
    # consistent with the refusal (loopback sensors never needed it).
    param([bool]$HasToken = $false)
    if (-not $HasToken) {
        Write-Warn2 "-Firewall refused: no ingest token configured. Opening TCP $ENGINE_PORT without one would let any host on the network inject events (NDJSON, no auth)."
        Write-Info "configure a token and re-run:  .\install.ps1 -Firewall -IngestToken 'a-long-random-secret'"
        $chk = Invoke-Native -Command { & netsh advfirewall firewall show rule "name=security-framework engine" } -Quiet -AllowFailure
        if ("$chk" -match 'security-framework engine') {
            netsh advfirewall firewall delete rule "name=security-framework engine" | Out-Null
            Write-Warn2 "existing firewall rule REMOVED (it predates the token requirement; remote sensors need the token anyway)"
        }
        return
    }
    $profiles = 'domain,private'
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $admin = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $netshArgs = "advfirewall firewall add rule name=`"security-framework engine`" dir=in action=allow protocol=TCP localport=$ENGINE_PORT profile=$profiles"
    if (-not $admin) {
        Write-Info "not elevated: asking via UAC..."
        try {
            $p = Start-Process -FilePath 'netsh.exe' -ArgumentList $netshArgs -Verb RunAs -Wait -PassThru -ErrorAction Stop
            if ($p.ExitCode -ne 0) { throw "netsh exited with $($p.ExitCode)" }
        } catch {
            Write-Warn2 "elevation declined or failed (local sensors still work). To do it manually, in an ADMIN terminal:"
            Write-Info "netsh advfirewall firewall add rule name=`"security-framework engine`" dir=in action=allow protocol=TCP localport=$ENGINE_PORT"
            return
        }
    } else {
        netsh advfirewall firewall add rule "name=security-framework engine" dir=in action=allow protocol=TCP "localport=$ENGINE_PORT" profile=$profiles | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "netsh failed (exit $LASTEXITCODE)"; return }
    }
    $chk = Invoke-Native -Command { & netsh advfirewall firewall show rule "name=security-framework engine" } -Quiet -AllowFailure
    if ("$chk" -match 'security-framework engine') {
        Write-Ok "firewall rule added (inbound TCP $ENGINE_PORT, domain/private profiles only)"
    } else {
        Write-Warn2 "could not verify the firewall rule"
    }
}

function Set-WebhookConfig {
    # Persists the alert webhook URL under tools\config\ (tools\ is the
    # one folder non-git source refreshes keep, so the setting survives
    # updates that rebuild the tree). Empty URL clears the setting.
    # Returns the effective URL ('' when disabled).
    param([string]$File, [string]$Url)
    $u = $Url.Trim()
    if ($u -eq '') {
        if (Test-Path $File) {
            Remove-Item $File -Force
            Write-Ok "webhook removed ($File)"
        } else {
            Write-Ok "webhook not configured"
        }
        return ''
    }
    # strict charset: the URL is interpolated into the autostart command
    # line inside single quotes, so quotes/backticks/whitespace would be
    # command injection into the logon persistence, not just a bad URL
    if ($u -notmatch '^https?://[A-Za-z0-9._~:/?#\[\]@!$&*+,;=%-]+$') {
        throw "invalid -WebhookUrl: must be an http(s) URL without quotes, spaces or shell metacharacters"
    }
    New-Item -ItemType Directory -Path (Split-Path $File -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($File, $u + "`r`n")
    Write-Ok "webhook saved: $u"
    return $u
}

function Set-IngestTokenConfig {
    # Persists the shared ingest token under tools\config\ (tools\ is
    # the one folder non-git source refreshes keep, so the setting
    # survives updates that rebuild the tree). Empty token clears the
    # setting. Returns the effective token ('' when disabled).
    param([string]$File, [string]$Token)
    $t = $Token.Trim()
    if ($t -eq '') {
        if (Test-Path $File) {
            Remove-Item $File -Force
            Write-Ok "ingest token removed ($File)"
        } else {
            Write-Ok "ingest token not configured"
        }
        return ''
    }
    # the token ends up on the autostart command line and inside the
    # sensor handshake: no whitespace, no quotes, sane length
    if ($t -notmatch '^[A-Za-z0-9._~+/=-]{8,128}$') {
        throw "invalid -IngestToken: use 8-128 characters from letters/digits/._~+/=- (no spaces or quotes)"
    }
    New-Item -ItemType Directory -Path (Split-Path $File -Parent) -Force | Out-Null
    Set-Content -Path $File -Value $t -Encoding ascii
    Write-Ok "ingest token saved: sensors must send 'AUTH <token>' (-Token or SF_INGEST_TOKEN)"
    return $t
}

function Register-Autostart {
    # HKCU Run entries: always writable by the current user, no admin needed.
    # NOTE: the Run-key and firewall-rule names deliberately stay
    # 'security-framework-*': they are PERSISTED OS artifacts, and renaming
    # them mid-product-rename would orphan every existing install (old
    # entries would keep launching with no upgrade path to remove them).
    param([string]$Root, [string]$WebhookUrl = '', [string]$WebhookToken = '', [string]$IngestToken = '', [bool]$WithConsole = $true)
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    New-Item -ItemType Directory -Path (Join-Path $Root 'run') -Force | Out-Null
    # -pidfile: the engine records its PID so sf-console -Stop can stop
    # an autostart-launched instance (the Run entry does not go through
    # sf-console, which is how run\engine.pid used to exist only when
    # the console launcher happened to start the engine itself).
    $engineArgs = "-rules '$Root\rules' -pidfile '$Root\run\engine.pid'"
    if ($WebhookUrl) { $engineArgs = "$engineArgs -webhook '$WebhookUrl'" }
    if ($WebhookToken) { $engineArgs = "$engineArgs -webhook-token '$WebhookToken'" }
    if ($IngestToken) { $engineArgs = "$engineArgs -token '$IngestToken'" }
    $engineCmd  = "powershell.exe -NoProfile -WindowStyle Minimized -ExecutionPolicy Bypass -Command `"& '$Root\bin\engine.exe' $engineArgs`""
    $consoleCmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\scripts\sf-console.ps1`" -NoBrowser"
    try {
        if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
        New-ItemProperty -Path $runKey -Name 'security-framework-engine'  -Value $engineCmd  -PropertyType String -Force | Out-Null
        if ($WithConsole) {
            New-ItemProperty -Path $runKey -Name 'security-framework-console' -Value $consoleCmd -PropertyType String -Force | Out-Null
        } else { Remove-ItemProperty -Path $runKey -Name 'security-framework-console' -ErrorAction SilentlyContinue }
        $chk = Get-ItemProperty -Path $runKey
        if ($chk.'security-framework-engine' -and (-not $WithConsole -or $chk.'security-framework-console')) {
            $note = 'engine minimized'
            if ($WithConsole) { $note += ' + console hidden' }
            if ($WebhookUrl) { $note += ", alerts POST to $WebhookUrl" }
            if ($IngestToken) { $note += ', ingest auth on' }
            Write-Ok "autostart at logon registered ($note)"
        } else {
            Write-Warn2 "autostart entries could not be verified in the registry"
        }
    } catch { Write-Warn2 "autostart registration failed: $($_.Exception.Message)" }
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
        try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch { }
    }
}

# ======================================================================
# main (skipped when the script is dot-sourced for testing)
# ======================================================================
if ($MyInvocation.InvocationName -ne '.') {

    if ($PSVersionTable.PSVersion.Major -lt 5) { throw "PowerShell 5.1 or newer required" }
    if ($Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or $Branch -notmatch '^[A-Za-z0-9._/+-]+$' -or $Branch.StartsWith('-')) { throw 'Invalid repository or source ref.' }
    $root = Resolve-InstallRoot $InstallDir
    $tools = Join-Path $root 'tools'
    $binDir = Join-Path $root 'bin'
    $sw = [Diagnostics.Stopwatch]::StartNew()

    # single-quoted here-string: the figlet art contains backticks and
    # apostrophes, both of which PowerShell re-interprets inside regular
    # quoted strings - a literal here-string prints them verbatim
    $banner = @'
 _     _            _                _ _                     _      
| |__ | |_   _  ___| |_ __ _ _ __ __| (_) __ _ _ __ __ _  __| | ___ 
| '_ \| | | | |/ _ \ __/ _` | '__/ _` | |/ _` | '__/ _` |/ _` |/ _ \
| |_) | | |_| |  __/ || (_| | | | (_| | | (_| | | | (_| | (_| |  __/
|_.__/|_|\__,_|\___|\__\__,_|_|  \__,_|_|\__, |_|  \__,_|\__,_|\___|
                                         |___/                      
'@
    Write-Host ''
    Write-Host '  ==========================================================' -ForegroundColor DarkCyan
    Write-Host $banner -ForegroundColor Cyan
    Write-Host '     bluetardigrade  |  Windows endpoint detection' -ForegroundColor White
    Write-Host '     engine + SOC console + Sysmon sensor' -ForegroundColor DarkGray
    Write-Host '     no admin required  |  user-level install' -ForegroundColor DarkGray
    Write-Host '  ==========================================================' -ForegroundColor DarkCyan
    Write-Host "   repo    : $Repo @ $Branch" -ForegroundColor Gray
    Write-Host "   target  : $root" -ForegroundColor Gray
    Write-Host '  ----------------------------------------------------------' -ForegroundColor DarkCyan

    if ($SourceReady) {
        Write-Ok "source already refreshed by the previous installer pass"
    } else {
        Get-SourceTree -Root $root -RepoId $Repo -Br $Branch -IsUpdate:([bool]$Update)
    }

    # self-replacement: if the update fetched a NEWER installer than the
    # one now running (sf-update always runs the previous copy from
    # scripts\), hand over to the fresh one so shims, messages and
    # behavior come from the version just downloaded - not one install
    # behind. The -SourceReady flag prevents a second download; the path
    # + hash guards prevent any chance of an infinite loop.
    if ($Update -and -not $SourceReady -and
        (Test-InstallerStale -Root $root -RunningPath $scriptInstallerPath -RunningHash $scriptInstallerHash)) {
        Write-Step "Installer updated - re-running with the fresh version"
        $fwd = @{ Update = $true; InstallDir = $root; SourceReady = $true }
        foreach ($k in @('Repo','Branch','NoConsole','WithSensor','Firewall','AutoStart','WebhookUrl','WebhookToken','IngestToken','SkipBuild')) {
            if ($PSBoundParameters.ContainsKey($k)) { $fwd[$k] = $PSBoundParameters[$k] }
        }
        & (Join-Path $root 'install.ps1') @fwd
        return
    }

    New-Item -ItemType Directory -Path $tools -Force | Out-Null
    Ensure-Go   -Tools $tools
    $nodeExe = $null
    if (-not $NoConsole) {
        $nodeExe = Ensure-Node -Tools $tools
        Ensure-Bun -Tools $tools
    }

    $consoleReady = $false
    $consoleError = ''
    if ($SkipBuild) {
        Write-Warn2 "-SkipBuild: binaries not compiled"
    } else {
        Build-Engine -Root $root
        if (-not $NoConsole) {
            try { Build-Console -Root $root -NodeExe $nodeExe; $consoleReady = $true }
            catch {
                $consoleError = $_.Exception.Message
                Write-Warn2 "console build failed: $($_.Exception.Message)"
                Write-Info "engine installed anyway; re-run with -Update to retry the console"
            }
        }
        if ($WithSensor) { Build-Sensor -Root $root }
    }

    Copy-RuntimeScripts -Root $root
    Write-Shims -Root $root -RepoId $Repo -Ref $Branch -ConsoleExcluded:([bool]$NoConsole)
    Add-ToUserPath -Dir $binDir
    $env:Path = "$binDir;" + $env:Path

    # ingest token: -IngestToken rewrites the persisted one (empty
    # clears); without the flag an existing one is picked up so
    # sf-update and re-installs keep the auth config untouched
    $ingestToken = ''
    $tokFile = Join-Path $tools 'config\ingest.token'
    if ($PSBoundParameters.ContainsKey('IngestToken')) {
        $ingestToken = Set-IngestTokenConfig -File $tokFile -Token $IngestToken
    } elseif (Test-Path $tokFile) {
        $raw = Get-Content $tokFile -First 1 -ErrorAction SilentlyContinue
        if ($null -ne $raw) { $ingestToken = $raw.Trim() }
    }

    if ($Firewall)   { Add-FirewallRule -HasToken:([bool]$ingestToken) }

    # webhook: -WebhookUrl rewrites the persisted URL (empty clears it);
    # without the flag an existing one is picked up, so sf-update and
    # re-installs keep the delivery config untouched
    $webhook = ''
    $whFile = Join-Path $tools 'config\webhook.url'
    if ($PSBoundParameters.ContainsKey('WebhookUrl')) {
        $webhook = Set-WebhookConfig -File $whFile -Url $WebhookUrl
    } elseif (Test-Path $whFile) {
        $raw = Get-Content $whFile -First 1 -ErrorAction SilentlyContinue
        if ($null -ne $raw) { $webhook = $raw.Trim() }
    }

    # webhook token: same rules as the URL (persisted, flag wins)
    $webhookToken = ''
    $wtFile = Join-Path $tools 'config\webhook.token'
    if ($PSBoundParameters.ContainsKey('WebhookToken')) {
        $wt = $WebhookToken.Trim()
        if ($wt -eq '') {
            if (Test-Path $wtFile) { Remove-Item $wtFile -Force; Write-Ok 'webhook token removed' }
            $webhookToken = ''
        } else {
            # same contract as -IngestToken: the value is interpolated
            # into the autostart command line (single quotes), so the
            # charset excludes everything that could break out of it
            if ($wt -notmatch '^[A-Za-z0-9._~+/=:-]{8,512}$') {
                throw "invalid -WebhookToken: use 8-512 characters from letters/digits/._~+/=:- (no spaces or quotes)"
            }
            New-Item -ItemType Directory -Path (Split-Path $wtFile -Parent) -Force | Out-Null
            Set-Content -Path $wtFile -Value $wt -Encoding ascii
            Write-Ok 'webhook token saved: deliveries carry Authorization: Bearer'
            $webhookToken = $wt
        }
    } elseif (Test-Path $wtFile) {
        $raw = Get-Content $wtFile -First 1 -ErrorAction SilentlyContinue
        if ($null -ne $raw) { $webhookToken = $raw.Trim() }
    }

    # autostart: register when asked; on plain updates refresh the engine
    # entry if it already exists, so a webhook change reaches the Run key
    # without requiring -AutoStart again
    $register = [bool]$AutoStart
    if (-not $register) {
        $cur = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' `
            -Name 'security-framework-engine' -ErrorAction SilentlyContinue
        if ($cur -and $cur.'security-framework-engine') { $register = $true }
    }
    if ($register -and -not $SkipBuild) { Register-Autostart -Root $root -WebhookUrl $webhook -WebhookToken $webhookToken -IngestToken $ingestToken -WithConsole $consoleReady }

    if (Test-PortLocal $ENGINE_PORT) {
        Write-Warn2 "port $ENGINE_PORT is busy: an engine may already be running"
    }

    $sw.Stop()
    Write-Host ''
    Write-Host '  ==========================================================' -ForegroundColor DarkCyan
    if ($consoleError) { Write-Host '   Installation incomplete: console build failed' -ForegroundColor Yellow }
    elseif ($SkipBuild) { Write-Host '   Sources prepared; binaries were not built' -ForegroundColor Yellow }
    else { Write-Host "   bluetardigrade installed in $([int]$sw.Elapsed.TotalSeconds)s" -ForegroundColor Cyan }
    Write-Host "   location : $root"
    if ($webhook) {
        Write-Host " webhook  : alerts POST to $webhook"
    }
    if ($ingestToken) {
        Write-Host ' ingest   : token auth ENABLED (sensors send AUTH <token>)'
    }
    Write-Host '------------------------------------------------------------'
    Write-Host ' commands  :'
    Write-Host '   sf-engine      detection engine, prints alerts live'
    Write-Host '   sf-sensor      REAL telemetry via Sysmon (setup: sf-sensor -SetupSysmon)'
    Write-Host '   sf-collector   import observed IDS/NDR/osquery/honeypot/firewall/EML logs'
    if ($consoleReady) { Write-Host '   sf-console     web console + browser (engine + hub + UI)' }
    else { Write-Host '   console        not built in this run; re-run without -NoConsole to enable it' }
    Write-Host '   sf-update      update to the latest code and rebuild'
    Write-Host '   sf-uninstall   remove everything'
    Write-Host '------------------------------------------------------------'
    Write-Host ' quick test (open a NEW terminal first):'
    Write-Host '   real mode :  sf-sensor -SetupSysmon  (once, UAC) then sf-sensor'
    Write-Host '                -> alerts depend on observed activity and configured rules'
    if ($consoleReady) { Write-Host '   dashboard:   sf-console' }
    Write-Host '  ----------------------------------------------------------' -ForegroundColor DarkCyan
    if ($consoleReady) { Write-Host '   console:  http://localhost:3000  (engine API :7778)' -ForegroundColor Gray }
    Write-Host '  ==========================================================' -ForegroundColor DarkCyan
    if ($consoleError) { throw "Console build failed: $consoleError. Engine/collector are available; run sf-update to retry." }
}

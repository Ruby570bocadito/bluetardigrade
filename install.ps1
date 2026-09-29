# ======================================================================
# security-framework - one-command installer for Windows PowerShell 5.1+
# (also works in PowerShell 7). No admin account required.
#
#   irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/install.ps1 | iex
#
# With parameters:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ruby570bocadito/security-framework/main/install.ps1))) -WithSensor -AutoStart
#
# What it does:
#   1. Downloads the repository (git if available, GitHub zip otherwise)
#   2. Provisions portable Go + Node + Bun under <InstallDir>\tools
#      (reuses any compatible tool already on your PATH)
#   3. Builds the Go detection engine (bin\engine.exe, bin\devsensor.exe)
#   4. Builds the web console (Next.js) unless -NoConsole
#   5. Puts sf-engine, sf-devsensor, sf-sensor, sf-console, sf-update
#      and sf-uninstall on your user PATH
#
# Switches:
#   -InstallDir <path>   install location (default %LOCALAPPDATA%\security-framework)
#   -Repo <owner/name>   GitHub repository        (default Ruby570bocadito/security-framework)
#   -Branch <name>       branch or tag to install (default main)
#   -NoConsole           skip the web console (engine + rules only)
#   -WithSensor          also build the Rust ETW sensor (needs Rust + MSVC)
#   -Firewall            open TCP 7777 for remote sensors, domain and
#                        private profiles only (asks via UAC); pair it
#                        with:  sf-engine -addr 0.0.0.0:7777
#   -AutoStart           start engine + console at logon (HKCU Run, no admin)
#   -WebhookUrl <url>    POST every alert as JSON to this SIEM/SOAR endpoint;
#                        persisted, engine autostart delivers it (empty clears)
#   -Update              refresh an existing install and rebuild
#   -SkipBuild           fetch sources + tools but skip compiling (debug)
#   -SourceReady         internal: source already fetched (the updater
#                        re-runs the freshly downloaded installer with
#                        this flag instead of downloading twice)
# ======================================================================
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'security-framework'),
    [string]$Repo = 'Ruby570bocadito/security-framework',
    [string]$Branch = 'main',
    [switch]$NoConsole,
    [switch]$WithSensor,
    [switch]$Firewall,
    [switch]$AutoStart,
    [string]$WebhookUrl = '',
    [switch]$Update,
    [switch]$SkipBuild,
    [switch]$SourceReady
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest usable on PS 5.1

$GO_VERSION   = '1.22.10'
$NODE_VERSION = 'v22.14.0'
$BUN_VERSION  = 'v1.3.14'
$ENGINE_PORT  = 7777
$CONSOLE_PORT = 3000
$SERVICE_PORT = 3003

# Snapshot of the running installer, taken BEFORE Get-SourceTree can
# delete scripts\ mid-run (non-git updates wipe everything but tools\).
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

# ---------------------------------------------------------------- net
function Invoke-Download {
    param([string]$Url, [string]$OutFile, [string]$ExpectedSha256)
    if (Test-Path $OutFile) { Remove-Item $OutFile -Force -ErrorAction SilentlyContinue }
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
    try { Unblock-File $OutFile -ErrorAction SilentlyContinue } catch { }
    if ($ExpectedSha256) {
        $h = (Get-FileHash $OutFile -Algorithm SHA256).Hash.ToLower()
        if ($h -ne $ExpectedSha256.ToLower()) { throw "sha256 mismatch for $Url (got $h, want $ExpectedSha256)" }
        Write-Info "sha256 verified"
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
        foreach ($line in ($raw -split "`n")) {
            if ($line -match $FilePattern) { return ($line -split '\s+')[0] }
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
    # False when: run via irm|iex (no script file), already running from
    # <Root>\install.ps1, or contents are identical.
    param([string]$Root, [string]$RunningPath, [string]$RunningHash)
    if (-not $RunningPath -or -not $RunningHash) { return $false }
    $fresh = Join-Path $Root 'install.ps1'
    if (-not (Test-Path $fresh)) { return $false }
    if ($RunningPath -ieq $fresh) { return $false }
    try {
        if ((Get-FileHash $fresh).Hash -ieq $RunningHash) { return $false }
    } catch { return $false }
    return $true
}

# ---------------------------------------------------------------- tools
function Ensure-Go {
    param([string]$Tools)
    if (Test-Path (Join-Path $Tools 'go\bin\go.exe')) {
        $env:Path = "$Tools\go\bin;" + $env:Path
        Write-Ok "Go $GO_VERSION (portable)"
        return
    }
    $sys = Get-Command go.exe -ErrorAction SilentlyContinue
    if (-not $sys) { $sys = Get-Command go -ErrorAction SilentlyContinue }
    if ($sys) {
        $v = (& $sys.Source version) 2>$null
        if ($v -match 'go version go(\d+)\.(\d+)') {
            $maj = [int]$Matches[1]; $min = [int]$Matches[2]
            if (($maj -gt 1) -or ($maj -eq 1 -and $min -ge 22)) {
                Write-Ok "Go $maj.$min (system)"
                return
            }
            Write-Warn2 "system Go is $maj.$min (need 1.22+); installing a portable one"
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
        $env:Path = "$Tools\node;" + $env:Path
        Write-Ok "Node.js $NODE_VERSION (portable)"
        return $portable
    }
    $sys = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $sys) { $sys = Get-Command node -ErrorAction SilentlyContinue }
    if ($sys) {
        $v = (& $sys.Source --version) 2>$null
        if ($v -match 'v(\d+)') {
            if ([int]$Matches[1] -ge 20) { Write-Ok "Node.js $($v.Trim()) (system)"; return $sys.Source }
            Write-Warn2 "system Node $($v.Trim()) is too old (need 20+); installing a portable one"
        }
    }
    Write-Step "Downloading Node.js $NODE_VERSION (portable, ~30 MB)"
    $zip = Join-Path $Tools 'node.zip'
    $url = "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
    $sha = Get-DistSha256 -IndexUrl "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -FilePattern "node-$NODE_VERSION-win-x64\.zip"
    Invoke-Download -Url $url -OutFile $zip -ExpectedSha256 $sha
    $dest = Join-Path $Tools 'node-tmp'
    Expand-Archive -Path $zip -DestinationPath $dest -Force
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
        $env:Path = "$Tools;" + $env:Path
        Write-Ok "Bun $BUN_VERSION (portable)"
        return
    }
    $sys = Get-Command bun.exe -ErrorAction SilentlyContinue
    if (-not $sys) { $sys = Get-Command bun -ErrorAction SilentlyContinue }
    if ($sys) {
        $v = (& $sys.Source --version) 2>$null
        if ($v -match '^\d+\.\d+') { Write-Ok "Bun $v (system)"; return }
    }
    Write-Step "Downloading Bun $BUN_VERSION (portable)"
    $zip = Join-Path $Tools 'bun.zip'
    $url = "https://github.com/oven-sh/bun/releases/download/bun-$BUN_VERSION/bun-windows-x64.zip"
    $sha = Get-DistSha256 -IndexUrl "https://github.com/oven-sh/bun/releases/download/bun-$BUN_VERSION/SHASUMS256.txt" -FilePattern 'bun-windows-x64\.zip'
    Invoke-Download -Url $url -OutFile $zip -ExpectedSha256 $sha
    $dest = Join-Path $Tools 'bun-tmp'
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    $exe = Join-Path $dest 'bun-windows-x64\bun.exe'
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
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($IsUpdate -and (Test-Path (Join-Path $Root '.git')) -and $git) {
        Write-Step "Updating source (git)"
        Push-Location $Root
        try {
            & git fetch --depth 1 origin $Br 2>&1 | Out-Null
            & git reset --hard FETCH_HEAD 2>&1 | Out-Null
        } finally { Pop-Location }
        Write-Ok "source updated"
        return
    }
    if (Test-Path $Root) {
        # refresh an existing non-git tree: keep tools/, replace the rest
        Get-ChildItem $Root -Force | Where-Object { $_.Name -ne 'tools' } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
    }
    if ($git) {
        Write-Step "Cloning $RepoId ($Br)"
        $onlyTools = (Test-Path $Root) -and
            -not (Get-ChildItem $Root -Force | Where-Object { $_.Name -ne 'tools' })
        if ($onlyTools) {
            # git clone needs an empty target: clone aside, then move in
            $tmp = Join-Path (Get-TempDir) ("sf-clone-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
            & git clone --depth 1 --branch $Br "https://github.com/$RepoId.git" $tmp 2>&1 |
                ForEach-Object { Write-Info $_ }
            if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
            Get-ChildItem $tmp -Force | Move-Item -Destination $Root -Force
            Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            & git clone --depth 1 --branch $Br "https://github.com/$RepoId.git" $Root 2>&1 |
                ForEach-Object { Write-Info $_ }
            if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
        }
        Write-Ok "source ready"
        return
    }
    Write-Step "Downloading source zip ($RepoId@$Br)"
    $zip = Join-Path (Get-TempDir) ("sf-src-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + ".zip")
    Invoke-Download -Url "https://codeload.github.com/$RepoId/zip/refs/heads/$Br" -OutFile $zip
    $tmp = Join-Path (Get-TempDir) ("sf-unz-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    Get-ChildItem $inner.FullName -Force | Move-Item -Destination $Root -Force
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Write-Ok "source ready"
}

# ---------------------------------------------------------------- build
function Build-Engine {
    param([string]$Root)
    Write-Step "Building engine (Go, first build downloads modules)"
    New-Item -ItemType Directory -Path (Join-Path $Root 'bin') -Force | Out-Null
    Push-Location $Root
    try {
        $env:GOTOOLCHAIN = 'local'
        & go build -o (Join-Path $Root 'bin\engine.exe') ./cmd/engine
        if ($LASTEXITCODE -ne 0) { throw "go build ./cmd/engine failed" }
        & go build -o (Join-Path $Root 'bin\devsensor.exe') ./cmd/devsensor
        if ($LASTEXITCODE -ne 0) { throw "go build ./cmd/devsensor failed" }
    } finally { Pop-Location }
    Write-Ok "bin\engine.exe + bin\devsensor.exe"
}

function Build-Console {
    param([string]$Root, [string]$NodeExe)
    $web = Join-Path $Root 'web'
    if (-not (Test-Path (Join-Path $web 'console\package.json'))) {
        Write-Warn2 "web console sources not found; skipping"
        return
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
        & bun install
        if ($LASTEXITCODE -ne 0) { throw "bun install (console-service) failed" }
    } finally { Pop-Location }
    Push-Location (Join-Path $web 'console')
    try {
        & bun install
        if ($LASTEXITCODE -ne 0) { throw "bun install (console) failed" }
        Write-Step "Building web console (Next.js, 1-2 min)"
        $env:NEXT_TELEMETRY_DISABLED = '1'
        & $NodeExe (Join-Path $web 'console\node_modules\next\dist\bin\next') build
        if ($LASTEXITCODE -ne 0) { throw "next build failed" }
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
        & cargo build --release
        if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
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
    Copy-Item (Join-Path $Root 'scripts\windows\devsensor.ps1') (Join-Path $scripts 'devsensor.ps1') -Force
    Copy-Item (Join-Path $Root 'scripts\windows\sensor.ps1') (Join-Path $scripts 'sensor.ps1') -Force
    if (Test-Path (Join-Path $Root 'scripts\windows\sysmon-config.xml')) {
        Copy-Item (Join-Path $Root 'scripts\windows\sysmon-config.xml') (Join-Path $scripts 'sysmon-config.xml') -Force
    }
    Copy-Item (Join-Path $Root 'install.ps1')  (Join-Path $scripts 'install.ps1')  -Force
    Copy-Item (Join-Path $Root 'uninstall.ps1') (Join-Path $scripts 'uninstall.ps1') -Force
}

function Write-Shims {
    param([string]$Root)
    $bin = Join-Path $Root 'bin'
    $scripts = Join-Path $Root 'scripts'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $nl = "`r`n"
    $enc = $null
    try { $enc = [Text.Encoding]::GetEncoding(0) } catch { $enc = [Text.Encoding]::ASCII }
    $consolePs1   = Join-Path $scripts 'sf-console.ps1'
    $devsensorPs1 = Join-Path $scripts 'devsensor.ps1'
    $sensorPs1    = Join-Path $scripts 'sensor.ps1'
    $installPs1   = Join-Path $scripts 'install.ps1'
    $uninstallPs1 = Join-Path $scripts 'uninstall.ps1'
    # sf-engine is exposed as a hard-linked exe, not a .cmd wrapper:
    # Ctrl+C on a batch wrapper makes cmd ask 'Terminate batch job
    # (Y/N)?'. The engine resolves rules next to its own exe.
    # sf-devsensor is intentionally NOT an exe: Windows Application
    # Control / Smart App Control blocks unsigned binaries (users hit
    # "una directiva de Control de aplicaciones bloqueo este archivo"
    # on devsensor.exe), so it ships as a .cmd wrapper around the
    # PowerShell simulator (devsensor.ps1) - powershell.exe is a
    # signed system interpreter those policies never block.
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
    # upgrades: drop the stale sf-devsensor.exe hardlink from previous
    # installs - .exe wins PATH resolution over .cmd (PATHEXT order)
    Remove-Item (Join-Path $bin 'sf-devsensor.exe') -Force -ErrorAction SilentlyContinue
    # sf-update/sf-uninstall self-copy to %TEMP% and run the copy: they
    # delete files under <Root>\bin (their own folder) while running, and
    # cmd prints "The system cannot find the path specified" if it has to
    # keep reading the original .cmd after that. Invoking the copy without
    # CALL transfers control, so the original is never read again.
    # (built as line arrays: avoids "$nlif"-style variable-name pitfalls)
    $shims = [ordered]@{
        'sf-console.cmd' = "@echo off$nl powershell -NoProfile -ExecutionPolicy Bypass -File `"$consolePs1`" %*$nl"
        'sf-devsensor.cmd' = "@echo off$nl powershell -NoProfile -ExecutionPolicy Bypass -File `"$devsensorPs1`" %*$nl"
        'sf-sensor.cmd' = "@echo off$nl powershell -NoProfile -ExecutionPolicy Bypass -File `"$sensorPs1`" %*$nl"
        'sf-update.cmd' = (@(
            '@echo off'
            'if "%~1"=="-run" goto :run'
            'copy /y "%~f0" "%TEMP%\sf-update.cmd" >nul'
            '"%TEMP%\sf-update.cmd" -run'
            ':run'
            "powershell -NoProfile -ExecutionPolicy Bypass -File `"$installPs1`" -Update -InstallDir `"$Root`""
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
    Write-Ok "sf-engine / sf-devsensor / sf-sensor / sf-console / sf-update / sf-uninstall"
}

function Add-ToUserPath {
    param([string]$Dir)
    $dirLow = $Dir.TrimEnd('\').ToLower()
    $raw = $null
    try {
        $q = reg query HKCU\Environment /v Path 2>$null
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
    $chk = netsh advfirewall firewall show rule "name=security-framework engine" 2>$null
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
    if ($u -notmatch '^https?://\S+$') {
        throw "invalid -WebhookUrl '$u': must be an http(s) URL"
    }
    New-Item -ItemType Directory -Path (Split-Path $File -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($File, $u + "`r`n")
    Write-Ok "webhook saved: $u"
    return $u
}

function Register-Autostart {
    # HKCU Run entries: always writable by the current user, no admin needed
    param([string]$Root, [string]$WebhookUrl = '')
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $engineArgs = "-rules '$Root\rules'"
    if ($WebhookUrl) { $engineArgs = "$engineArgs -webhook '$WebhookUrl'" }
    $engineCmd  = "powershell.exe -NoProfile -WindowStyle Minimized -ExecutionPolicy Bypass -Command `"& '$Root\bin\engine.exe' $engineArgs`""
    $consoleCmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\scripts\sf-console.ps1`" -NoBrowser"
    try {
        if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
        New-ItemProperty -Path $runKey -Name 'security-framework-engine'  -Value $engineCmd  -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $runKey -Name 'security-framework-console' -Value $consoleCmd -PropertyType String -Force | Out-Null
        $chk = Get-ItemProperty -Path $runKey
        if ($chk.'security-framework-engine' -and $chk.'security-framework-console') {
            $note = 'engine minimized + console hidden'
            if ($WebhookUrl) { $note += ", alerts POST to $WebhookUrl" }
            Write-Ok "autostart at logon registered ($note)"
        } else {
            Write-Warn2 "autostart entries could not be verified in the registry"
        }
    } catch { Write-Warn2 "autostart registration failed: $($_.Exception.Message)" }
}

function Stop-SfProcesses {
    param([string]$Root)
    $rootLow = $Root.ToLower().TrimEnd('\')
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
            $procId = Get-Content $_.FullName -ErrorAction SilentlyContinue
            if ($procId -match '^\d+$') { Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue }
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
    if (-not $env:LOCALAPPDATA) { $InstallDir = Join-Path $env:USERPROFILE 'security-framework' }
    $root = $InstallDir.TrimEnd('\')
    $tools = Join-Path $root 'tools'
    $binDir = Join-Path $root 'bin'
    $sw = [Diagnostics.Stopwatch]::StartNew()

    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' security-framework installer (Windows, no admin required)'
    Write-Host " repo   : $Repo @ $Branch"
    Write-Host " target : $root"
    Write-Host '============================================================'

    # stop leftovers from a previous install, then refresh the tree
    if (Test-Path $root) {
        Write-Step "Existing install found (tools are preserved)"
        Stop-SfProcesses -Root $root
    }
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
        foreach ($k in @('Repo','Branch','NoConsole','WithSensor','Firewall','AutoStart','WebhookUrl','SkipBuild')) {
            if ($PSBoundParameters.ContainsKey($k)) { $fwd[$k] = $PSBoundParameters[$k] }
        }
        & (Join-Path $root 'install.ps1') @fwd
        return
    }

    New-Item -ItemType Directory -Path $tools -Force | Out-Null
    Ensure-Go   -Tools $tools
    $nodeExe = Ensure-Node -Tools $tools
    Ensure-Bun  -Tools $tools

    if ($SkipBuild) {
        Write-Warn2 "-SkipBuild: binaries not compiled"
    } else {
        Build-Engine -Root $root
        if (-not $NoConsole) {
            try { Build-Console -Root $root -NodeExe $nodeExe }
            catch {
                Write-Warn2 "console build failed: $($_.Exception.Message)"
                Write-Info "engine installed anyway; re-run with -Update to retry the console"
            }
        }
        if ($WithSensor) { Build-Sensor -Root $root }
    }

    Copy-RuntimeScripts -Root $root
    Write-Shims -Root $root
    Add-ToUserPath -Dir $binDir
    $env:Path = "$binDir;" + $env:Path

    if ($Firewall)   { Add-FirewallRule }

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

    # autostart: register when asked; on plain updates refresh the engine
    # entry if it already exists, so a webhook change reaches the Run key
    # without requiring -AutoStart again
    $register = [bool]$AutoStart
    if (-not $register) {
        $cur = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' `
            -Name 'security-framework-engine' -ErrorAction SilentlyContinue
        if ($cur -and $cur.'security-framework-engine') { $register = $true }
    }
    if ($register) { Register-Autostart -Root $root -WebhookUrl $webhook }

    if (Test-PortLocal $ENGINE_PORT) {
        Write-Warn2 "port $ENGINE_PORT is busy: an engine may already be running"
    }

    $sw.Stop()
    Write-Host ''
    Write-Host '============================================================'
    Write-Host " security-framework installed in $([int]$sw.Elapsed.TotalSeconds)s"
    Write-Host " location : $root"
    if ($webhook) {
        Write-Host " webhook  : alerts POST to $webhook"
    }
    Write-Host '------------------------------------------------------------'
    Write-Host ' commands  :'
    Write-Host '   sf-engine      detection engine, prints alerts live'
    Write-Host '   sf-sensor      REAL telemetry via Sysmon (setup: sf-sensor -SetupSysmon)'
    Write-Host '   sf-devsensor   demo scenario replay - simulated data, for pipeline check'
    Write-Host '   sf-console     web console + browser (engine + hub + UI)'
    Write-Host '   sf-update      update to the latest code and rebuild'
    Write-Host '   sf-uninstall   remove everything'
    Write-Host '------------------------------------------------------------'
    Write-Host ' quick test (open a NEW terminal first):'
    Write-Host '   real mode :  sf-sensor -SetupSysmon  (once, UAC) then sf-sensor'
    Write-Host '                -> alerts from ACTUAL host activity, visible in sf-console'
    Write-Host '   demo only :  sf-devsensor      -> 18 alerts from the scripted scenario'
    Write-Host '   or simply:   sf-console'
    Write-Host '============================================================'
}

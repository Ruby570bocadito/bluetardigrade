# Shared configuration and process ownership for installed/repository launchers.
function Get-SfSetting {
    param([string]$Root, [string]$EnvironmentName, [string]$FileName, [string]$Explicit = '')
    if ($Explicit) { return $Explicit }
    $value = [Environment]::GetEnvironmentVariable($EnvironmentName, 'Process')
    if ($value) { return $value }
    $file = Join-Path $Root ('tools\config\' + $FileName)
    if (Test-Path -LiteralPath $file) { return ([string](Get-Content -LiteralPath $file -First 1 -ErrorAction Stop)).Trim() }
    return ''
}

# The local API carries a bearer token on every install, so the write
# surfaces the console uses (suppressions, incidents, response) are never
# open to an unauthenticated local process. Created once, user-only like
# the rest of tools\config; engine, console, hub and doctor all read it.
function Initialize-SfApiToken {
    param([string]$Root)
    $existing = Get-SfSetting $Root 'SF_API_TOKEN' 'api.token'
    if ($existing) { return $existing }
    $config = Join-Path $Root 'tools\config'
    New-Item -ItemType Directory -Path $config -Force | Out-Null
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    [IO.File]::WriteAllText((Join-Path $config 'api.token'), $token, [Text.Encoding]::ASCII)
    return $token
}

# Engine arguments for a managed start: rules and pid file as before,
# plus the console's write surfaces (suppressions from the alert view,
# behind the bearer token) and SQLite history under data\. Active
# response is armed only when the operator created an allowlist with
# per-operator credentials (tools\config\respond-operators.yaml, see
# 'sf-engine operator-credential'); without it the surface stays off.
function Get-SfEngineArguments {
    param([string]$Root)
    $data = Join-Path $Root 'data'
    $arguments = "-rules `"$Root\rules`" -pidfile `"$Root\run\engine.pid`" -api-write -store `"$data\sf-store.db`""
    # Offline threat-intel lists: plain files the operator drops in
    # intel\ (intel\README.md); the engine re-reads them and downloads
    # nothing.
    $arguments += " -intel `"$Root\intel`""
    # Detection validation: the inert scenario library in scenarios\
    # arms the console's Validation view, which replays it inside the
    # engine against the live rules. The replay stays in its own alert
    # manager (no ring, store row, webhook or risk) and the machine sees
    # nothing: the events are synthetic and never leave the process.
    $scenarios = Join-Path $Root 'scenarios'
    if (Test-Path -LiteralPath $scenarios -PathType Container) { $arguments += " -scenarios `"$scenarios`"" }
    # Read-only Active Directory connector: armed only when the operator
    # wrote tools\config\ad.yaml (copy of ad.example.yaml with the CA and
    # the service account's password file).
    $ad = Join-Path $Root 'tools\config\ad.yaml'
    if (Test-Path -LiteralPath $ad) { $arguments += " -ad `"$ad`"" }
    # External notifications (Slack, Telegram, email, ntfy): always armed,
    # so the console can create tools\config\notify.yaml from Ajustes ->
    # Avisos externos and the engine applies it without a restart; a
    # missing file is no channels, a broken one stops the engine fail-loud
    # at startup (sf-engine doctor names the exact problem before that).
    $arguments += " -notify `"$Root\tools\config\notify.yaml`""
    # Domain sign-in (AD-7): armed only when the operator wrote
    # tools\config\domain-auth.yaml (copy of domain-auth.example.yaml);
    # sf-console turns the console's «Cuenta del dominio» on from the
    # same file.
    $domainAuth = Join-Path $Root 'tools\config\domain-auth.yaml'
    if (Test-Path -LiteralPath $domainAuth) { $arguments += " -domain-auth `"$domainAuth`"" }
    # Host groups (sites, departments, OUs): always armed, so the console
    # can create the file from Ajustes -> Grupos; a missing file is an
    # empty list, a broken one stops the engine (sf-engine doctor names it).
    $arguments += " -host-groups `"$Root\tools\config\host-groups.yaml`""
    $operators = Join-Path $Root 'tools\config\respond-operators.yaml'
    if (Test-Path -LiteralPath $operators) {
        $arguments += " -allow-kill -respond-operators `"$operators`" -respond-audit `"$data\respond-audit.jsonl`""
    }
    # Remote machines (docs/FLOTA-REMOTA.md): the ingest listens beyond
    # loopback only when every sensor must authenticate. Per-sensor
    # identities (a token bound to its host names) do that; so does an
    # ingest certificate pair, which turns on TLS and enrollment by token
    # from the console (the credential it hands out travels only inside
    # TLS; machines wait for approval in Equipos). On that path the
    # sensor of this machine needs a credential too: enroll it from the
    # console, or give it the shared ingest token.
    $identities = Join-Path $Root 'tools\config\ingest-identities.yaml'
    $cert = Join-Path $Root 'tools\config\ingest-cert.pem'
    $key = Join-Path $Root 'tools\config\ingest-key.pem'
    $hasIdentities = Test-Path -LiteralPath $identities
    $hasCert = (Test-Path -LiteralPath $cert) -and (Test-Path -LiteralPath $key)
    if ($hasIdentities -or $hasCert) {
        $arguments += " -addr 0.0.0.0:7777"
        if ($hasIdentities) { $arguments += " -ingest-identities `"$identities`"" }
        if ($hasCert) { $arguments += " -ingest-cert `"$cert`" -ingest-key `"$key`" -enroll `"$data\enrollment.json`"" }
    }
    return $arguments
}

function Start-SfEngine {
    param([string]$Root, [string]$Executable, [string]$IngestToken = '')
    $settings = @{
        SF_INGEST_TOKEN = Get-SfSetting $Root 'SF_INGEST_TOKEN' 'ingest.token' $IngestToken
        SF_API_TOKEN = Initialize-SfApiToken $Root
        SF_WEBHOOK_URL = Get-SfSetting $Root 'SF_WEBHOOK_URL' 'webhook.url'
        SF_WEBHOOK_TOKEN = Get-SfSetting $Root 'SF_WEBHOOK_TOKEN' 'webhook.token'
        SF_BASELINE_LEARN = Get-SfSetting $Root 'SF_BASELINE_LEARN' 'baseline.learn'
    }
    $previous = @{}
    try {
        foreach ($key in $settings.Keys) {
            $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
        }
        New-Item -ItemType Directory -Path (Join-Path $Root 'run'), (Join-Path $Root 'data') -Force | Out-Null
        $arguments = Get-SfEngineArguments $Root
        $process = Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru -ErrorAction Stop
        Set-Content -LiteralPath (Join-Path $Root 'run\engine.pid') -Value $process.Id
        return $process
    } finally {
        foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    }
}

function Test-SfOwnedProcess {
    param($Process, [string]$Root)
    if (-not $Process) { return $false }
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $comparison = [StringComparison]::OrdinalIgnoreCase
    if ($Process.ExecutablePath -and $Process.ExecutablePath.StartsWith($prefix, $comparison)) { return $true }
    # A system Node/Bun executable is owned only when its script path is
    # rooted here, not when an unrelated process merely mentions this folder.
    if ($Process.ExecutablePath -notmatch '(?i)[\\/](node|bun)\.exe$') { return $false }
    $command = [string]$Process.CommandLine
    return ($command.IndexOf('"' + $prefix + 'web\', $comparison) -ge 0 -or
            $command.IndexOf(' ' + $prefix + 'web\', $comparison) -ge 0)
}

function Stop-SfTrackedProcesses {
    param([string]$Root)
    $runDir = Join-Path $Root 'run'
    foreach ($name in @('engine.pid', 'console.pid', 'console-service.pid')) {
        $file = Join-Path $runDir $name
        if (-not (Test-Path -LiteralPath $file)) { continue }
        $raw = Get-Content -LiteralPath $file -First 1 -ErrorAction SilentlyContinue
        $reported = 0
        if ([int]::TryParse([string]$raw, [ref]$reported) -and $reported -gt 0 -and $reported -ne $PID) {
            $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $reported" -ErrorAction SilentlyContinue
            if (Test-SfOwnedProcess $candidate $Root) { Stop-Process -Id $reported -Force -ErrorAction SilentlyContinue }
        }
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $PID -and (Test-SfOwnedProcess $_ $Root) -and
        ($_.ExecutablePath -match '(?i)[\\/](sf-)?engine\.exe$' -or $_.CommandLine -match 'console-service|next|server\.js')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# Who listens on a local port, and whether it belongs to this install.
# A bare connect test cannot tell the console from any other program on
# 3000: sf-console announced "console already running" for a port another
# program held while sf-status said stopped. State is 'free', 'ours',
# 'foreign' (another program, named) or 'unknown' (something answers but
# its listener is not visible). A process started from an elevated window
# hides its path from a normal one, so the pid file recorded at start
# also proves ownership.
function Get-SfPortOwner {
    param([int]$Port, [string]$Root, [string]$PidName)
    $listen = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listen.Count -eq 0) {
        $client = New-Object Net.Sockets.TcpClient
        $answers = $false
        try { $client.Connect('127.0.0.1', $Port); $answers = $true } catch { } finally { $client.Close() }
        $state = if ($answers) { 'unknown' } else { 'free' }
        return [pscustomobject]@{ State = $state; Pid = 0; Name = ''; Detail = '' }
    }
    $ownerPid = [int]$listen[0].OwningProcess
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
    $name = if ($process) { [string]$process.Name } else { [string](Get-Process -Id $ownerPid -ErrorAction SilentlyContinue).ProcessName }
    # node.exe alone says little: the script it runs names the program
    # (a video render holding :3000 reads "remotion-cli.js")
    $detail = ''
    if ($process -and [string]$process.CommandLine -match '([^\\/"\s]+\.(?:m?js|cjs|ts|py))(?=["\s]|$)') { $detail = $Matches[1] }
    $tracked = 0
    if ($PidName) {
        $file = Join-Path (Join-Path $Root 'run') $PidName
        if (Test-Path -LiteralPath $file) { [void][int]::TryParse([string](Get-Content -LiteralPath $file -First 1), [ref]$tracked) }
    }
    # an administrator's (or another user's) process hides its path from
    # a normal window: it may be this installation started elevated
    $state = if ((Test-SfOwnedProcess $process $Root) -or ($tracked -gt 0 -and $tracked -eq $ownerPid)) { 'ours' }
             elseif ($process -and -not $process.ExecutablePath) { 'hidden' }
             else { 'foreign' }
    return [pscustomobject]@{ State = $state; Pid = $ownerPid; Name = $name; Detail = $detail }
}

# The console port of the last start (sf-console -ConsolePort 3100 sticks
# for sf-start, sf-status and the browser), 3000 when none was recorded.
function Get-SfConsolePort {
    param([string]$Root)
    $file = Join-Path (Join-Path $Root 'run') 'console.port'
    $port = 0
    if ((Test-Path -LiteralPath $file) -and [int]::TryParse([string](Get-Content -LiteralPath $file -First 1), [ref]$port) -and $port -gt 0 -and $port -lt 65536) { return $port }
    return 3000
}

function Set-SfConsolePort {
    param([string]$Root, [int]$Port)
    $run = Join-Path $Root 'run'
    New-Item -ItemType Directory -Path $run -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $run 'console.port') -Value $Port
}

# One status line: name, port, a coloured state and the detail, aligned
# like the installer's [ok] / [!] lines.
function Write-SfStatusLine {
    param([string]$Name, [string]$Port, [ValidateSet('ok', 'off', 'warn')][string]$Kind, [string]$Text)
    $mark = @{ ok = '[ok]'; off = '[--]'; warn = '[!] ' }[$Kind]
    $color = @{ ok = 'Green'; off = 'DarkGray'; warn = 'Yellow' }[$Kind]
    Write-Host ('  {0,-8} {1,-6} ' -f $Name, $Port) -NoNewline
    Write-Host $mark -ForegroundColor $color -NoNewline
    Write-Host " $Text"
}

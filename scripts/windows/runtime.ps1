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
    $operators = Join-Path $Root 'tools\config\respond-operators.yaml'
    if (Test-Path -LiteralPath $operators) {
        $arguments += " -allow-kill -respond-operators `"$operators`" -respond-audit `"$data\respond-audit.jsonl`""
    }
    # Remote machines (docs/FLOTA-REMOTA.md): only when per-sensor
    # identities exist does the ingest listen beyond loopback, so every
    # remote sensor authenticates with its own token bound to its host
    # names. A certificate pair next to it turns on TLS for the ingest.
    $identities = Join-Path $Root 'tools\config\ingest-identities.yaml'
    if (Test-Path -LiteralPath $identities) {
        $arguments += " -addr 0.0.0.0:7777 -ingest-identities `"$identities`""
        $cert = Join-Path $Root 'tools\config\ingest-cert.pem'
        $key = Join-Path $Root 'tools\config\ingest-key.pem'
        if ((Test-Path -LiteralPath $cert) -and (Test-Path -LiteralPath $key)) {
            $arguments += " -ingest-cert `"$cert`" -ingest-key `"$key`""
        }
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

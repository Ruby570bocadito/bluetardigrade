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

function Start-SfEngine {
    param([string]$Root, [string]$Executable, [string]$IngestToken = '')
    $settings = @{
        SF_INGEST_TOKEN = Get-SfSetting $Root 'SF_INGEST_TOKEN' 'ingest.token' $IngestToken
        SF_WEBHOOK_URL = Get-SfSetting $Root 'SF_WEBHOOK_URL' 'webhook.url'
        SF_WEBHOOK_TOKEN = Get-SfSetting $Root 'SF_WEBHOOK_TOKEN' 'webhook.token'
    }
    $previous = @{}
    try {
        foreach ($key in $settings.Keys) {
            $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
        }
        New-Item -ItemType Directory -Path (Join-Path $Root 'run') -Force | Out-Null
        $arguments = "-rules `"$Root\rules`" -pidfile `"$Root\run\engine.pid`""
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

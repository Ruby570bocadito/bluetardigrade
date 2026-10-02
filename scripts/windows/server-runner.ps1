# A Task Scheduler action must stay attached to its foreground child for
# restart-on-failure to work. No GUI, browser, logon profile or PATH lookup.
param(
    [Parameter(Mandatory)][string]$InstallDir,
    [Parameter(Mandatory)][ValidateSet('Engine', 'Hub', 'Console', 'Sysmon', 'ETW')][string]$Component
)
$ErrorActionPreference = 'Stop'
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    throw 'The server runner is not authorized by this Windows App Control policy. Review docs/SMART-APP-CONTROL.md.'
}
$root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\', '/')
. (Join-Path $PSScriptRoot 'runtime.ps1')
$previous = @{}
$previousDirectory = Get-Location
$exitCode = 1
$transcriptStarted = $false
try {
    # Persisted server credentials win over the SYSTEM account's environment;
    # the engine, sensor, bridge and console all use the same protected files.
    $settings = @{
        SF_INGEST_TOKEN = 'ingest.token'
        SF_API_TOKEN = 'api.token'
        SF_WEBHOOK_URL = 'webhook.url'
        SF_WEBHOOK_TOKEN = 'webhook.token'
    }
    foreach ($key in $settings.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        $file = Join-Path $root ('tools\config\' + $settings[$key])
        $value = ''
        if (Test-Path -LiteralPath $file) { $value = ([string](Get-Content -LiteralPath $file -First 1)).Trim() }
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
    if (-not $env:SF_INGEST_TOKEN -or -not $env:SF_API_TOKEN) { throw 'Server credentials are missing; rerun server.ps1 -Action Register.' }
    New-Item -ItemType Directory -Path (Join-Path $root 'run') -Force | Out-Null
    $logFile = Join-Path $root ('run\server-' + $Component.ToLowerInvariant() + '.log')
    if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 20MB) {
        Move-Item -LiteralPath $logFile -Destination ($logFile + '.previous') -Force
    }
    Start-Transcript -Path $logFile -Append -ErrorAction Stop | Out-Null
    $transcriptStarted = $true
    Set-Location -LiteralPath $root
    switch ($Component) {
        'Engine' {
            & (Join-Path $root 'bin\engine.exe') -rules (Join-Path $root 'rules') -addr '127.0.0.1:7777' -api '127.0.0.1:7778' -store (Join-Path $root 'run\soc.db') -pidfile (Join-Path $root 'run\engine.pid')
        }
        'Hub' {
            foreach ($key in @('PORT', 'CONSOLE_SERVICE_PORT', 'CONSOLE_HOST', 'CONSOLE_CORS_ORIGIN', 'ENGINE_API')) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
            $env:PORT = '3003'
            $env:CONSOLE_SERVICE_PORT = '3003'
            $env:CONSOLE_HOST = '127.0.0.1'
            $env:CONSOLE_CORS_ORIGIN = 'http://localhost:3000,http://127.0.0.1:3000'
            $env:ENGINE_API = 'http://127.0.0.1:7778'
            Set-Location -LiteralPath (Join-Path $root 'web\console-service')
            & (Join-Path $root 'tools\bun.exe') (Join-Path $root 'web\console-service\index.ts')
        }
        'Console' {
            $previous['ENGINE_API_URL'] = [Environment]::GetEnvironmentVariable('ENGINE_API_URL', 'Process')
            $env:ENGINE_API_URL = 'http://127.0.0.1:7778'
            Set-Location -LiteralPath (Join-Path $root 'web\console')
            & (Join-Path $root 'tools\node\node.exe') (Join-Path $root 'web\console\node_modules\next\dist\bin\next') start -H '127.0.0.1' -p 3000
        }
        'Sysmon' { & (Join-Path $root 'scripts\sensor.ps1') -Addr '127.0.0.1:7777' -NoEngine -Quiet }
        'ETW' { & (Join-Path $root 'bin\security-sensor.exe') --addr '127.0.0.1:7777' }
    }
    if ($null -eq $LASTEXITCODE) { $exitCode = 0 } else { $exitCode = $LASTEXITCODE }
    # A long-running component exiting unexpectedly must be eligible for
    # Task Scheduler's restart policy, including clean early exits.
    if ($exitCode -eq 0) { $exitCode = 1 }
} catch {
    Write-Error ('Server component ' + $Component + ' stopped: ' + $_.Exception.Message) -ErrorAction Continue
} finally {
    if ($transcriptStarted) { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null }
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    Set-Location -LiteralPath $previousDirectory.Path
}
exit $exitCode

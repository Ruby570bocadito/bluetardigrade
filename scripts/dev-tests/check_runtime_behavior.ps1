$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot)
. (Join-Path $repo 'scripts\windows\runtime.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('sf-runtime-test-' + [guid]::NewGuid().ToString('N'))
$saved = @{}
foreach ($key in @('SF_INGEST_TOKEN', 'SF_WEBHOOK_URL', 'SF_WEBHOOK_TOKEN')) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $null, 'Process')
}
function Assert($Value, $Message) { if (-not $Value) { throw $Message } }
try {
    New-Item -ItemType Directory (Join-Path $testRoot 'tools\config') -Force | Out-Null
    Set-Content (Join-Path $testRoot 'tools\config\ingest.token') 'saved-token'
    Set-Content (Join-Path $testRoot 'tools\config\webhook.url') 'http://127.0.0.1:1/hook'
    Set-Content (Join-Path $testRoot 'tools\config\webhook.token') 'saved-webhook'
    Assert ((Get-SfSetting $testRoot 'SF_INGEST_TOKEN' 'ingest.token') -eq 'saved-token') 'Persisted token not read'
    $env:SF_INGEST_TOKEN = 'env-token'
    Assert ((Get-SfSetting $testRoot 'SF_INGEST_TOKEN' 'ingest.token') -eq 'env-token') 'Environment precedence lost'
    Assert ((Get-SfSetting $testRoot 'SF_INGEST_TOKEN' 'ingest.token' 'flag-token') -eq 'flag-token') 'Explicit precedence lost'
    function Start-Process {
        param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, [switch]$PassThru, $ErrorAction)
        Assert ($env:SF_INGEST_TOKEN -eq 'flag-token') 'Child ingest token differs'
        Assert ($env:SF_WEBHOOK_TOKEN -eq 'saved-webhook') 'Child webhook token missing'
        Assert ($env:SF_WEBHOOK_URL -eq 'http://127.0.0.1:1/hook') 'Child webhook URL missing'
        Assert ($WorkingDirectory -eq $testRoot) 'State working directory differs'
        Assert ($ArgumentList -notmatch 'saved-token|flag-token|saved-webhook') 'Secret in process arguments'
        return [pscustomobject]@{ Id = 42424 }
    }
    Start-SfEngine $testRoot (Join-Path $testRoot 'bin\engine.exe') 'flag-token' | Out-Null
    Assert ($env:SF_INGEST_TOKEN -eq 'env-token' -and -not $env:SF_WEBHOOK_TOKEN) 'Parent environment not restored'
    Remove-Item Function:Start-Process
    $owned = [pscustomobject]@{ ExecutablePath = (Join-Path $testRoot 'bin\engine.exe'); CommandLine = ''; ProcessId = 42424 }
    $foreign = [pscustomobject]@{ ExecutablePath = ($testRoot + '-backup\bin\engine.exe'); CommandLine = ''; ProcessId = 42424 }
    Assert (Test-SfOwnedProcess $owned $testRoot) 'Owned engine rejected'
    Assert (-not (Test-SfOwnedProcess $foreign $testRoot)) 'Sibling directory accepted'
    $node = [pscustomobject]@{ ExecutablePath = 'C:\Program Files\nodejs\node.exe'; CommandLine = ('node "' + $testRoot + '\web\console\node_modules\next\dist\bin\next" start') }
    Assert (Test-SfOwnedProcess $node $testRoot) 'System Node with owned script rejected'
    $script:stopped = @()
    function Get-CimInstance { param($ClassName, $Filter, $ErrorAction); return $foreign }
    function Stop-Process { param($Id, [switch]$Force, $ErrorAction); $script:stopped += $Id }
    Stop-SfTrackedProcesses $testRoot
    Assert ($script:stopped.Count -eq 0) 'Stale PID stopped foreign process'
    Assert (-not (Test-Path (Join-Path $testRoot 'run\engine.pid'))) 'Stale PID file retained'
    Write-Output 'PASS: persisted settings, precedence, child environment, stable state directory and stale PID protection'
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
    foreach ($name in @('Start-Process', 'Get-CimInstance', 'Stop-Process')) { Remove-Item ('Function:' + $name) -ErrorAction SilentlyContinue }
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\sf-runtime-test-'
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

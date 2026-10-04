$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot)
. (Join-Path $repo 'scripts\windows\runtime.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('sf-runtime-test-' + [guid]::NewGuid().ToString('N'))
$saved = @{}
foreach ($key in @('SF_INGEST_TOKEN', 'SF_API_TOKEN', 'SF_WEBHOOK_URL', 'SF_WEBHOOK_TOKEN')) {
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
        $script:childApiToken = $env:SF_API_TOKEN
        $script:childArguments = $ArgumentList
        return [pscustomobject]@{ Id = 42424 }
    }
    Start-SfEngine $testRoot (Join-Path $testRoot 'bin\engine.exe') 'flag-token' | Out-Null
    Assert ($env:SF_INGEST_TOKEN -eq 'env-token' -and -not $env:SF_WEBHOOK_TOKEN) 'Parent environment not restored'
    $savedApi = (Get-Content (Join-Path $testRoot 'tools\config\api.token') -First 1)
    Assert ($savedApi -match '^[0-9a-f]{64}$') 'API token not generated on first start'
    Assert ($script:childApiToken -eq $savedApi -and -not $env:SF_API_TOKEN) 'Child API token differs or leaked to the parent'
    Assert ($script:childArguments -notmatch $savedApi) 'API token in process arguments'
    Assert ($script:childArguments -match '-api-write' -and $script:childArguments -match '-store ') 'Console write surface or history not enabled'
    Assert ($script:childArguments -notmatch '-allow-kill') 'Active response armed without an operator allowlist'
    Assert ((Initialize-SfApiToken $testRoot) -eq $savedApi) 'API token regenerated on a later start'
    Set-Content (Join-Path $testRoot 'tools\config\respond-operators.yaml') 'version: 2'
    Start-SfEngine $testRoot (Join-Path $testRoot 'bin\engine.exe') 'flag-token' | Out-Null
    Assert ($script:childArguments -match '-allow-kill' -and $script:childArguments -match 'respond-audit') 'Operator allowlist did not arm active response'
    Remove-Item (Join-Path $testRoot 'tools\config\respond-operators.yaml')
    Assert ($script:childArguments -notmatch '0\.0\.0\.0') 'Ingest listened beyond loopback without identities'
    Set-Content (Join-Path $testRoot 'tools\config\ingest-identities.yaml') 'version: 1'
    Start-SfEngine $testRoot (Join-Path $testRoot 'bin\engine.exe') 'flag-token' | Out-Null
    Assert ($script:childArguments -match '-addr 0\.0\.0\.0:7777' -and $script:childArguments -match '-ingest-identities') 'Identities did not open the ingest to remote sensors'
    Assert ($script:childArguments -notmatch '-ingest-cert') 'TLS enabled without a certificate pair'
    Set-Content (Join-Path $testRoot 'tools\config\ingest-cert.pem') 'cert'
    Set-Content (Join-Path $testRoot 'tools\config\ingest-key.pem') 'key'
    Start-SfEngine $testRoot (Join-Path $testRoot 'bin\engine.exe') 'flag-token' | Out-Null
    Assert ($script:childArguments -match '-ingest-cert' -and $script:childArguments -match '-ingest-key') 'Certificate pair did not enable ingest TLS'
    Remove-Item (Join-Path $testRoot 'tools\config\ingest-identities.yaml'), (Join-Path $testRoot 'tools\config\ingest-cert.pem'), (Join-Path $testRoot 'tools\config\ingest-key.pem')
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
    New-Item -ItemType Directory (Join-Path $testRoot 'bin'), (Join-Path $testRoot 'scripts') -Force | Out-Null
    Set-Content (Join-Path $testRoot 'bin\engine.exe') 'fixture'
    Copy-Item (Join-Path $repo 'scripts\windows\start-engine.ps1') (Join-Path $testRoot 'scripts\start-engine.ps1')
    Set-Content (Join-Path $testRoot 'scripts\runtime.ps1') @'
function Start-SfEngine {
    param($Root, $Executable)
    if (-not (Test-Path -LiteralPath $Executable)) { throw 'NoConsole startup resolved an incorrect root' }
    Set-Content -LiteralPath (Join-Path $Root 'run\resolved-root.txt') $Root
}
'@
    & (Join-Path $testRoot 'scripts\start-engine.ps1')
    Assert ((Get-Content (Join-Path $testRoot 'run\resolved-root.txt')) -eq $testRoot) 'NoConsole startup depends on web sources'
    Write-Output 'PASS: persisted settings, precedence, child environment, API token and engine arguments, stable state directory, stale PID protection and NoConsole startup root'
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
    foreach ($name in @('Start-Process', 'Get-CimInstance', 'Stop-Process')) { Remove-Item ('Function:' + $name) -ErrorAction SilentlyContinue }
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\sf-runtime-test-'
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

# Live runner smoke on the current account, using a disposable workspace
# fixture. No boot tasks, SYSTEM account, ACL changes, driver or real telemetry.
param(
    [string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot)),
    [string]$GoExecutable = 'go.exe',
    [string]$GoBuildCache = '',
    [string]$GoWorkspace = ''
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
$fixture = Join-Path $repo ('run\server-runner-smoke-' + [guid]::NewGuid().ToString('N'))
$runner = $null
$savedCache = $env:GOCACHE
$savedWorkspace = $env:GOPATH
$originalDirectory = Get-Location
$expectedEngine = Join-Path $fixture 'bin\engine.exe'
$apiToken = 'fixture-api-' + [guid]::NewGuid().ToString('N')
$ingestToken = 'fixture-ingest-' + [guid]::NewGuid().ToString('N')
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Assert-FreePort([int]$Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } catch { throw "Port $Port is occupied; no runner was started." }
    finally { $listener.Stop() }
}
function Read-FixtureAPI([string]$Path, [string]$Token = '') {
    $headers = @{}
    if ($Token) { $headers.Authorization = 'Bearer ' + $Token }
    return (Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:7778' + $Path) -Headers $headers -TimeoutSec 3).Content | ConvertFrom-Json
}
function Assert-Unauthorized([string]$Token) {
    $status = 0
    try { Read-FixtureAPI '/api/stats' $Token | Out-Null }
    catch { if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } }
    Assert ($status -eq 401) 'The fixture API accepted missing/incorrect credentials.'
}
function Stop-FixtureChildren {
    # The GUID fixture's executable path is unique. Never stop the real
    # repository/installed engine, and never trust an unverified PID file.
    foreach ($process in @(Get-Process -Name engine -ErrorAction SilentlyContinue)) {
        try { $path = $process.Path } catch { continue }
        if ($path -and $path.Equals($expectedEngine, [StringComparison]::OrdinalIgnoreCase)) {
            $process.Kill()
            $process.WaitForExit(5000) | Out-Null
        }
    }
}
try {
    Assert-FreePort 7777
    Assert-FreePort 7778
    New-Item -ItemType Directory -Path (Join-Path $fixture 'bin'), (Join-Path $fixture 'scripts'), (Join-Path $fixture 'tools\config') -Force | Out-Null
    foreach ($name in @('server-runner.ps1', 'runtime.ps1')) { Copy-Item -LiteralPath (Join-Path $repo ('scripts\windows\' + $name)) -Destination (Join-Path $fixture ('scripts\' + $name)) }
    foreach ($name in @('rules', 'chains', 'databases')) {
        if (Test-Path -LiteralPath (Join-Path $repo $name)) { Copy-Item -LiteralPath (Join-Path $repo $name) -Destination (Join-Path $fixture $name) -Recurse }
    }
    foreach ($name in @('beacons.yaml', 'thresholds.yaml')) {
        if (Test-Path -LiteralPath (Join-Path $repo $name)) { Copy-Item -LiteralPath (Join-Path $repo $name) -Destination (Join-Path $fixture $name) }
    }
    [IO.File]::WriteAllText((Join-Path $fixture 'tools\config\api.token'), $apiToken, [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $fixture 'tools\config\ingest.token'), $ingestToken, [Text.Encoding]::ASCII)
    if ($GoBuildCache) { $env:GOCACHE = $GoBuildCache }
    if ($GoWorkspace) { $env:GOPATH = $GoWorkspace }
    Set-Location -LiteralPath $repo
    & $GoExecutable build -o $expectedEngine ./cmd/engine
    Assert ($LASTEXITCODE -eq 0) 'Fixture engine build failed.'
    $nativePowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    # This policy setting applies only to the isolated test process, allowing
    # our locally authored fixture scripts. Production tasks add no override.
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + (Join-Path $fixture 'scripts\server-runner.ps1') + '" -InstallDir "' + $fixture + '" -Component Engine'
    $runner = Start-Process -FilePath $nativePowerShell -ArgumentList $arguments -WorkingDirectory $fixture -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture 'runner.stdout.log') -RedirectStandardError (Join-Path $fixture 'runner.stderr.log')
    # Retain the actual process handle returned by our launch, so cleanup
    # targets that process rather than a guessed/reused global PowerShell PID.
    $runnerHandle = $runner.Handle
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ($true) {
        Assert (-not $runner.HasExited) 'The foreground runner exited before the API became ready.'
        try {
            $health = Read-FixtureAPI '/api/health'
            if ($health.status -eq 'ok') { break }
        } catch { }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'The fixture runner did not open its health API.' }
        Start-Sleep -Milliseconds 100
    }
    Assert-Unauthorized ''
    Assert-Unauthorized 'fixture-wrong-api-token'
    $stats = Read-FixtureAPI '/api/stats' $apiToken
    Assert ($stats.events_total -eq 0) 'The fixture unexpectedly contains prior telemetry.'
    $connection = New-Object Net.Sockets.TcpClient
    try {
        $connection.Connect('127.0.0.1', 7777)
        $connection.ReceiveTimeout = 3000
        $stream = $connection.GetStream()
        $writer = New-Object IO.StreamWriter($stream, (New-Object Text.UTF8Encoding($false)))
        $writer.AutoFlush = $true
        $reader = New-Object IO.StreamReader($stream)
        $writer.WriteLine('AUTH ' + $ingestToken)
        $ack = $reader.ReadLine() | ConvertFrom-Json
        Assert ($ack.ack -eq 'ok') 'The runner did not use the persisted ingest credential.'
        $event = [ordered]@{
            id = 'server-runner-inert-fixture'
            timestamp = [DateTime]::UtcNow.ToString('o')
            type = 'process.create'
            host = 'SERVER-RUNNER-FIXTURE'
            source = 'test.server-runner'
            process = @{ pid = 424242; name = 'inert-fixture.exe'; command_line = 'inert fixture, no process was executed' }
        }
        $writer.WriteLine(($event | ConvertTo-Json -Depth 5 -Compress))
    } finally { $connection.Close() }
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while ($true) {
        Assert (-not $runner.HasExited) 'Runner detached/exited while its engine should be running.'
        $stats = Read-FixtureAPI '/api/stats' $apiToken
        if ($stats.events_total -eq 1 -and $stats.store_events -eq 1) { break }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'The inert event was not ingested and persisted through the foreground runner.' }
        Start-Sleep -Milliseconds 100
    }
    Assert ($stats.store_enabled -and $stats.store_write_failures -eq 0) 'The fixture had a persistence failure or no persistence store.'
    $database = Join-Path $fixture 'run\soc.db'
    $file = [IO.File]::Open($database, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $header = New-Object byte[] 16
        Assert ($file.Read($header, 0, 16) -eq 16 -and [Text.Encoding]::ASCII.GetString($header).StartsWith('SQLite format 3')) 'Persistent database was not initialized as SQLite.'
    } finally { $file.Dispose() }
    Assert ((Get-Item -LiteralPath (Join-Path $fixture 'run\server-engine.log')).Length -gt 0) 'The runner did not create its transcript.'
    Stop-FixtureChildren
    Assert ($runner.WaitForExit(5000)) 'The foreground runner did not exit after its engine stopped.'
    Assert ($runner.ExitCode -ne 0) 'Unexpected component termination cannot trigger Task Scheduler recovery.'
    Write-Host 'PASS: foreground runner, unauthenticated health, missing/wrong API token rejected, persisted ingest/API tokens, inert fixture ingestion, SQLite, transcript and recovery exit code.'
} catch {
    foreach ($name in @('runner.stderr.log', 'runner.stdout.log')) {
        $log = Join-Path $fixture $name
        if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 12 | Write-Host }
    }
    throw
} finally {
    Stop-FixtureChildren
    if ($runner -and -not $runner.HasExited) {
        # This is the process object/handle returned by the launch above.
        $runner.Kill()
        $runner.WaitForExit(5000) | Out-Null
    }
    $env:GOCACHE = $savedCache
    $env:GOPATH = $savedWorkspace
    Set-Location -LiteralPath $originalDirectory.Path
    $allowed = $repo + '\run\server-runner-smoke-'
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

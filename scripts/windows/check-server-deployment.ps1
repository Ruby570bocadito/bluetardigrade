# Deterministic Windows deployment checks. OS registration/ACL commands are
# replaced by spies; these checks never create tasks, services or firewall rules.
param([string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
$work = Join-Path ([IO.Path]::GetTempPath()) ('sf-server-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$previousPreference = $ErrorActionPreference
$checks = 0
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Check($Name, [scriptblock]$Body) { & $Body; $script:checks++; Write-Host "PASS: $Name" }
function Throws([scriptblock]$Body) { $failed = $false; try { & $Body | Out-Null } catch { $failed = $true }; Assert $failed 'Expected operation to fail.' }
function Put($Path) { New-Item -ItemType Directory -Path (Split-Path $Path -Parent) -Force | Out-Null; [IO.File]::WriteAllText($Path, 'inert fixture') }
try {
    . (Join-Path $RepoRoot 'scripts\windows\server.ps1')
    Check 'all deployment scripts parse under the executing PowerShell version' {
        foreach ($file in @('install.ps1', 'uninstall.ps1', 'scripts\windows\server.ps1', 'scripts\windows\server-runner.ps1', 'scripts\windows\runtime.ps1')) {
            $tokens = $null
            $parseErrors = $null
            [Management.Automation.Language.Parser]::ParseFile((Join-Path $RepoRoot $file), [ref]$tokens, [ref]$parseErrors) | Out-Null
            Assert (@($parseErrors).Count -eq 0) "PowerShell parse failed: $file"
        }
    }
    Check 'server roots outside a dedicated ProgramData directory are refused' {
        Throws { Resolve-SfServerRoot $env:ProgramData }
        Throws { Resolve-SfServerRoot $env:SystemRoot }
        Throws { Resolve-SfServerRoot $work }
        Throws { Resolve-SfServerRoot ([IO.Path]::GetPathRoot($work)) }
    }
    Check 'source installation reports SAC enforcement before making changes' {
        . (Join-Path $RepoRoot 'install.ps1')
        function Get-SfSmartAppControlState { return 1 }
        $caught = ''
        try { Assert-SfInstallEnvironment } catch { $caught = $_.Exception.Message }
        Assert ($caught -match 'Smart App Control' -and $caught -match 'unsigned' -and $caught -match 'signed') 'SAC enforcement was not explained accurately.'
        Remove-Item Function:Get-SfSmartAppControlState
    }
    Check 'planned tasks have no secrets and run without a profile or policy override' {
        $plan = @(Get-SfServerTaskPlan $work $true 'sysmon')
        Assert ($plan.Count -eq 4) 'Wrong task count.'
        Assert ($plan.Component -contains 'Engine' -and $plan.Component -contains 'Hub' -and $plan.Component -contains 'Console' -and $plan.Component -contains 'Sysmon') 'Missing boot component.'
        foreach ($entry in $plan) {
            Assert ($entry.Arguments -match '-NoProfile' -and $entry.Arguments -match '-NonInteractive') 'Interactive action generated.'
            Assert ($entry.Arguments -notmatch 'ExecutionPolicy|Bypass|token') 'A policy override or credential appeared in an action.'
            Assert ($entry.WorkingDirectory -eq $work) 'Task depends on inherited working directory.'
        }
        Assert (@(Get-SfServerTaskPlan $work $false 'none').Count -eq 1) 'Engine-only deployment has extra tasks.'
    }
    Check 'generated credentials are random and existing values are preserved' {
        $token1 = Join-Path $work 'first.token'
        $token2 = Join-Path $work 'second.token'
        New-SfServerSecret $token1
        New-SfServerSecret $token2
        $first = ([IO.File]::ReadAllText($token1)).Trim()
        $second = ([IO.File]::ReadAllText($token2)).Trim()
        Assert ([Convert]::FromBase64String($first).Length -eq 32) 'Credential is not 256 bits.'
        Assert ($first -ne $second) 'Generated credentials were reused.'
        New-SfServerSecret $token1
        Assert (([IO.File]::ReadAllText($token1)).Trim() -eq $first) 'Existing credential was rotated unexpectedly.'
    }
    # Every command that could mutate the OS is intercepted below.
    $script:registered = @()
    $script:existingTasks = @{}
    $script:removed = @()
    $script:aclProtected = $false
    $script:failComponent = ''
    $script:denyTaskQuery = $false
    function Assert-SfServerAdmin { }
    $script:machinePolicy = 'RemoteSigned'
    $script:signatureStatus = 'NotSigned'
    $script:osProductType = 3
    function Get-ExecutionPolicy { param($Scope); return $script:machinePolicy }
    function Get-CimInstance { [CmdletBinding()] param($ClassName, $Property); return [pscustomobject]@{ ProductType = $script:osProductType } }
    function Get-AuthenticodeSignature { [CmdletBinding()] param($LiteralPath); return [pscustomobject]@{ Status = $script:signatureStatus } }
    function Protect-SfServerTree { param([string]$Root); $script:aclProtected = $true }
    function Get-ScheduledTask { [CmdletBinding()] param([string]$TaskName, $TaskPath)
        if ($script:denyTaskQuery) { Write-Error 'Controlled task-query denial.' -Category PermissionDenied; return }
        return $script:existingTasks[$TaskName]
    }
    function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel); return [pscustomobject]@{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel } }
    function New-ScheduledTaskTrigger { param([switch]$AtStartup); return [pscustomobject]@{ AtStartup = [bool]$AtStartup; Delay = '' } }
    function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable, $MultipleInstances, $ExecutionTimeLimit, $RestartCount, $RestartInterval, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries)
        return [pscustomobject]@{ MultipleInstances = $MultipleInstances; Limit = $ExecutionTimeLimit; RestartCount = $RestartCount; RestartInterval = $RestartInterval }
    }
    function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory); return [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory } }
    function Register-ScheduledTask { [CmdletBinding()] param($TaskName, $TaskPath, $Action, $Trigger, $Principal, $Settings, $Description, [switch]$Force)
        Assert $script:aclProtected 'A SYSTEM task was registered before protecting code and credentials.'
        if ($script:failComponent -and $TaskName -like ('*-' + $script:failComponent)) { throw 'Controlled task registration failure.' }
        $script:registered += [pscustomobject]@{ Name = $TaskName; Action = $Action; Trigger = $Trigger; Principal = $Principal; Settings = $Settings; Description = $Description }
    }
    function Stop-ScheduledTask { [CmdletBinding()] param($TaskName, $TaskPath) }
    function Unregister-ScheduledTask { [CmdletBinding()] param($TaskName, $TaskPath, [switch]$Confirm); $script:removed += $TaskName }
    $fixture = Join-Path $work 'installation'
    foreach ($file in @('bin\engine.exe', 'scripts\server-runner.ps1', 'scripts\runtime.ps1', 'tools\node\node.exe', 'tools\bun.exe', 'web\console\.next\BUILD_ID', 'web\console-service\index.ts')) { Put (Join-Path $fixture $file) }
    Check 'persistent policy is honored before registering a task' {
        $script:machinePolicy = 'Restricted'
        Throws { Register-SfServerTasks $fixture $false 'none' }
        Assert (-not $script:aclProtected -and $script:registered.Count -eq 0) 'Restricted machine policy changed the deployment.'
        $script:machinePolicy = 'AllSigned'
        Throws { Register-SfServerTasks $fixture $false 'none' }
        $script:signatureStatus = 'Valid'
        Assert-SfServerScriptPolicy $fixture 'none'
        $script:machinePolicy = 'RemoteSigned'
        $script:signatureStatus = 'NotSigned'
    }
    Check 'Undefined machine policy resolves the Windows client/server default' {
        $script:machinePolicy = 'Undefined'
        $script:osProductType = 1
        Throws { Assert-SfServerScriptPolicy $fixture 'none' }
        $script:osProductType = 3
        Assert-SfServerScriptPolicy $fixture 'none'
        $script:machinePolicy = 'RemoteSigned'
    }
    Check 'boot task uses SYSTEM with a finite retry policy and no execution limit' {
        Register-SfServerTasks $fixture $false 'none'
        Assert ($script:registered.Count -eq 1) 'Engine-only registration did not create exactly one task.'
        $task = $script:registered[0]
        Assert ($task.Principal.UserId -eq 'S-1-5-18' -and $task.Principal.LogonType -eq 'ServiceAccount') 'Task requires an interactive account.'
        Assert ($task.Trigger.AtStartup -and $task.Trigger.Delay -eq 'PT30S') 'Missing delayed boot trigger.'
        Assert ($task.Settings.RestartCount -eq 10 -and $task.Settings.RestartInterval -eq (New-TimeSpan -Minutes 1)) 'Retry policy was lost.'
        Assert ($task.Settings.Limit -eq [TimeSpan]::Zero -and $task.Settings.MultipleInstances -eq 'IgnoreNew') 'Long-running/single-instance policy was lost.'
        foreach ($file in @('ingest.token', 'api.token', 'server.json')) { Assert (Test-Path -LiteralPath (Join-Path $fixture ('tools\config\' + $file))) "Missing persistent configuration: $file" }
    }
    Check 'partial registration keeps a durable management marker' {
        $script:failComponent = 'hub'
        Throws { Register-SfServerTasks $fixture $true 'none' }
        Assert (Test-Path -LiteralPath (Join-Path $fixture 'tools\config\server.json')) 'Partial privileged task setup lost its cleanup marker.'
        $script:failComponent = ''
    }
    Check 'task names belonging to another installation are not overwritten' {
        $script:existingTasks['bluetardigrade-server-engine'] = [pscustomobject]@{ TaskName = 'bluetardigrade-server-engine'; Description = 'bluetardigrade server root=another-installation' }
        $before = $script:registered.Count
        Throws { Register-SfServerTasks $fixture $false 'none' }
        Assert ($script:registered.Count -eq $before) 'Foreign task was overwritten.'
        $script:existingTasks.Clear()
    }
    Check 'removing console components unregisters only tasks owned by this root' {
        foreach ($name in @('bluetardigrade-server-hub', 'bluetardigrade-server-console')) {
            $script:existingTasks[$name] = [pscustomobject]@{ TaskName = $name; Description = 'bluetardigrade server root=' + $fixture }
        }
        Register-SfServerTasks $fixture $false 'none'
        Assert ($script:removed.Count -eq 2) 'Removed console tasks were left at boot.'
    }
    Check 'missing ETW binary is reported before task or ACL changes' {
        $before = $script:registered.Count
        $script:aclProtected = $false
        Throws { Register-SfServerTasks $fixture $false 'etw' }
        Assert (-not $script:aclProtected -and $script:registered.Count -eq $before) 'Missing sensor changed the deployment.'
    }
    Check 'uninstall removes owned boot tasks even when the configuration marker is gone' {
        . (Join-Path $RepoRoot 'uninstall.ps1')
        function Assert-SfServerRemovalAdmin { }
        $script:existingTasks.Clear()
        $script:removed = @()
        $script:existingTasks['bluetardigrade-server-engine'] = [pscustomobject]@{ TaskName = 'bluetardigrade-server-engine'; Description = 'bluetardigrade server root=' + $fixture }
        $script:existingTasks['bluetardigrade-server-hub'] = [pscustomobject]@{ TaskName = 'bluetardigrade-server-hub'; Description = 'bluetardigrade server root=unrelated' }
        Remove-Item -LiteralPath (Join-Path $fixture 'tools\config\server.json') -Force
        Remove-SfServerBootTasks $fixture
        Assert ($script:removed.Count -eq 1 -and $script:removed[0] -eq 'bluetardigrade-server-engine') 'Uninstall missed an orphan or removed a foreign task.'
    }
    Check 'task ownership-query failures cannot authorize registration or removal' {
        $script:denyTaskQuery = $true
        $registeredBefore = $script:registered.Count
        $removedBefore = $script:removed.Count
        Throws { Register-SfServerTasks $fixture $false 'none' }
        Throws { Remove-SfServerBootTasks $fixture }
        Assert ($script:registered.Count -eq $registeredBefore -and $script:removed.Count -eq $removedBefore) 'A denied ownership query changed tasks.'
        $script:denyTaskQuery = $false
    }
    Write-Host "Server deployment checks passed: $checks. No OS tasks, ACLs or services were modified."
} finally {
    # work is a GUID-named child of the OS temp directory created by this test.
    $safeBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $safeWork = [IO.Path]::GetFullPath($work)
    if ($safeWork.StartsWith($safeBase, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $safeWork) -like 'sf-server-check-*') {
        Remove-Item -LiteralPath $safeWork -Recurse -Force -ErrorAction SilentlyContinue
    }
    $ErrorActionPreference = $previousPreference
}

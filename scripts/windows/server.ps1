# Noninteractive Windows deployment using the built-in Task Scheduler.
# Tasks run foreground processes at boot; this is not an SCM service wrapper.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)][string]$InstallDir = '',
    [ValidateSet('Register', 'Start', 'Stop', 'Status', 'Remove')][string]$Action = 'Status',
    [switch]$WithConsole,
    [ValidateSet('none', 'sysmon', 'etw')][string]$Sensor = 'none',
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'

function Resolve-SfServerRoot {
    param([string]$Directory)
    if (-not $env:ProgramData) { throw 'ProgramData is unavailable; Windows Server deployment requires a dedicated local directory.' }
    if (-not $Directory) { $Directory = Join-Path $env:ProgramData 'bluetardigrade' }
    $full = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/')
    $base = [IO.Path]::GetFullPath($env:ProgramData).TrimEnd('\', '/') + '\'
    if (-not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase) -or $full -match '["`\r\n]') {
        throw 'Server tasks require a dedicated local directory below ProgramData, for example C:\ProgramData\bluetardigrade.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $full 'install.ps1') -PathType Leaf)) { throw 'The directory is not an installed bluetardigrade tree.' }
    $ancestor = $full
    while ($ancestor) {
        $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Server deployment refuses junctions or symbolic links in the installation path.' }
        $parent = Split-Path -Parent $ancestor
        if ($parent -eq $ancestor) { break }
        $ancestor = $parent
    }
    return $full
}

function Assert-SfServerAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Managing boot tasks requires an elevated PowerShell session. No automatic elevation is attempted.'
    }
}

function Assert-SfServerScriptPolicy {
    param([string]$Root, [string]$Source = 'none')
    # A task does not inherit an installer's process-scoped policy override.
    # Inspect the persistent machine policy; never alter it to make code run.
    $policy = Get-ExecutionPolicy -Scope MachinePolicy
    if ($policy -eq 'Undefined') { $policy = Get-ExecutionPolicy -Scope LocalMachine }
    if ($policy -eq 'Undefined' -or $policy -eq 'Default') {
        # PowerShell's documented default differs by OS product type. Do not
        # mistake an installer's temporary Process policy for the SYSTEM one.
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -Property ProductType -ErrorAction Stop
        if ($os.ProductType -eq 2 -or $os.ProductType -eq 3) { $policy = 'RemoteSigned' }
        else { $policy = 'Restricted' }
    }
    if ($policy -eq 'Restricted') {
        throw 'The persistent machine execution policy forbids PS1 task actions. Ask the policy administrator to authorize the signed deployment; no policy was changed.'
    }
    foreach ($name in @('server-runner.ps1', 'runtime.ps1') + $(if ($Source -eq 'sysmon') { @('sensor.ps1') } else { @() })) {
        $file = Join-Path $Root ('scripts\' + $name)
        $signature = Get-AuthenticodeSignature -LiteralPath $file -ErrorAction Stop
        if ($policy -eq 'AllSigned' -and $signature.Status -ne 'Valid') {
            throw 'Machine policy requires signed PS1 files. Sign and authorize all runtime scripts before registering boot tasks; see docs/SMART-APP-CONTROL.md.'
        }
        if ($policy -eq 'RemoteSigned' -and $signature.Status -ne 'Valid') {
            $zone = Get-Content -LiteralPath $file -Stream Zone.Identifier -ErrorAction SilentlyContinue
            if (($zone -join "`n") -match 'ZoneId\s*=\s*[34]') {
                throw 'A runtime PS1 has an Internet zone marker and no valid signature. Deploy the approved signed file; the server manager does not remove zone metadata.'
            }
        }
    }
}

function Assert-SfServerTree {
    param([string]$Root)
    # Traverse one directory at a time and reject reparse points BEFORE
    # descending, instead of following a junction during recursive scans.
    $queue = New-Object 'System.Collections.Generic.Queue[string]'
    $queue.Enqueue($Root)
    while ($queue.Count -gt 0) {
        foreach ($item in (Get-ChildItem -LiteralPath ($queue.Dequeue()) -Force -ErrorAction Stop)) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Server deployment refuses junctions or symbolic links inside the installation tree.' }
            if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
        }
    }
}

function Protect-SfServerTree {
    param([string]$Root)
    Assert-SfServerTree $Root
    # No ordinary user may replace code later run as SYSTEM. Restrict both
    # the code and persisted credentials to SYSTEM and Administrators.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $administrators = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
    $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    $acl.SetOwner($administrators)
    foreach ($sid in @($administrators, $system)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Root -AclObject $acl -ErrorAction Stop
    # Reset descendants to the protected root's inheritance; the tree was
    # checked for links and Root was constrained to a dedicated ProgramData
    # directory. No system directories or unrelated installations are touched.
    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $icacls (Join-Path $Root '*') /reset /T /Q 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict installation ACLs; no SYSTEM tasks were registered.' }
        # A previous user-level install may leave individual file owners.
        # Owners can rewrite DACLs even after ACEs are reset, so transfer
        # descendants to Administrators before any privileged task can run.
        & $icacls (Join-Path $Root '*') /setowner '*S-1-5-32-544' /T /Q 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict installation ownership; no SYSTEM tasks were registered.' }
    } finally { $ErrorActionPreference = $previous }
    Assert-SfServerTree $Root
}

function New-SfServerSecret {
    param([string]$File)
    if (Test-Path -LiteralPath $File -PathType Leaf) {
        $value = ([string](Get-Content -LiteralPath $File -First 1 -ErrorAction Stop)).Trim()
        if ($value) { return }
    }
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    [IO.File]::WriteAllText($File, [Convert]::ToBase64String($bytes) + "`r`n", [Text.Encoding]::ASCII)
}

function Get-SfServerTaskPlan {
    param([string]$Root, [bool]$Console = $false, [string]$Source = 'none')
    $components = @('Engine')
    if ($Console) { $components += @('Hub', 'Console') }
    if ($Source -eq 'sysmon') { $components += 'Sysmon' }
    if ($Source -eq 'etw') { $components += 'ETW' }
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    foreach ($component in $components) {
        [pscustomobject]@{
            Name = 'bluetardigrade-server-' + $component.ToLowerInvariant()
            Component = $component
            Execute = $powershell
            Arguments = '-NoLogo -NoProfile -NonInteractive -File "' + (Join-Path $Root 'scripts\server-runner.ps1') + '" -InstallDir "' + $Root + '" -Component ' + $component
            WorkingDirectory = $Root
        }
    }
}

function Get-SfServerOwnedTasks {
    param([string]$Root)
    foreach ($component in @('engine', 'hub', 'console', 'sysmon', 'etw')) {
        $queryErrors = @()
        $task = Get-ScheduledTask -TaskPath '\' -TaskName ('bluetardigrade-server-' + $component) -ErrorAction SilentlyContinue -ErrorVariable queryErrors
        foreach ($entry in $queryErrors) {
            if ($entry.CategoryInfo.Category -ne 'ObjectNotFound') { throw 'Cannot verify server task ownership; no tasks were changed.' }
        }
        if (-not $task) { continue }
        if ($task.Description -ne ('bluetardigrade server root=' + $Root)) {
            throw 'A server task with the same name belongs to another installation; it was left unchanged.'
        }
        $task
    }
}

function Register-SfServerTasks {
    param([string]$Root, [bool]$Console = $false, [string]$Source = 'none')
    Assert-SfServerAdmin
    $oldTasks = @(Get-SfServerOwnedTasks $Root)
    foreach ($file in @('bin\engine.exe', 'scripts\server-runner.ps1', 'scripts\runtime.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $file) -PathType Leaf)) { throw "Required server file is missing: $file" }
    }
    if ($Console) {
        foreach ($file in @('tools\node\node.exe', 'tools\bun.exe', 'web\console\.next\BUILD_ID', 'web\console-service\index.ts')) {
            if (-not (Test-Path -LiteralPath (Join-Path $Root $file) -PathType Leaf)) { throw "Required server console file is missing: $file. Use the installer -Server option to provision portable runtimes." }
        }
    }
    if ($Source -eq 'etw' -and -not (Test-Path -LiteralPath (Join-Path $Root 'bin\security-sensor.exe') -PathType Leaf)) {
        throw 'ETW sensor binary is missing. Reinstall with -WithSensor or choose -Sensor none/sysmon.'
    }
    if ($Source -eq 'sysmon') {
        try { $log = Get-WinEvent -ListLog 'Microsoft-Windows-Sysmon/Operational' -ErrorAction Stop }
        catch { throw 'Sysmon Operational is unavailable. Install/configure Sysmon explicitly first; server registration does not install drivers.' }
        if (-not $log.IsEnabled) { throw 'Sysmon Operational is disabled. Review its configuration before registering a sensor task.' }
    }
    Assert-SfServerScriptPolicy $Root $Source
    Protect-SfServerTree $Root
    $config = Join-Path $Root 'tools\config'
    New-Item -ItemType Directory -Path $config -Force | Out-Null
    New-SfServerSecret (Join-Path $config 'ingest.token')
    New-SfServerSecret (Join-Path $config 'api.token')
    $plan = @(Get-SfServerTaskPlan $Root $Console $Source)
    # Record management ownership before registering any OS task, so a partial
    # failure still leaves an uninstall/update path that removes those tasks.
    [pscustomobject]@{ withConsole = $Console; sensor = $Source } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $config 'server.json') -Encoding ASCII
    $principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT30S'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    foreach ($entry in $plan) {
        $action = New-ScheduledTaskAction -Execute $entry.Execute -Argument $entry.Arguments -WorkingDirectory $Root
        Register-ScheduledTask -TaskPath '\' -TaskName $entry.Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ('bluetardigrade server root=' + $Root) -Force -ErrorAction Stop | Out-Null
    }
    foreach ($task in $oldTasks) {
        if ($plan.Name -notcontains $task.TaskName) {
            Stop-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -Confirm:$false -ErrorAction Stop
        }
    }
    Write-Host 'Boot tasks registered; they start 30 seconds after boot. Use -Action Start to start them now.'
    Write-Host 'Code, state and tokens are restricted to SYSTEM and Administrators. This is Task Scheduler deployment, not an SCM service.'
}

if ($MyInvocation.InvocationName -ne '.') {
    if ($env:OS -ne 'Windows_NT' -or $ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
        throw 'Server deployment requires Windows PowerShell in an authorized FullLanguage session. Review your App Control policy and docs/SMART-APP-CONTROL.md.'
    }
    $root = Resolve-SfServerRoot $InstallDir
    if ($Plan) {
        Get-SfServerTaskPlan $root ([bool]$WithConsole) $Sensor
        return
    }
    if ($Action -eq 'Register') {
        Register-SfServerTasks $root ([bool]$WithConsole) $Sensor
    } else {
        $tasks = @(Get-SfServerOwnedTasks $root)
        if ($Action -ne 'Status' -and $tasks.Count -gt 0) { Assert-SfServerAdmin }
        foreach ($task in $tasks) {
            switch ($Action) {
                'Start' { Start-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -ErrorAction Stop }
                'Stop' { Stop-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -ErrorAction SilentlyContinue }
                'Remove' {
                    Stop-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -ErrorAction SilentlyContinue
                    Unregister-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -Confirm:$false -ErrorAction Stop
                }
                'Status' {
                    $info = Get-ScheduledTaskInfo -TaskPath '\' -TaskName $task.TaskName -ErrorAction Stop
                    [pscustomobject]@{ Task = $task.TaskName; State = $task.State; LastRun = $info.LastRunTime; LastResult = $info.LastTaskResult }
                }
            }
        }
        if ($Action -eq 'Remove') { Remove-Item -LiteralPath (Join-Path $root 'tools\config\server.json') -ErrorAction SilentlyContinue }
    }
}

# Installer PATH, lock and output checks on Windows. Safe on a developer
# machine: the user PATH logic runs against a scratch registry key
# (HKCU\Software\BluetardigradeInstallerTest), binaries live in a temp
# directory, and nothing is installed or downloaded.
param([string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this check on native Windows PowerShell 5.1 or newer.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('sf-installer-path-' + [guid]::NewGuid().ToString('N'))
$scratchKey = 'Software\BluetardigradeInstallerTest\Environment'
$checks = 0
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Check($Name, [scriptblock]$Body) { & $Body; $script:checks++; Write-Host "PASS: $Name" }
function Put-Exe($Path) {
    New-Item -ItemType Directory (Split-Path $Path -Parent) -Force | Out-Null
    Copy-Item (Join-Path $env:SystemRoot 'System32\PING.EXE') $Path -Force
}
function Read-Scratch {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($scratchKey)
    try { return @{ Raw = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'); Kind = $key.GetValueKind('Path') } }
    finally { $key.Close() }
}
try {
    New-Item -ItemType Directory $work -Force | Out-Null
    . (Join-Path $RepoRoot 'install.ps1')
    # Write-Ok / Write-Warn2 print; keep them quiet here
    function Write-Ok($m) { }
    function Write-Warn2($m) { $script:warned = $m }
    function Write-Info($m) { }

    $legacyBin = Join-Path $work 'security-framework\bin'
    $newBin = Join-Path $work 'bluetardigrade\bin'
    Put-Exe (Join-Path $legacyBin 'sf-engine.exe')
    Put-Exe (Join-Path $newBin 'sf-engine.exe')

    Check 'a shadowed install moves to the front and %VARIABLE% entries survive as REG_EXPAND_SZ' {
        Set-UserPathRaw -KeyPath $scratchKey -Value "%SystemRoot%\system32;$legacyBin;C:\tools;$newBin"
        Add-ToUserPath -Dir $newBin -KeyPath $scratchKey
        $after = Read-Scratch
        Assert ($after.Raw -eq "$newBin;%SystemRoot%\system32;$legacyBin;C:\tools") "unexpected PATH: $($after.Raw)"
        Assert ($after.Kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) "PATH lost REG_EXPAND_SZ: $($after.Kind)"
    }
    Check 'an install already first is left alone' {
        $before = (Read-Scratch).Raw
        Add-ToUserPath -Dir $newBin -KeyPath $scratchKey
        Assert ((Read-Scratch).Raw -eq $before) 'PATH changed although the install was already first.'
    }
    Check 'without a shadowing install the bin is appended, not prepended' {
        Set-UserPathRaw -KeyPath $scratchKey -Value 'C:\tools;%USERPROFILE%\.cargo\bin'
        Add-ToUserPath -Dir $newBin -KeyPath $scratchKey
        Assert ((Read-Scratch).Raw -eq "C:\tools;%USERPROFILE%\.cargo\bin;$newBin") "unexpected PATH: $((Read-Scratch).Raw)"
    }
    Check 'an empty user PATH is created with the bin' {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\BluetardigradeInstallerTest', $false)
        Add-ToUserPath -Dir $newBin -KeyPath $scratchKey
        Assert ((Read-Scratch).Raw -eq $newBin) "unexpected PATH: $((Read-Scratch).Raw)"
    }
    Check 'a running engine binary stops the update before anything changes' {
        $root = Join-Path $work 'install'
        $engine = Join-Path $root 'bin\engine.exe'
        Put-Exe $engine
        $p = Start-Process -FilePath $engine -ArgumentList '-n', '30', '127.0.0.1' -WindowStyle Hidden -PassThru
        try {
            Start-Sleep -Milliseconds 300
            $caught = $null
            try { Assert-InstallNotRunning -Root $root } catch { $caught = $_.Exception.Message }
            Assert ($caught -match 'engine\.exe' -and $caught -match 'Administrator') "lock not reported clearly: $caught"
        } finally { if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit() } }
        Assert-InstallNotRunning -Root $root   # released: no error
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        Check 'UTF-8 tool output is decoded as UTF-8 and the console encoding is restored' {
            $before = [Console]::OutputEncoding.CodePage
            $lines = Invoke-Native -Command { & $node.Source -e "process.stdout.write('\u2713 ready\n')" } -Quiet -Utf8
            Assert ("$lines" -eq ([char]0x2713 + ' ready')) "UTF-8 output garbled: $lines"
            Assert ([Console]::OutputEncoding.CodePage -eq $before) 'console encoding was not restored'
        }
    } else { Write-Host 'SKIP: UTF-8 decoding (node not on PATH)' }
    Write-Host "Installer PATH checks: $checks/$checks passed."
} finally {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\BluetardigradeInstallerTest', $false)
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'bin\engine.exe'))) { $root = Split-Path -Parent $root }
. (Join-Path $PSScriptRoot 'runtime.ps1')
$executable = Join-Path $root 'bin\engine.exe'
Start-SfEngine -Root $root -Executable $executable | Out-Null

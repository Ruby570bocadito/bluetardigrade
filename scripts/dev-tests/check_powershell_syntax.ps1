# Parse-check every PowerShell script in the repo with the real
# PowerShell AST parser (the same engine that failed on $Url: in
# install.ps1 line 112). Exits non-zero on the first file with syntax
# errors, printing file + message for each error found.
param([string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot)))

$ErrorActionPreference = 'Stop'
# Exclude generated/dependency directories before descending. Filtering after
# -Recurse still traverses inaccessible caches and could report success after
# nonterminating enumeration errors hid scripts from the check.
$excluded = @('.git', '.cache', 'node_modules', '.next', 'tools', 'bin', 'dist', 'vendor', 'target', 'captures', 'run')
$pending = New-Object 'System.Collections.Generic.Queue[string]'
$pending.Enqueue([IO.Path]::GetFullPath($RepoRoot))
$files = @()
while ($pending.Count -gt 0) {
    foreach ($entry in Get-ChildItem -LiteralPath ($pending.Dequeue()) -Force -ErrorAction Stop) {
        if ($entry.PSIsContainer -and $entry.Name -in $excluded) { continue }
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Syntax guard cannot certify a linked source path.' }
        if ($entry.PSIsContainer) { $pending.Enqueue($entry.FullName) }
        elseif ($entry.Extension -eq '.ps1') { $files += $entry }
    }
}
if (-not $files -or $files.Count -eq 0) { Write-Output 'no .ps1 files found'; exit 1 }

$failed = 0
foreach ($f in $files) {
    $errs = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count -gt 0) {
        $failed++
        foreach ($e in $errs) {
            Write-Output ("FAIL {0}:{1}: {2}" -f $f.FullName, $e.Extent.StartLineNumber, $e.Message.Split([char]10)[0])
        }
    } else {
        Write-Output ("PASS {0}" -f $f.Name)
    }
}
if ($failed -gt 0) { Write-Output ("{0} file(s) with syntax errors" -f $failed); exit 1 }
Write-Output ("all {0} .ps1 files parse cleanly" -f $files.Count)
exit 0

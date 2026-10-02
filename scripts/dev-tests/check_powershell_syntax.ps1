# Parse-check every PowerShell script in the repo with the real
# PowerShell AST parser (the same engine that failed on $Url: in
# install.ps1 line 112). Exits non-zero on the first file with syntax
# errors, printing file + message for each error found.
param([string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot)))

$files = @(Get-ChildItem -Path $RepoRoot -Recurse -Filter '*.ps1' -File |
    Where-Object { $_.FullName -notmatch 'node_modules|\.next|tools[\\/](go|node|bun)' })
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

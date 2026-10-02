# Sign a prepared Windows package; never disable Windows application control.
# Requires a real RSA code-signing certificate and private key in the Windows
# certificate store. A private/self-signed CA is not proof of SAC compatibility.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$PackageRoot,
    [string]$CertificateThumbprint,
    [ValidateSet('CurrentUser', 'LocalMachine')][string]$CertificateStore = 'CurrentUser',
    [string]$SignToolPath = 'signtool.exe',
    [string]$TimestampServer = 'http://timestamp.digicert.com',
    [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Signing and Authenticode verification require Windows.' }
$rootItem = Get-Item -LiteralPath $PackageRoot -ErrorAction Stop
if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'PackageRoot must be a physical directory, not a link.'
}
$packagePath = $rootItem.FullName.TrimEnd('\') + '\'
$directories = New-Object 'System.Collections.Generic.Stack[string]'
$directories.Push($rootItem.FullName)
$files = New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'
while ($directories.Count -gt 0) {
    foreach ($item in Get-ChildItem -LiteralPath $directories.Pop() -Force -ErrorAction Stop) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package contains a link; signing stops before changing files.' }
        if (-not $item.FullName.StartsWith($packagePath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escaped its root.' }
        if ($item.PSIsContainer) { $directories.Push($item.FullName) }
        elseif ($item.Extension -in @('.exe', '.dll', '.ps1', '.psm1')) { $files.Add($item) }
    }
}
if ($files.Count -eq 0) { throw 'No EXE, DLL, PS1 or PSM1 files in the prepared package.' }

if (-not $VerifyOnly) {
    if ($CertificateThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Supply the code-signing certificate SHA-1 thumbprint (40 hex characters).' }
    $certificate = Get-Item -LiteralPath ('Cert:\' + $CertificateStore + '\My\' + $CertificateThumbprint) -ErrorAction Stop
    $codeSigning = @($certificate.EnhancedKeyUsageList | Where-Object { $_.ObjectId.Value -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0
    if (-not $certificate.HasPrivateKey -or -not $codeSigning -or $certificate.PublicKey.Oid.Value -ne '1.2.840.113549.1.1.1' -or
        $certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date) -or $certificate.Subject -eq $certificate.Issuer) {
        throw 'An unexpired, non-self-signed RSA code-signing certificate with its private key is required.'
    }
    $timestampUri = $null
    if (-not [Uri]::TryCreate($TimestampServer, [UriKind]::Absolute, [ref]$timestampUri) -or
        $timestampUri.Scheme -ne 'http' -or $timestampUri.UserInfo -or $timestampUri.Fragment) {
        throw 'Use an HTTP Authenticode timestamp endpoint compatible with Windows PowerShell 5.1. It receives the public signature digest.'
    }
    # Validate all prerequisites before signing the first file.
    if (@($files | Where-Object { $_.Extension -in @('.exe', '.dll') }).Count -gt 0) {
        $signTool = (Get-Command $SignToolPath -CommandType Application -ErrorAction Stop).Source
    }
}

function Test-PackageSignature($Signature) {
    return ($null -ne $Signature -and $Signature.Status -eq 'Valid' -and
        $null -ne $Signature.SignerCertificate -and
        $Signature.SignerCertificate.PublicKey.Oid.Value -eq '1.2.840.113549.1.1.1' -and
        $Signature.SignerCertificate.Subject -ne $Signature.SignerCertificate.Issuer -and
        $null -ne $Signature.TimeStamperCertificate)
}

$failures = 0
foreach ($file in $files | Sort-Object FullName) {
    $relative = $file.FullName.Substring($packagePath.Length)
    $existing = Get-AuthenticodeSignature -LiteralPath $file.FullName
    # A trusted but untimestamped/ECC signature is not a completed package.
    # Re-sign it with the supplied RSA certificate instead of skipping it
    # and then inevitably rejecting the unchanged signature below.
    if (-not $VerifyOnly -and -not (Test-PackageSignature $existing) -and $PSCmdlet.ShouldProcess($relative, 'Sign and timestamp')) {
        if ($file.Extension -in @('.ps1', '.psm1')) {
            $result = Set-AuthenticodeSignature -LiteralPath $file.FullName -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer $TimestampServer
            if ($result.Status -ne 'Valid') { throw ('Script signing failed: ' + $relative) }
        } else {
            $signArgs = @('sign', '/sha1', $CertificateThumbprint, '/s', 'My', '/fd', 'SHA256', '/tr', $TimestampServer, '/td', 'SHA256')
            if ($CertificateStore -eq 'LocalMachine') { $signArgs += '/sm' }
            $signArgs += $file.FullName
            $previousPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                & $signTool @signArgs
                $signExitCode = $LASTEXITCODE
            } finally { $ErrorActionPreference = $previousPreference }
            if ($signExitCode -ne 0) { throw ('SignTool failed: ' + $relative) }
        }
    }
    if ($WhatIfPreference -and -not $VerifyOnly) { continue }
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if (-not (Test-PackageSignature $signature)) {
        $failures++
        Write-Output ('FAIL ' + $relative + ': ' + $signature.Status + ' (requires trusted RSA signature and timestamp)')
    } else { Write-Output ('OK ' + $relative) }
}
if ($failures -gt 0) { throw ('Signature verification failed for ' + $failures + ' file(s). No application-control setting was changed.') }
if (-not $WhatIfPreference) { Write-Output 'Package Authenticode verification passed. Test SAC/App Control on the target OS before distribution.' }

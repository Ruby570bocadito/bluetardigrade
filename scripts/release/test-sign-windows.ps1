# Windows PowerShell 5.1 regression: actual unsigned VerifyOnly is read-only.
# Signing-policy branches use inert PSCustomObject fixtures, not certificates,
# private keys or network timestamping. This test does not prove SAC acceptance.
[CmdletBinding()]
param([string]$SigningScript = '')
$ErrorActionPreference = 'Stop'
if (-not $SigningScript) { $SigningScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'sign-windows.ps1' }
if ($env:OS -ne 'Windows_NT') { throw 'This regression requires Windows Authenticode.' }
$tokens = $null
$parseErrors = $null
[Management.Automation.Language.Parser]::ParseFile($SigningScript, [ref]$tokens, [ref]$parseErrors) | Out-Null
if (@($parseErrors).Count -gt 0) { throw 'Signing helper does not parse in the current PowerShell engine.' }

$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$testRoot = Join-Path $temporaryParent ('bluetardigrade-sign-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $fixture = Join-Path $testRoot 'unsigned.ps1'
    [IO.File]::WriteAllText($fixture, "Write-Output 'INERT signing fixture'`r`n", (New-Object Text.UTF8Encoding($false)))
    $before = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash
    $rejected = $false
    try { & $SigningScript -PackageRoot $testRoot -VerifyOnly | Out-Null }
    catch {
        if ($_.Exception.Message -notlike 'Signature verification failed*') { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'VerifyOnly accepted an actually unsigned script.' }
    if ((Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash -ne $before) { throw 'VerifyOnly changed the unsigned fixture.' }
    Write-Output 'PASS actual unsigned VerifyOnly rejects without changing bytes'

    $rsa = [pscustomobject]@{
        HasPrivateKey = $true
        EnhancedKeyUsageList = @([pscustomobject]@{ ObjectId = [pscustomobject]@{ Value = '1.3.6.1.5.5.7.3.3' } })
        PublicKey = [pscustomobject]@{ Oid = [pscustomobject]@{ Value = '1.2.840.113549.1.1.1' } }
        Subject = 'CN=INERT RSA fixture'; Issuer = 'CN=INERT issuer fixture'
        NotBefore = (Get-Date).AddDays(-1); NotAfter = (Get-Date).AddDays(1)
    }
    $ecc = [pscustomobject]@{
        PublicKey = [pscustomobject]@{ Oid = [pscustomobject]@{ Value = '1.2.840.10045.2.1' } }
        Subject = 'CN=INERT ECC fixture'; Issuer = 'CN=INERT issuer fixture'
    }
    $signatureReadyFixture = [pscustomobject]@{ Status = 'Valid'; SignerCertificate = $rsa; TimeStamperCertificate = [pscustomobject]@{ Subject = 'INERT timestamp fixture' } }
    $global:bluetardigradeSignTestState = @{ Certificate = $rsa; Ready = $signatureReadyFixture; Existing = $null; Count = 0; File = $fixture }
    # The only certificate-store operation is intercepted: no real certificate
    # is created, looked up, imported, exported or passed to a signing cmdlet.
    function Get-Item {
        [CmdletBinding()]
        param([string]$LiteralPath)
        if ($LiteralPath -like 'Cert:\*') { return $global:bluetardigradeSignTestState.Certificate }
        Microsoft.PowerShell.Management\Get-Item @PSBoundParameters
    }
    function Get-AuthenticodeSignature {
        [CmdletBinding()]
        param([string]$LiteralPath)
        if ($LiteralPath -ne $global:bluetardigradeSignTestState.File) { throw 'Unexpected fixture signature request.' }
        if ($global:bluetardigradeSignTestState.Count -gt 0) { return $global:bluetardigradeSignTestState.Ready }
        return $global:bluetardigradeSignTestState.Existing
    }
    function Set-AuthenticodeSignature {
        [CmdletBinding()]
        param([string]$LiteralPath, $Certificate, [string]$HashAlgorithm, [string]$TimestampServer)
        if ($LiteralPath -ne $global:bluetardigradeSignTestState.File -or $Certificate -ne $global:bluetardigradeSignTestState.Certificate -or $HashAlgorithm -ne 'SHA256') {
            throw 'Unexpected fixture signing request.'
        }
        $global:bluetardigradeSignTestState.Count++
        return $global:bluetardigradeSignTestState.Ready
    }
    foreach ($case in @(
        [pscustomobject]@{ Name = 'ECC'; Existing = [pscustomobject]@{ Status = 'Valid'; SignerCertificate = $ecc; TimeStamperCertificate = [pscustomobject]@{} }; Signs = 1 },
        [pscustomobject]@{ Name = 'RSA without timestamp'; Existing = [pscustomobject]@{ Status = 'Valid'; SignerCertificate = $rsa; TimeStamperCertificate = $null }; Signs = 1 },
        [pscustomobject]@{ Name = 'completed RSA'; Existing = $signatureReadyFixture; Signs = 0 }
    )) {
        $global:bluetardigradeSignTestState.Count = 0
        $global:bluetardigradeSignTestState.Existing = $case.Existing
        & $SigningScript -PackageRoot $testRoot -CertificateThumbprint ('F' * 40) -TimestampServer 'http://timestamp.example.invalid' -Confirm:$false | Out-Null
        if ($global:bluetardigradeSignTestState.Count -ne $case.Signs) { throw ('Incorrect fixture signing behavior for ' + $case.Name) }
        if ((Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash -ne $before) { throw 'Inert signing fixture unexpectedly changed bytes.' }
        Write-Output ('PASS signing-policy fixture: ' + $case.Name)
    }
    Write-Output 'No certificate or key was created; no actual signing, timestamping or SAC validation was performed.'
} finally {
    Remove-Variable -Name bluetardigradeSignTestState -Scope Global -ErrorAction SilentlyContinue
    # Check the absolute deletion target before recursively removing only the
    # temporary directory created by this test.
    $absoluteTestRoot = [IO.Path]::GetFullPath($testRoot)
    if ([IO.Path]::GetDirectoryName($absoluteTestRoot) -ne $temporaryParent -or
        [IO.Path]::GetFileName($absoluteTestRoot) -notlike 'bluetardigrade-sign-test-*') {
        throw 'Unexpected temporary cleanup path.'
    }
    Remove-Item -LiteralPath $absoluteTestRoot -Recurse -Force
}

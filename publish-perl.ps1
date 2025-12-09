# Publish Perl SDK to CPAN (v0.5.3)
# This script replicates what the GitHub workflow does

$ErrorActionPreference = "Stop"

# Use Strawberry Perl's gmake
$gmake = "C:\Strawberry\c\bin\gmake.exe"

# Add GnuWin32 tools (gzip, etc.) to PATH
$env:Path += ";C:\Program Files (x86)\GnuWin32\bin"

$Version = "0.5.3"

# Prompt for PAUSE credentials
$PauseUsername = Read-Host "Enter your PAUSE username"
$PausePassword = Read-Host "Enter your PAUSE password" -AsSecureString
$PausePasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PausePassword)
)

Write-Host "`nBuilding Perl distribution for v$Version..." -ForegroundColor Cyan

Push-Location perl

try {
    # Update version in all .pm files
    Write-Host "Updating version in .pm files..." -ForegroundColor Yellow
    Get-ChildItem -Path lib -Recurse -Filter "*.pm" | ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        $updated = $content -replace "VERSION = '[^']*'", "VERSION = '$Version'"
        Set-Content $_.FullName $updated -NoNewline
    }

    # Build the distribution
    Write-Host "Running perl Makefile.PL..." -ForegroundColor Yellow
    perl Makefile.PL
    if ($LASTEXITCODE -ne 0) { throw "Makefile.PL failed" }

    Write-Host "Running gmake..." -ForegroundColor Yellow
    & $gmake
    if ($LASTEXITCODE -ne 0) { throw "gmake failed" }

    Write-Host "Running gmake manifest..." -ForegroundColor Yellow
    & $gmake manifest
    if ($LASTEXITCODE -ne 0) { throw "gmake manifest failed" }

    Write-Host "Running gmake dist..." -ForegroundColor Yellow
    & $gmake dist
    if ($LASTEXITCODE -ne 0) { throw "gmake dist failed" }

    # Find the tarball
    $Tarball = Get-ChildItem -Filter "JSON-Structure-*.tar.gz" | Select-Object -First 1
    if (-not $Tarball) {
        throw "No distribution tarball found"
    }

    Write-Host "`nBuilt: $($Tarball.Name)" -ForegroundColor Green

    # Confirm upload
    $Confirm = Read-Host "`nUpload $($Tarball.Name) to CPAN? (y/N)"
    if ($Confirm -ne "y" -and $Confirm -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }

    # Upload to CPAN
    Write-Host "`nUploading to CPAN..." -ForegroundColor Cyan
    cpan-upload -u $PauseUsername -p $PausePasswordPlain $Tarball.Name

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nSuccessfully uploaded to CPAN!" -ForegroundColor Green
    } else {
        throw "cpan-upload failed"
    }

} finally {
    Pop-Location
    
    # Clean up - reset version changes
    Write-Host "`nResetting version changes..." -ForegroundColor Yellow
    git checkout -- perl/lib/
}

Write-Host "`nDone! The package should appear on CPAN within a few hours." -ForegroundColor Green
Write-Host "You can check status at: https://metacpan.org/author/$($PauseUsername.ToUpper())" -ForegroundColor Cyan

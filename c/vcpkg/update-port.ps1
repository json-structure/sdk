#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Updates vcpkg port files for a new release.

.DESCRIPTION
    This script updates vcpkg.json and portfile.cmake with the correct version
    and SHA512 hash for a given release tag.

.PARAMETER Version
    The version to update to (e.g., "0.1.0"). If not specified, uses the latest git tag.

.PARAMETER CalculateSha
    If specified, downloads the release tarball and calculates the SHA512.

.EXAMPLE
    ./update-port.ps1 -Version 0.1.0 -CalculateSha
#>

param(
    [string]$Version,
    [switch]$CalculateSha
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Get version from latest git tag if not specified
if (-not $Version) {
    $tag = git describe --tags --abbrev=0 2>$null
    if ($tag) {
        $Version = $tag -replace '^v', ''
        Write-Host "Using version from git tag: $Version"
    } else {
        Write-Error "No version specified and no git tags found"
        exit 1
    }
}

# Update vcpkg.json
$vcpkgJsonPath = Join-Path $ScriptDir "vcpkg.json"
$vcpkgJson = Get-Content $vcpkgJsonPath -Raw | ConvertFrom-Json
$vcpkgJson.version = $Version
$vcpkgJson | ConvertTo-Json -Depth 10 | Set-Content $vcpkgJsonPath -NoNewline
Write-Host "Updated vcpkg.json to version $Version"

# Calculate SHA512 if requested
if ($CalculateSha) {
    $tarballUrl = "https://github.com/json-structure/sdk/archive/refs/tags/v$Version.tar.gz"
    Write-Host "Downloading: $tarballUrl"
    
    $tempFile = [System.IO.Path]::GetTempFileName()
    try {
        Invoke-WebRequest -Uri $tarballUrl -OutFile $tempFile -ErrorAction Stop
        $hash = (Get-FileHash -Path $tempFile -Algorithm SHA512).Hash.ToLower()
        Write-Host "SHA512: $hash"
        
        # Update portfile.cmake
        $portfilePath = Join-Path $ScriptDir "portfile.cmake"
        $portfileContent = Get-Content $portfilePath -Raw
        $portfileContent = $portfileContent -replace 'SHA512 [a-fA-F0-9]+', "SHA512 $hash"
        Set-Content $portfilePath $portfileContent -NoNewline
        Write-Host "Updated portfile.cmake with SHA512"
    }
    catch {
        Write-Warning "Could not download tarball. You may need to create the release first."
        Write-Warning "Error: $_"
        Write-Host ""
        Write-Host "To get SHA512 manually, run:"
        Write-Host "  vcpkg install json-structure --overlay-ports=$ScriptDir"
        Write-Host "The error message will show the correct SHA512."
    }
    finally {
        Remove-Item $tempFile -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "Port files updated. Next steps:"
Write-Host "  1. Commit and push the changes"
Write-Host "  2. Copy files to your vcpkg fork: ports/json-structure/"
Write-Host "  3. Run: vcpkg x-add-version json-structure"
Write-Host "  4. Submit PR to microsoft/vcpkg"

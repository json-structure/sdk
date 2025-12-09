<#
.SYNOPSIS
    Tags a new version release for the JSON Structure SDK.

.DESCRIPTION
    Creates all required Git tags for a release:
    - v{VERSION}        - Main version tag (triggers SDK CI workflows)
    - go/v{VERSION}     - Go module tag (required for Go package discovery)
    - jstruct-v{VERSION} - CLI release tag (triggers CLI build and GitHub Release)

.PARAMETER Version
    The version number to tag (e.g., "0.5.4"). Do not include the "v" prefix.

.PARAMETER Push
    If specified, pushes the tags to origin after creation.

.PARAMETER CliOnly
    If specified, only creates the jstruct-v{VERSION} tag (for CLI-only releases).

.EXAMPLE
    .\tag-release.ps1 -Version 0.5.4
    Creates tags locally: v0.5.4, go/v0.5.4, jstruct-v0.5.4

.EXAMPLE
    .\tag-release.ps1 -Version 0.5.4 -Push
    Creates and pushes all tags to origin.

.EXAMPLE
    .\tag-release.ps1 -Version 0.5.4 -CliOnly -Push
    Creates and pushes only the CLI tag (jstruct-v0.5.4).
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [switch]$Push,

    [switch]$CliOnly
)

$ErrorActionPreference = 'Stop'

# Validate we're in a git repository
if (-not (Test-Path .git)) {
    Write-Error "Not in a git repository root. Please run from the SDK repository root."
    exit 1
}

# Check for uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Warning "You have uncommitted changes:"
    $status | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    $confirm = Read-Host "Continue anyway? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "Aborted." -ForegroundColor Red
        exit 1
    }
}

# Define tags to create
if ($CliOnly) {
    $tags = @(
        "jstruct-v$Version"
    )
} else {
    $tags = @(
        "v$Version",
        "go/v$Version",
        "jstruct-v$Version"
    )
}

Write-Host "`nTags to create:" -ForegroundColor Cyan
$tags | ForEach-Object { Write-Host "  - $_" -ForegroundColor White }

# Check if tags already exist
$existingTags = @()
foreach ($tag in $tags) {
    $exists = git tag -l $tag
    if ($exists) {
        $existingTags += $tag
    }
}

if ($existingTags.Count -gt 0) {
    Write-Warning "The following tags already exist:"
    $existingTags | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    $confirm = Read-Host "Delete and recreate them? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "Aborted." -ForegroundColor Red
        exit 1
    }
    
    # Delete existing tags locally
    foreach ($tag in $existingTags) {
        Write-Host "Deleting local tag: $tag" -ForegroundColor Yellow
        git tag -d $tag
    }
    
    # Delete from remote if pushing
    if ($Push) {
        foreach ($tag in $existingTags) {
            Write-Host "Deleting remote tag: $tag" -ForegroundColor Yellow
            git push origin ":refs/tags/$tag" 2>$null
        }
    }
}

# Create tags
Write-Host "`nCreating tags..." -ForegroundColor Cyan
foreach ($tag in $tags) {
    Write-Host "  Creating: $tag" -ForegroundColor Green
    git tag $tag
}

# Push tags if requested
if ($Push) {
    Write-Host "`nPushing tags to origin..." -ForegroundColor Cyan
    foreach ($tag in $tags) {
        Write-Host "  Pushing: $tag" -ForegroundColor Green
        git push origin $tag
    }
    
    Write-Host "`n✓ All tags pushed successfully!" -ForegroundColor Green
    Write-Host "`nWorkflows triggered:" -ForegroundColor Cyan
    if (-not $CliOnly) {
        Write-Host "  - SDK workflows (Python, .NET, Java, TypeScript, Go, Rust, etc.)" -ForegroundColor White
    }
    Write-Host "  - CLI release workflow (builds binaries and creates GitHub Release)" -ForegroundColor White
    Write-Host "`nMonitor at: https://github.com/json-structure/sdk/actions" -ForegroundColor Blue
} else {
    Write-Host "`n✓ Tags created locally." -ForegroundColor Green
    Write-Host "Run with -Push to push tags to origin." -ForegroundColor Yellow
}

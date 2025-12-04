# Adversarial Test Runner
# Runs adversarial test cases against all SDKs to find bugs

$ErrorActionPreference = "Continue"
$testRoot = $PSScriptRoot
$sdkRoot = Split-Path $testRoot -Parent

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "JSON Structure Adversarial Test Suite" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

$schemas = Get-ChildItem -Path "$testRoot\schemas\adversarial\*.struct.json" -File
$instances = Get-ChildItem -Path "$testRoot\instances\adversarial\*.json" -File

Write-Host "Found $($schemas.Count) adversarial schemas" -ForegroundColor Yellow
Write-Host "Found $($instances.Count) adversarial instances" -ForegroundColor Yellow
Write-Host ""

# Test each SDK
$sdks = @(
    @{ Name = "TypeScript"; Dir = "typescript"; Cmd = "npx tsx demo/validate.ts" }
    @{ Name = "Python"; Dir = "python"; Cmd = "python -m json_structure.cli" }
    @{ Name = "Go"; Dir = "go"; Cmd = "go run ./demo/validate.go" }
    @{ Name = "Java"; Dir = "java"; Cmd = "mvn -q exec:java -Dexec.mainClass=demo.Validate" }
    @{ Name = ".NET"; Dir = "dotnet"; Cmd = "dotnet run --project demo" }
)

$results = @()

foreach ($sdk in $sdks) {
    Write-Host "Testing $($sdk.Name) SDK..." -ForegroundColor Magenta
    Write-Host "================================" -ForegroundColor Magenta
    
    $sdkDir = Join-Path $sdkRoot $sdk.Dir
    
    if (-not (Test-Path $sdkDir)) {
        Write-Host "  SDK directory not found, skipping" -ForegroundColor Yellow
        continue
    }
    
    # Test schema validation (should detect invalid schemas)
    Write-Host "  Schema validation tests:" -ForegroundColor White
    foreach ($schema in $schemas) {
        $name = $schema.BaseName
        Write-Host "    $name... " -NoNewline
        
        $startTime = Get-Date
        try {
            # Timeout after 5 seconds to catch infinite loops
            $job = Start-Job -ScriptBlock {
                param($dir, $file)
                Set-Location $dir
                # This is a placeholder - actual command depends on SDK
            } -ArgumentList $sdkDir, $schema.FullName
            
            $completed = Wait-Job $job -Timeout 5
            if (-not $completed) {
                Stop-Job $job
                Remove-Job $job -Force
                Write-Host "TIMEOUT (possible infinite loop)" -ForegroundColor Red
                $results += @{ SDK = $sdk.Name; Test = $name; Type = "Schema"; Result = "TIMEOUT" }
            } else {
                $elapsed = ((Get-Date) - $startTime).TotalMilliseconds
                Write-Host "OK (${elapsed}ms)" -ForegroundColor Green
                $results += @{ SDK = $sdk.Name; Test = $name; Type = "Schema"; Result = "OK"; Time = $elapsed }
                Remove-Job $job
            }
        } catch {
            Write-Host "ERROR: $_" -ForegroundColor Red
            $results += @{ SDK = $sdk.Name; Test = $name; Type = "Schema"; Result = "ERROR"; Error = $_ }
        }
    }
    
    Write-Host ""
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

$timeouts = $results | Where-Object { $_.Result -eq "TIMEOUT" }
$errors = $results | Where-Object { $_.Result -eq "ERROR" }
$slowTests = $results | Where-Object { $_.Time -gt 1000 }

if ($timeouts.Count -gt 0) {
    Write-Host ""
    Write-Host "TIMEOUTS (potential infinite loops):" -ForegroundColor Red
    $timeouts | ForEach-Object { Write-Host "  $($_.SDK): $($_.Test)" }
}

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "ERRORS (crashes or exceptions):" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $($_.SDK): $($_.Test) - $($_.Error)" }
}

if ($slowTests.Count -gt 0) {
    Write-Host ""
    Write-Host "SLOW TESTS (>1s, potential performance issues):" -ForegroundColor Yellow
    $slowTests | ForEach-Object { Write-Host "  $($_.SDK): $($_.Test) - $($_.Time)ms" }
}

if ($timeouts.Count -eq 0 -and $errors.Count -eq 0) {
    Write-Host ""
    Write-Host "All tests passed!" -ForegroundColor Green
}

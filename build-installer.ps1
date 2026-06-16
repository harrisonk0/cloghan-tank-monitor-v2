# build-installer.ps1
# Generates a pre-packaged install.ps1 with your .env baked in (base64-encoded).
#
# Usage:
#   1. Configure your .env file with the desired settings
#   2. Run: .\build-installer.ps1
#   3. A package/ folder is created with install.ps1 + start-tray.bat
#   4. Zip the package/ folder and share it
#
# The end user just extracts the zip and runs install.ps1.
# No prompts, no typing — their .env is pre-configured.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvPath = Join-Path $RepoRoot ".env"
$OutputDir = Join-Path $RepoRoot "package"
$InstallScript = Join-Path $RepoRoot "install.ps1"
$OutputScript = Join-Path $OutputDir "install.ps1"
$OutputBat = Join-Path $OutputDir "start-tray.bat"

if (-not (Test-Path $EnvPath)) {
    Write-Host "ERROR: No .env file found at $EnvPath" -ForegroundColor Red
    Write-Host "Create one first (copy .env.example to .env and configure it)." -ForegroundColor Yellow
    exit 1
}

# Validate .env has required fields
$envContent = Get-Content $EnvPath -Raw
$hasKey = $envContent -match "AI_API_KEY=(.+)"
if (-not $hasKey -or $Matches[1].Trim() -eq "replace-me") {
    Write-Host "ERROR: .env must have a valid AI_API_KEY set." -ForegroundColor Red
    Write-Host "Edit .env and set your API key before building." -ForegroundColor Yellow
    exit 1
}

# Base64-encode the .env
$envBytes = [System.Text.Encoding]::UTF8.GetBytes($envContent)
$base64 = [System.Convert]::ToBase64String($envBytes)

# Read the install script and inject the config
$script = Get-Content $InstallScript -Raw

# Replace the empty $BakedConfig placeholder with the actual base64 value
$script = $script -replace '\$BakedConfig = ""', "`$BakedConfig = `"$base64`""

# Create output directory
if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }
New-Item -ItemType Directory -Path $OutputDir | Out-Null

# Write the packaged install script
Set-Content -Path $OutputScript -Value $script -Encoding UTF8

# Copy start-tray.bat and VBS silent launcher
Copy-Item (Join-Path $RepoRoot "start-tray.bat") $OutputBat
Copy-Item (Join-Path $RepoRoot "start-tray-silent.vbs") (Join-Path $OutputDir "start-tray-silent.vbs")

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Package built!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Location: $OutputDir" -ForegroundColor White
Write-Host ""
Write-Host "  Contents:" -ForegroundColor White
Write-Host "    install.ps1          (pre-configured installer)" -ForegroundColor Gray
Write-Host "    start-tray.bat       (app launcher - console)" -ForegroundColor Gray
Write-Host "    start-tray-silent.vbs (app launcher - silent)" -ForegroundColor Gray
Write-Host ""
Write-Host "  To share:" -ForegroundColor White
Write-Host "    1. Zip the package/ folder" -ForegroundColor Gray
Write-Host "    2. Send the zip to the user" -ForegroundColor Gray
Write-Host "    3. They extract and double-click install.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "  Config is base64-encoded (not plaintext), but" -ForegroundColor Yellow
Write-Host "  not encryption - anyone can decode it." -ForegroundColor Yellow
Write-Host ""

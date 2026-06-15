# Cloghan Tank Monitor v2 - Windows Installer
# Run from GitHub:
#   irm https://raw.githubusercontent.com/YOUR_USERNAME/cloghan-tank-monitor-v2/main/install.ps1 | iex
#
# Or download the repo and run Install.bat

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/YOUR_USERNAME/cloghan-tank-monitor-v2.git"
$InstallDir = Join-Path $env:USERPROFILE "CloghanTankMonitor"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Cloghan Tank Monitor v2 - Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ─── Step 1: Check/Install Node.js ───

Write-Host "[1/8] Checking Node.js..." -ForegroundColor Yellow

$nodeInstalled = $false
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        Write-Host "  Node.js $nodeVersion found" -ForegroundColor Green
        $nodeInstalled = $true
    }
} catch {}

if (-not $nodeInstalled) {
    Write-Host "  Installing Node.js via winget..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Write-Host "  Node.js installed" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Failed to install Node.js. Install manually from https://nodejs.org" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ─── Step 2: Check/Install Git ───

Write-Host "[2/8] Checking Git..." -ForegroundColor Yellow

$gitInstalled = $false
try { $gitVersion = git --version 2>$null; if ($gitVersion) { Write-Host "  $gitVersion found" -ForegroundColor Green; $gitInstalled = $true } } catch {}

if (-not $gitInstalled) {
    Write-Host "  Installing Git via winget..." -ForegroundColor Yellow
    try {
        winget install Git.Git --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Write-Host "  Git installed" -ForegroundColor Green
    } catch { Write-Host "  ERROR: Failed to install Git." -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
}

# ─── Step 3: Check/Install ngrok ───

Write-Host "[3/8] Checking ngrok..." -ForegroundColor Yellow

$ngrokInstalled = $false
try { $ngrokVersion = ngrok --version 2>$null; if ($ngrokVersion) { Write-Host "  ngrok found" -ForegroundColor Green; $ngrokInstalled = $true } } catch {}

if (-not $ngrokInstalled) {
    Write-Host "  Installing ngrok via winget..." -ForegroundColor Yellow
    try {
        winget install Ngrok.Ngrok --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Write-Host "  ngrok installed" -ForegroundColor Green
    } catch { Write-Host "  WARNING: Failed to install ngrok." -ForegroundColor Yellow }
}

try { ngrok update 2>&1 | Out-Null } catch {}

# ─── Step 4: Clone the repository ───

Write-Host "[4/8] Downloading Cloghan Tank Monitor..." -ForegroundColor Yellow

if (Test-Path $InstallDir) {
    Write-Host "  Found existing install at $InstallDir" -ForegroundColor Green
    Push-Location $InstallDir
    try {
        git pull --quiet 2>$null
        Write-Host "  Updated to latest version" -ForegroundColor Green
    } catch { Write-Host "  Using existing version" -ForegroundColor Yellow }
    Pop-Location
} else {
    try {
        git clone --quiet $RepoUrl $InstallDir
        Write-Host "  Downloaded to $InstallDir" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Failed to download. Check your internet connection." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ─── Step 5: Prompt for API Keys ───

Write-Host "[5/8] Configuring API keys..." -ForegroundColor Yellow
Write-Host ""

$ngrokAuthToken = Read-Host "  Enter your ngrok auth token (from https://dashboard.ngrok.com/get-started/your-authtoken)"
if ([string]::IsNullOrWhiteSpace($ngrokAuthToken)) {
    Write-Host "  WARNING: ngrok auth token not provided. Tunnel will not work." -ForegroundColor Yellow
}

$openaiApiKey = Read-Host "  Enter your OpenAI API key (or compatible endpoint key)"
if ([string]::IsNullOrWhiteSpace($openaiApiKey)) {
    Write-Host "  ERROR: OpenAI API key is required." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$openaiBaseUrl = Read-Host "  Enter AI base URL (press Enter for https://api.openai.com/v1)"
if ([string]::IsNullOrWhiteSpace($openaiBaseUrl)) { $openaiBaseUrl = "https://api.openai.com/v1" }

$appApiKey = Read-Host "  Enter a password for the web dashboard (press Enter to generate one)"
if ([string]::IsNullOrWhiteSpace($appApiKey)) {
    $appApiKey = -join ((1..24) | ForEach-Object { '{0:X}' -f (Get-Random -Max 16) })
    Write-Host "  Generated dashboard password: $appApiKey" -ForegroundColor Cyan
}

Write-Host ""

# ─── Step 6: Configure ngrok ───

Write-Host "[6/8] Configuring ngrok..." -ForegroundColor Yellow

if (-not [string]::IsNullOrWhiteSpace($ngrokAuthToken)) {
    try {
        ngrok config add-authtoken $ngrokAuthToken 2>$null
        Write-Host "  ngrok configured" -ForegroundColor Green
    } catch { Write-Host "  WARNING: Could not configure ngrok." -ForegroundColor Yellow }
} else {
    Write-Host "  Skipping (no auth token provided)" -ForegroundColor Yellow
}

# ─── Step 7: Install npm dependencies ───

Write-Host "[7/8] Installing npm dependencies..." -ForegroundColor Yellow

Push-Location $InstallDir
try {
    npm install --production=false
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Host "  Dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: npm install failed." -ForegroundColor Red
    Pop-Location
    Read-Host "Press Enter to exit"
    exit 1
} finally { Pop-Location }

# ─── Step 8: Create .env and shortcuts ───

Write-Host "[8/8] Creating config and shortcuts..." -ForegroundColor Yellow

$envContent = @"
PORT=3000
AI_BASE_URL=$openaiBaseUrl
AI_API_KEY=$openaiApiKey
AI_MODEL=gpt-4o-mini
AI_CONFIDENCE_THRESHOLD=0.85
SCREENSHOT_SUCCESS_RETENTION_HOURS=3
API_KEY=$appApiKey
"@

$envPath = Join-Path $InstallDir ".env"
Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Host "  .env created" -ForegroundColor Green

$WshShell = New-Object -ComObject WScript.Shell

$desktopPath = [System.Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Cloghan Tank Monitor.lnk"
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/c `"$InstallDir\start-tray.bat`""
$shortcut.WorkingDirectory = $InstallDir
$shortcut.Description = "Cloghan Tank Monitor v2"
$shortcut.Save()
Write-Host "  Desktop shortcut created" -ForegroundColor Green

$startupPath = [System.Environment]::GetFolderPath("Startup")
$startupShortcutPath = Join-Path $startupPath "Cloghan Tank Monitor.lnk"
$startupShortcut = $WshShell.CreateShortcut($startupShortcutPath)
$startupShortcut.TargetPath = "cmd.exe"
$startupShortcut.Arguments = "/c `"$InstallDir\start-tray.bat`""
$startupShortcut.WorkingDirectory = $InstallDir
$startupShortcut.Description = "Cloghan Tank Monitor v2 - Auto-start"
$startupShortcut.WindowStyle = 7
$startupShortcut.Save()
Write-Host "  Startup shortcut created (auto-start on boot)" -ForegroundColor Green

# ─── Done ───

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Installed to: $InstallDir" -ForegroundColor White
Write-Host "  Dashboard password: $appApiKey" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To start the app:" -ForegroundColor White
Write-Host "    - Double-click 'Cloghan Tank Monitor' on your Desktop" -ForegroundColor White
Write-Host "    - Or restart your computer (it auto-starts)" -ForegroundColor White
Write-Host ""
Write-Host "  The web dashboard will be at http://localhost:5173" -ForegroundColor White
Write-Host "  Remote access via ngrok tunnel (URL shown in tray)" -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to exit"

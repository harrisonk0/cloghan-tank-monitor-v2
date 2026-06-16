# Cloghan Tank Monitor v2 - Windows Installer
# Run from GitHub:
#   irm https://raw.githubusercontent.com/harrisonk0/cloghan-tank-monitor-v2/main/install.ps1 | iex
#
# Or download the repo and run install.ps1

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/harrisonk0/cloghan-tank-monitor-v2.git"
$InstallDir = Join-Path $env:USERPROFILE "CloghanTankMonitor"
$EnvPath = Join-Path $InstallDir ".env"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Cloghan Tank Monitor v2 - Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ─── Helpers ──────────────────────────────────────────────────────────────────

function Test-Prereq($name, $checkCmd) {
    try {
        $result = & cmd /c "$checkCmd --version 2>&1"
        if ($LASTEXITCODE -eq 0 -and $result) {
            Write-Host "  $name found" -ForegroundColor Green
            return $true
        }
    } catch {}
    return $false
}

function Install-Prereq($name, $wingetId) {
    Write-Host "  Installing $name via winget..." -ForegroundColor Yellow
    try {
        winget install $wingetId --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Write-Host "  $name installed" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  ERROR: Failed to install $name." -ForegroundColor Red
        Write-Host "  Install manually and re-run this script." -ForegroundColor Red
        return $false
    }
}

# ─── Step 1: Check/Install Node.js ───────────────────────────────────────────

Write-Host "[1/7] Checking Node.js..." -ForegroundColor Yellow

if (-not (Test-Prereq "Node.js" "node")) {
    if (-not (Install-Prereq "Node.js" "OpenJS.NodeJS.LTS")) {
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ─── Step 2: Check/Install Git ───────────────────────────────────────────────

Write-Host "[2/7] Checking Git..." -ForegroundColor Yellow

if (-not (Test-Prereq "Git" "git")) {
    if (-not (Install-Prereq "Git" "Git.Git")) {
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ─── Step 3: Check/Install ngrok ─────────────────────────────────────────────

Write-Host "[3/7] Checking ngrok..." -ForegroundColor Yellow

$ngrokAvailable = Test-Prereq "ngrok" "ngrok"
if (-not $ngrokAvailable) {
    Install-Prereq "ngrok" "Ngrok.Ngrok" | Out-Null
}
try { ngrok update 2>&1 | Out-Null } catch {}

# ─── Step 4: Clone or update the repository ───────────────────────────────────

Write-Host "[4/7] Downloading Cloghan Tank Monitor..." -ForegroundColor Yellow

$isUpgrade = $false

if (Test-Path $InstallDir) {
    # Existing install — check if it's valid
    $isV2 = Test-Path (Join-Path $InstallDir "apps")
    $hasGit = Test-Path (Join-Path $InstallDir ".git")
    $hasEnv = Test-Path $EnvPath
    $hasNodeModules = Test-Path (Join-Path $InstallDir "node_modules")

    if (-not $hasGit) {
        Write-Host "  Existing folder found but it is not a git repo." -ForegroundColor Yellow
        $confirm = Read-Host "  Remove it and do a fresh install? (Y/n)"
        if ($confirm -ne "n") {
            Remove-Item -Recurse -Force $InstallDir
        } else {
            Write-Host "  Cannot upgrade without a git repo. Exiting." -ForegroundColor Red
            Read-Host "Press Enter to exit"
            exit 1
        }
    } elseif (-not $isV2) {
        Write-Host "  Found a v1 install (no apps/ directory)." -ForegroundColor Yellow
        Write-Host "  Upgrading to v2..." -ForegroundColor Yellow
        Push-Location $InstallDir
        try {
            git fetch origin --quiet
            git checkout main --quiet 2>$null
            git reset --hard origin/main --quiet 2>$null
            $isUpgrade = $true
            Write-Host "  Upgraded to v2" -ForegroundColor Green
        } catch {
            Write-Host "  WARNING: Could not auto-upgrade. Re-cloning..." -ForegroundColor Yellow
            Pop-Location
            Remove-Item -Recurse -Force $InstallDir
        }
        Pop-Location
    } else {
        # Valid v2 install — pull latest
        Write-Host "  Found existing install at $InstallDir" -ForegroundColor Green
        Push-Location $InstallDir
        try {
            $before = git rev-parse HEAD 2>$null
            git pull --quiet 2>$null
            $after = git rev-parse HEAD 2>$null
            if ($before -ne $after) {
                $isUpgrade = $true
                Write-Host "  Updated to latest version" -ForegroundColor Green
            } else {
                Write-Host "  Already up to date" -ForegroundColor Green
            }
        } catch {
            Write-Host "  Using existing version (update failed)" -ForegroundColor Yellow
        }
        Pop-Location
    }
}

if (-not (Test-Path $InstallDir)) {
    try {
        git clone --quiet $RepoUrl $InstallDir
        Write-Host "  Downloaded to $InstallDir" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Failed to download. Check your internet connection." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ─── Step 5: Configure ngrok ─────────────────────────────────────────────────

Write-Host "[5/7] Configuring ngrok..." -ForegroundColor Yellow

$existingNgrokToken = ""
try {
    $ngrokConfig = ngrok config check 2>&1 | Out-String
    # Just check if authtoken is already set — don't re-prompt if it is
} catch {}

$ngrokAuthToken = $null
try {
    $authtoken = (ngrok config get authtoken 2>$null | Out-String).Trim()
    if ($authtoken) {
        Write-Host "  ngrok auth token already configured" -ForegroundColor Green
    }
} catch {}

if (-not $authtoken) {
    $ngrokAuthToken = Read-Host "  Enter your ngrok auth token (from https://dashboard.ngrok.com/get-started/your-authtoken)"
    if (-not [string]::IsNullOrWhiteSpace($ngrokAuthToken)) {
        try {
            ngrok config add-authtoken $ngrokAuthToken 2>$null
            Write-Host "  ngrok configured" -ForegroundColor Green
        } catch {
            Write-Host "  WARNING: Could not configure ngrok." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  No auth token provided. Tunnel will not work until configured." -ForegroundColor Yellow
    }
}

# ─── Step 6: Install npm dependencies ────────────────────────────────────────

Write-Host "[6/7] Installing dependencies..." -ForegroundColor Yellow

Push-Location $InstallDir
try {
    $needsInstall = $isUpgrade -or (-not (Test-Path (Join-Path $InstallDir "node_modules")))
    if ($needsInstall) {
        npm install --production=false 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        Write-Host "  Dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "  Dependencies already installed" -ForegroundColor Green
    }
} catch {
    Write-Host "  ERROR: npm install failed." -ForegroundColor Red
    Pop-Location
    Read-Host "Press Enter to exit"
    exit 1
} finally { Pop-Location }

# ─── Step 7: Configure .env and create shortcuts ─────────────────────────────

Write-Host "[7/7] Creating config and shortcuts..." -ForegroundColor Yellow

# Prompt for AI API key
$openaiApiKey = $null
$openaiBaseUrl = $null

if (-not (Test-Path $EnvPath)) {
    # Fresh install — prompt for AI config
    Write-Host ""
    Write-Host "  AI Configuration:" -ForegroundColor Cyan

    $openaiApiKey = Read-Host "  Enter your OpenAI API key (or compatible endpoint key)"
    if ([string]::IsNullOrWhiteSpace($openaiApiKey)) {
        Write-Host "  ERROR: OpenAI API key is required." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }

    $openaiBaseUrl = Read-Host "  Enter AI base URL (press Enter for https://api.openai.com/v1)"
    if ([string]::IsNullOrWhiteSpace($openaiBaseUrl)) { $openaiBaseUrl = "https://api.openai.com/v1" }

    Write-Host ""
} else {
    Write-Host "  Existing .env found — preserving your settings" -ForegroundColor Green
}

# Write .env only for fresh installs (never overwrite existing config)
if (-not (Test-Path $EnvPath)) {
    $envContent = @"
PORT=3000
AI_BASE_URL=$openaiBaseUrl
AI_API_KEY=$openaiApiKey
AI_MODEL=gpt-4o-mini
AI_CONFIDENCE_THRESHOLD=0.85
SCREENSHOT_SUCCESS_RETENTION_HOURS=3
"@
    Set-Content -Path $EnvPath -Value $envContent -Encoding UTF8
    Write-Host "  .env created" -ForegroundColor Green
}

# Create shortcuts
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

# ─── Done ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Installed to: $InstallDir" -ForegroundColor White
Write-Host ""
Write-Host "  To start:" -ForegroundColor White
Write-Host "    Double-click 'Cloghan Tank Monitor' on your Desktop" -ForegroundColor White
Write-Host "    (or restart your computer — it auto-starts)" -ForegroundColor Gray
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Connect to the Web Dashboard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Open https://cloghan-tm.vercel.app in any browser" -ForegroundColor White
Write-Host ""
Write-Host "  Then right-click the tray icon and select:" -ForegroundColor White
Write-Host ""
Write-Host "    Copy Magic Link (Read/Write)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Paste the link into your browser — you're logged in!" -ForegroundColor White
Write-Host "  No need to enter URLs or keys manually." -ForegroundColor Gray
Write-Host ""
Write-Host "  To connect from another device, generate another" -ForegroundColor White
Write-Host "  magic link from the tray menu." -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to exit"

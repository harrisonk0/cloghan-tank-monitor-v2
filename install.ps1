# Cloghan Tank Monitor v2 - Windows Installer / Updater
# Run from GitHub:
#   irm https://raw.githubusercontent.com/harrisonk0/cloghan-tank-monitor-v2/main/install.ps1 | iex
#
# Re-running this script will update an existing install to the latest version.
# Pass -NonInteractive to skip prompts (uses existing .env, skips ngrok token).

param(
    [switch]$NonInteractive
)

# This placeholder is replaced by build-installer.ps1 with a base64-encoded .env
# when creating a pre-packaged installer. Leave empty for the standard installer.
$BakedConfig = ""

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/harrisonk0/cloghan-tank-monitor-v2.git"
$InstallDir = Join-Path $env:USERPROFILE "CloghanTankMonitor"
$EnvPath = Join-Path $InstallDir ".env"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Cloghan Tank Monitor v2" -ForegroundColor Cyan
if ($NonInteractive) { Write-Host "  (non-interactive mode)" -ForegroundColor DarkGray }
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Helpers ---

function Test-Command($name, $cmd) {
    try {
        $result = & cmd /c "$cmd --version 2>&1"
        if ($LASTEXITCODE -eq 0 -and $result) {
            Write-Host "  $name found" -ForegroundColor Green
            return $true
        }
    } catch {}
    return $false
}

function Install-Winget($name, $id) {
    Write-Host "  Installing $name via winget..." -ForegroundColor Yellow
    try {
        winget install $id --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Write-Host "  $name installed" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  ERROR: Failed to install $name. Install manually from the web." -ForegroundColor Red
        return $false
    }
}

# --- Step 1: Check/Install prerequisites ---

Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow

if (-not (Test-Command "Node.js" "node")) {
    if (-not (Install-Winget "Node.js" "OpenJS.NodeJS.LTS")) {
        if (-not $NonInteractive) { Read-Host "Press Enter to exit" }
        exit 1
    }
}

if (-not (Test-Command "Git" "git")) {
    if (-not (Install-Winget "Git" "Git.Git")) {
        if (-not $NonInteractive) { Read-Host "Press Enter to exit" }
        exit 1
    }
}

if (-not (Test-Command "ngrok" "ngrok")) {
    Install-Winget "ngrok" "Ngrok.Ngrok" | Out-Null
}
try { ngrok update 2>&1 | Out-Null } catch {}

# --- Step 2: Clone or update the repository ---

Write-Host "[2/5] Getting latest code..." -ForegroundColor Yellow

$isFreshInstall = $false

if (Test-Path $InstallDir) {
    $hasGit = Test-Path (Join-Path $InstallDir ".git")

    if (-not $hasGit) {
        Write-Host "  Found a folder at $InstallDir but it is not a git repo." -ForegroundColor Yellow
        if ($NonInteractive) {
            Write-Host "  Removing and re-cloning..." -ForegroundColor Yellow
            Remove-Item -Recurse -Force $InstallDir
        } else {
            $confirm = Read-Host "  Remove it and do a fresh install? (Y/n)"
            if ($confirm -ne "n") {
                Remove-Item -Recurse -Force $InstallDir
            } else {
                Write-Host "  Cannot update without a git repo. Exiting." -ForegroundColor Red
                Read-Host "Press Enter to exit"; exit 1
            }
        }
    } else {
        Push-Location $InstallDir
        try {
            $before = (git rev-parse HEAD 2>$null).Trim()
            $savedInstallHash = if (Test-Path (Join-Path $InstallDir ".install-hash")) { Get-Content (Join-Path $InstallDir ".install-hash") -Raw } else { $null }
            git fetch origin --quiet 2>$null
            git reset --hard origin/main --quiet 2>$null
            git clean -fd --quiet 2>$null
            if ($null -ne $savedInstallHash) { Set-Content -Path (Join-Path $InstallDir ".install-hash") -Value $savedInstallHash -NoNewline }
            $after = (git rev-parse HEAD 2>$null).Trim()

            if ($before -ne $after) {
                $commits = (git log --oneline "$before..$after" 2>$null | Measure-Object).Count
                Write-Host "  Updated ($commits new commits)" -ForegroundColor Green
            } else {
                Write-Host "  Already up to date" -ForegroundColor Green
            }
        } catch {
            Write-Host "  WARNING: Could not pull updates. Using existing code." -ForegroundColor Yellow
        }
        Pop-Location
    }
}

if (-not (Test-Path $InstallDir)) {
    try {
        git clone --quiet $RepoUrl $InstallDir
        $isFreshInstall = $true
        Write-Host "  Downloaded to $InstallDir" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Failed to download. Check your internet connection." -ForegroundColor Red
        if (-not $NonInteractive) { Read-Host "Press Enter to exit" }
        exit 1
    }
}

# --- Step 3: Configure ngrok (first install only) ---

Write-Host "[3/5] Checking ngrok..." -ForegroundColor Yellow

$hasAuthToken = $false
try {
    $ngrokYml = Join-Path $env:LOCALAPPDATA "ngrok\ngrok.yml"
    $ngrokYmlAlt = Join-Path $env:USERPROFILE ".config\ngrok\ngrok.yml"
    $configFile = if (Test-Path $ngrokYml) { $ngrokYml } elseif (Test-Path $ngrokYmlAlt) { $ngrokYmlAlt } else { $null }
    if ($configFile) {
        $conf = Get-Content $configFile -Raw
        if ($conf -match 'authtoken:\s*\S') {
            $hasAuthToken = $true
        }
    }
} catch {}

if ($hasAuthToken) {
    Write-Host "  ngrok already configured" -ForegroundColor Green
} elseif ($NonInteractive) {
    Write-Host "  Skipping (non-interactive)" -ForegroundColor Yellow
} else {
    $token = Read-Host "  Enter your ngrok auth token (from https://dashboard.ngrok.com/get-started/your-authtoken)"
    if (-not [string]::IsNullOrWhiteSpace($token)) {
        $configured = $false
        try {
            $result = & cmd /c "ngrok config add-authtoken $token 2>&1" 2>$null
            if ($LASTEXITCODE -eq 0) { $configured = $true }
        } catch {}
        if (-not $configured) {
            try {
                $ngrokDir = Join-Path $env:LOCALAPPDATA "ngrok"
                if (-not (Test-Path $ngrokDir)) { New-Item -ItemType Directory -Path $ngrokDir -Force | Out-Null }
                Set-Content -Path (Join-Path $ngrokDir "ngrok.yml") -Value "version: " + [char]34 + "2" + [char]34 + "`nauthtoken: $token" -Encoding UTF8
                $configured = $true
            } catch {}
        }
        if ($configured) {
            Write-Host "  ngrok configured" -ForegroundColor Green
        } else {
            Write-Host "  WARNING: Could not configure ngrok." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  No token provided. Tunnel will not work until configured." -ForegroundColor Yellow
    }
}

# --- Step 4: Install npm dependencies ---

Write-Host "[4/5] Installing dependencies..." -ForegroundColor Yellow

Push-Location $InstallDir
try {
    $nodeModulesExists = Test-Path (Join-Path $InstallDir "node_modules")
    $pkgHash = if (Test-Path (Join-Path $InstallDir "package.json")) {
        (Get-FileHash (Join-Path $InstallDir "package.json") -Algorithm MD5).Hash
    } else { "" }
    $hashFile = Join-Path $InstallDir ".install-hash"
    $savedHash = if (Test-Path $hashFile) { (Get-Content $hashFile -Raw).Trim() } else { "" }

    if (-not $nodeModulesExists -or $pkgHash -ne $savedHash) {
        Write-Host "  Installing..." -ForegroundColor Yellow
        $null = & cmd /c "cd /d `"$InstallDir`" && npm install 2>&1"
        Set-Content -Path $hashFile -Value $pkgHash -NoNewline
        Write-Host "  Dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "  Dependencies up to date" -ForegroundColor Green
    }
} catch {
    Write-Host "  ERROR: npm install failed." -ForegroundColor Red
    Pop-Location
    if (-not $NonInteractive) { Read-Host "Press Enter to exit" }
    exit 1
} finally { Pop-Location }

# --- Step 5: Configure .env and create shortcuts ---

Write-Host "[5/5] Setting up..." -ForegroundColor Yellow

if (-not (Test-Path $EnvPath)) {
    if ($BakedConfig) {
        # Pre-packaged installer: decode embedded config
        try {
            $envContent = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($BakedConfig))
            Set-Content -Path $EnvPath -Value $envContent -Encoding UTF8
            Write-Host "  Pre-configured settings applied" -ForegroundColor Green
        } catch {
            Write-Host "  ERROR: Could not decode embedded configuration." -ForegroundColor Red
            if (-not $NonInteractive) { Read-Host "Press Enter to exit" }
            exit 1
        }
    } elseif ($NonInteractive) {
        Write-Host "  No .env found - using defaults (AI_API_KEY not set)" -ForegroundColor Yellow
        $lines = @(
            "PORT=3000",
            "AI_BASE_URL=https://api.openai.com/v1",
            "AI_API_KEY=replace-me",
            "AI_MODEL=gpt-4o-mini",
            "AI_CONFIDENCE_THRESHOLD=0.85",
            "SCREENSHOT_SUCCESS_RETENTION_HOURS=3"
        )
        $envContent = $lines -join "`n"
        Set-Content -Path $EnvPath -Value $envContent -Encoding UTF8
        Write-Host "  .env created with defaults" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "  First install - AI configuration:" -ForegroundColor Cyan

        $apiKey = Read-Host "  Enter your OpenAI API key (or compatible endpoint key)"
        if ([string]::IsNullOrWhiteSpace($apiKey)) {
            Write-Host "  ERROR: API key is required." -ForegroundColor Red
            Read-Host "Press Enter to exit"; exit 1
        }

        $baseUrl = Read-Host "  Enter AI base URL (press Enter for https://api.openai.com/v1)"
        if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = "https://api.openai.com/v1" }

        $aiModel = Read-Host "  Enter AI model (press Enter for gpt-4o-mini)"
        if ([string]::IsNullOrWhiteSpace($aiModel)) { $aiModel = "gpt-4o-mini" }

        $lines = @(
            "PORT=3000",
            "AI_BASE_URL=$baseUrl",
            "AI_API_KEY=$apiKey",
            "AI_MODEL=$aiModel",
            "AI_CONFIDENCE_THRESHOLD=0.85",
            "SCREENSHOT_SUCCESS_RETENTION_HOURS=3"
        )
        $envContent = $lines -join "`n"
        Set-Content -Path $EnvPath -Value $envContent -Encoding UTF8
        Write-Host "  .env created" -ForegroundColor Green
    }
} else {
    Write-Host "  Existing .env found - preserving your settings" -ForegroundColor Green
}

# Shortcuts
$WshShell = New-Object -ComObject WScript.Shell

$desktop = [System.Environment]::GetFolderPath("Desktop")
$lnk = $WshShell.CreateShortcut((Join-Path $desktop "Cloghan Tank Monitor.lnk"))
$lnk.TargetPath = "wscript.exe"
$lnk.Arguments = "`"$InstallDir\start-tray-silent.vbs`""
$lnk.WorkingDirectory = $InstallDir
$lnk.Description = "Cloghan Tank Monitor v2"
$lnk.Save()

$startup = [System.Environment]::GetFolderPath("Startup")
$slnk = $WshShell.CreateShortcut((Join-Path $startup "Cloghan Tank Monitor.lnk"))
$slnk.TargetPath = "wscript.exe"
$slnk.Arguments = "`"$InstallDir\start-tray-silent.vbs`""
$slnk.WorkingDirectory = $InstallDir
$slnk.Description = "Cloghan Tank Monitor v2 - Auto-start"
$slnk.WindowStyle = 7
$slnk.Save()

Write-Host "  Shortcuts updated" -ForegroundColor Green

# --- Done ---

$action = if ($isFreshInstall) { "Installed" } else { "Updated" }
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  $action!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Location: $InstallDir" -ForegroundColor White
Write-Host ""
Write-Host "  Start: double-click 'Cloghan Tank Monitor' on your Desktop" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Connect to the Web Dashboard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Start the app (desktop shortcut)" -ForegroundColor White
Write-Host "  2. Right-click tray icon > Copy Magic Link (Read/Write)" -ForegroundColor White
Write-Host "  3. Paste the link into https://cloghan-tm.vercel.app" -ForegroundColor White
Write-Host ""
Write-Host "  That is it - you are logged in." -ForegroundColor Gray
Write-Host ""

if (-not $NonInteractive) { Read-Host "Press Enter to exit" }

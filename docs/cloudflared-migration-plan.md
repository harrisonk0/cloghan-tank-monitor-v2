# Plan: Replace ngrok with Cloudflare Tunnel (cloudflared Quick Tunnel)

## Context

The Cloghan Tank Monitor currently uses ngrok free tier to expose the local Fastify server (port 3000) to the internet so the Vercel-hosted frontend can reach it. Ngrok free has hit its monthly bandwidth cap (ERR_NGROK_725), blocking all remote access. Cloudflare Tunnel's Quick Tunnel mode is free, has no bandwidth caps, no interstitial warning pages, and requires no auth token.

## Current Architecture (ngrok)

### tray.ts
- `startNgrok()`: spawns `ngrok http 3000 --inspect=false` as child process
- Parses tunnel URL from stdout/stderr via regex: `https://[a-z0-9-]+\.ngrok(?:-free)?\.app`
- Polls `http://127.0.0.1:4040/api/tunnels` every 2 seconds as fallback URL source
- `stopNgrok()`: kills child process, clears URL
- `getNgrokUrl()`: exported getter (currently unused but available)
- `isCapturePaused()`: exported (also currently unused)

### index.ts (CORS)
- Allows origins matching `*.ngrok(-free)?\.(dev|app)$`
- Also allows `*.vercel.app` and localhost

### api.ts (frontend)
- Every fetch includes header `ngrok-skip-browser-warning: true`
- Used to bypass ngrok's browser interstitial page

### install.ps1
- Installs ngrok via winget (`Ngrok.Ngrok`)
- Configures ngrok auth token (from user input or baked into installer)
- Writes to `%LOCALAPPDATA%\ngrok\ngrok.yml` or `~/.config/ngrok/ngrok.yml`
- ~100 lines of ngrok-specific setup code

### start-tray.bat
- Runs `npx tsx apps/server/src/tray-entry.ts` — no ngrok-specific logic

## Target Architecture (cloudflared)

### tray.ts
- `startCloudflared()`: checks if `cloudflared.exe` exists in app root, downloads if missing, then spawns `cloudflared tunnel --url http://localhost:3000` as child process
- Parses tunnel URL from stderr via regex: `https://[a-z0-9-]+\.trycloudflare\.com`
- No local API to poll (ngrok had :4040 — cloudflared has none in Quick Tunnel mode)
- `stopCloudflared()`: kills child process, clears URL
- `getTunnelUrl()`: renamed from `getNgrokUrl()` for generality
- Auto-download: if `cloudflared.exe` missing, download from `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe` to app root, log progress

### index.ts (CORS)
- Replace ngrok pattern with: `*.trycloudflare.com`
- Keep `*.vercel.app` and localhost patterns
- Optionally keep ngrok pattern for backwards compatibility (harmless)

### api.ts (frontend)
- Remove `ngrok-skip-browser-warning` header from all fetch calls
- If left in, it's harmless but sends an irrelevant header to cloudflared — cleaner to remove

### install.ps1
- Remove ngrok install via winget
- Remove ngrok auth token configuration section (~80 lines deleted)
- Add cloudflared.exe download step: `Invoke-WebRequest` from GitHub releases
- Store in app root alongside other files
- Simpler than ngrok: one file, no config, no auth

### start-tray.bat
- No changes needed

## Detailed Changes

### 1. tray.ts

#### Replace `startNgrok()` with `startCloudflared()`

**Binary management:**
```typescript
const CLOUDFLARED_EXE = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "cloudflared.exe");
const CLOUDFLARED_DOWNLOAD_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

async function ensureCloudflared(): Promise<boolean> {
  if (fs.existsSync(CLOUDFLARED_EXE)) return true;
  console.log("[cloudflared] Binary not found, downloading...");
  try {
    // Use PowerShell to download (cross-platform fetch won't save to file easily in Node)
    const ps = spawnSync("powershell", [
      "-Command",
      `Invoke-WebRequest "${CLOUDFLARED_DOWNLOAD_URL}" -OutFile "${CLOUDFLARED_EXE}"`,
    ], { encoding: "utf-8", windowsHide: true, timeout: 120000 });
    if (ps.status === 0 && fs.existsSync(CLOUDFLARED_EXE)) {
      console.log("[cloudflared] Downloaded successfully");
      return true;
    }
    console.warn("[cloudflared] Download failed:", ps.stderr);
    return false;
  } catch (error) {
    console.warn("[cloudflared] Download error:", error);
    return false;
  }
}
```

**Tunnel startup:**
```typescript
let cloudflaredProcess: ChildProcess | null = null;
let tunnelUrl: string | null = null;

async function startCloudflared(): Promise<void> {
  const ok = await ensureCloudflared();
  if (!ok) {
    console.warn("[cloudflared] Cannot start without binary");
    updateTrayMenu();
    return;
  }

  try {
    cloudflaredProcess = spawn(CLOUDFLARED_EXE, ["tunnel", "--url", "http://localhost:3000"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
  } catch (error) {
    console.warn("[cloudflared] Failed to start:", error);
    tunnelUrl = null;
    updateTrayMenu();
    return;
  }

  // cloudflared prints the tunnel URL to stderr
  cloudflaredProcess.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n")) {
      if (line.trim()) console.log(`[cloudflared] ${line.trim()}`);
    }
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      tunnelUrl = match[0];
      updateTrayMenu();
      console.log(`[cloudflared] Tunnel: ${tunnelUrl}`);
    }
  });

  // Also check stdout (cloudflared may print there too)
  cloudflaredProcess.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      tunnelUrl = match[0];
      updateTrayMenu();
      console.log(`[cloudflared] Tunnel: ${tunnelUrl}`);
    }
  });

  cloudflaredProcess.on("error", (error) => {
    console.warn("[cloudflared] Process error:", error.message);
    tunnelUrl = null;
    cloudflaredProcess = null;
    updateTrayMenu();
  });

  cloudflaredProcess.on("exit", (code) => {
    console.log(`[cloudflared] Exited with code ${code}`);
    tunnelUrl = null;
    cloudflaredProcess = null;
    updateTrayMenu();
  });
}
```

**Stop function:**
```typescript
export function stopCloudflared(): void {
  if (cloudflaredProcess) {
    cloudflaredProcess.kill();
    cloudflaredProcess = null;
    tunnelUrl = null;
  }
}
```

**Update all references:**
- `stopNgrok()` → `stopCloudflared()` (called in quit handler and update restart)
- `getNgrokUrl()` → `getTunnelUrl()`
- `ngrokUrl` variable → `tunnelUrl`
- `ngrokProcess` variable → `cloudflaredProcess`
- Tray menu: "Copy Server URL" uses `tunnelUrl`
- `initTray()`: calls `startCloudflared()` instead of `startNgrok()`

**Remove ngrok-specific code:**
- `startNgrok()` function entirely
- `stopNgrok()` function
- ngrok version check (`spawnSync("ngrok", ["--version"])`)
- ngrok API polling (`setInterval` polling `localhost:4040/api/tunnels`)
- All `ngrokProcess` references

### 2. index.ts (CORS)

**Current:**
```typescript
if (/\.ngrok(-free)?\.(dev|app)$/.test(hostname)) return cb(null, true);
```

**New:**
```typescript
if (/\.trycloudflare\.com$/.test(hostname)) return cb(null, true);
if (/\.ngrok(-free)?\.(dev|app)$/.test(hostname)) return cb(null, true); // keep for backwards compat
```

Keep ngrok pattern — harmless, and if someone is still running old code it won't break.

### 3. api.ts (frontend)

Remove `ngrok-skip-browser-warning` header from all 6 locations:
- `testConnection()`
- `loginRequest()`
- `checkSession()`
- `logoutRequest()`
- `apiRequest()` main header construction

All these headers objects include `"ngrok-skip-browser-warning": "true"`. Remove the key from each.

### 4. install.ps1

**Remove (Step 3 — ngrok config, ~80 lines):**
- ngrok winget install
- `ngrok update` call
- Auth token detection from ngrok.yml
- Baked token decoding
- Interactive token prompt
- Fallback YAML writing
- All ngrok-related output messages

**Replace with (Step 3 — cloudflared download, ~15 lines):**
```powershell
Write-Host "[3/5] Setting up Cloudflare Tunnel..." -ForegroundColor Yellow

$cloudflaredPath = Join-Path $InstallDir "cloudflared.exe"
if (-not (Test-Path $cloudflaredPath)) {
    Write-Host "  Downloading cloudflared..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cloudflaredPath
        Write-Host "  cloudflared downloaded" -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: Could not download cloudflared. It will be auto-downloaded on first start." -ForegroundColor Yellow
    }
} else {
    Write-Host "  cloudflared already present" -ForegroundColor Green
}
```

**Update final instructions section:**
- Remove "Paste the link into..." magic link reference
- Already updated to say "Go to https://cloghan.vercel.app"
- Update to mention "Right-click tray icon for the URL and password"

### 5. vercel.json

No changes needed — SPA routing is independent of tunnel provider.

### 6. .env.example

No changes needed — cloudflared Quick Tunnel requires no env vars.

## Edge Cases & Risks

### 1. cloudflared URL appears on stderr, not stdout
**Risk:** cloudflared logs to stderr by default. If we only watch stdout, we'll miss the URL.
**Mitigation:** Watch both stdout and stderr for the URL pattern. Already planned.

### 2. cloudflared download fails (no internet, firewall, GitHub down)
**Risk:** Binary not available, tunnel can't start.
**Mitigation:** Log warning, show "Tunnel: not connected" in tray. Server still runs locally. User can manually download cloudflared.exe and place it in the app directory. Also, install.ps1 attempts download during install — if that fails, tray will retry on startup.

### 3. cloudflared takes time to establish tunnel
**Risk:** URL doesn't appear immediately, user sees "not connected" briefly.
**Mitigation:** Already handled — tray shows "not connected" until URL is parsed. Same behaviour as ngrok. No polling fallback needed since cloudflared has no local API in Quick Tunnel mode.

### 4. cloudflared process dies unexpectedly
**Risk:** Tunnel drops, remote access lost.
**Mitigation:** `exit` event handler clears URL and updates tray. Same as ngrok. Could add auto-restart in future but not needed for initial swap.

### 5. Existing installs have ngrok configured but not cloudflared
**Risk:** After git pull, tray tries to start cloudflared but binary doesn't exist.
**Mitigation:** `ensureCloudflared()` auto-downloads on first run. Takes ~5-10 seconds. Tray shows "not connected" during download.

### 6. cloudflared.exe is ~50MB
**Risk:** First download is slow on poor connections.
**Mitigation:** One-time cost. Binary persists in app directory across restarts. `git clean -fd` in install.ps1 won't delete it if it's gitignored (need to add `cloudflared.exe` to `.gitignore`).

### 7. URL still rotates on restart
**Risk:** Same as ngrok — Quick Tunnel gives random URL.
**Mitigation:** Accepted trade-off. User copies new URL from tray after restart. Future improvement: named tunnel with fixed domain (requires Cloudflare account + domain).

### 8. Firewall/antivirus might block cloudflared.exe
**Risk:** Windows Defender or corporate firewall flags unsigned binary.
**Mitigation:** cloudflared is signed by Cloudflare. Less likely to be flagged than ngrok. If blocked, user can add exclusion manually.

## .gitignore Addition

Add `cloudflared.exe` to `.gitignore` — the binary should not be committed to the repo.

## Files Changed Summary

| File | Change | Lines affected |
|---|---|---|
| `apps/server/src/tray.ts` | Replace ngrok with cloudflared | ~150 lines rewritten |
| `apps/server/src/index.ts` | Add trycloudflare.com to CORS | ~2 lines added |
| `apps/web/src/api.ts` | Remove ngrok-skip-browser-warning header | ~6 lines removed |
| `install.ps1` | Replace ngrok setup with cloudflared download | ~80 lines removed, ~15 added |
| `.gitignore` | Add cloudflared.exe | 1 line added |

## Verification

After implementation:
1. TypeScript compiles clean (both server and web)
2. No remaining references to `ngrok` in source code (except CORS backwards-compat pattern)
3. `cloudflared.exe` in .gitignore
4. Tray menu structure unchanged — still shows Server status, Tunnel URL, passwords, Copy URL, Pause, View Logs, Check Updates, Quit
5. install.ps1 has no ngrok references

## What Does NOT Change

- Auth system (passwords, sessions) — untouched
- Frontend login screen — untouched
- Database schema — untouched
- Refresh pipeline — untouched
- Scheduler — untouched
- Updater — untouched (git pull + restart still works)
- start-tray.bat — untouched
- vercel.json — untouched

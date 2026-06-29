import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import Tray from "trayicon";
import { config } from "./config.js";
import { startServer, getServerStatus, stopServer } from "./index.js";
import { paths } from "./config.js";
import { checkForUpdates, pullUpdates, applyUpdateAndRestart } from "./updater.js";

// ─── State ───────────────────────────────────────────────────────────────────

let tray: Awaited<ReturnType<typeof Tray.create>> | null = null;
let cloudflaredProcess: ChildProcess | null = null;
let tunnelUrl: string | null = null;
let capturePaused = false;

const ICON_PATH = path.resolve(import.meta.dirname ?? ".", "tray-icon.png");
const CLOUDFLARED_EXE = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "cloudflared.exe");
const CLOUDFLARED_DOWNLOAD_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

// ─── Cloudflared binary management ───────────────────────────────────────────

async function ensureCloudflared(): Promise<boolean> {
  if (fs.existsSync(CLOUDFLARED_EXE)) return true;
  console.log("[cloudflared] Binary not found, downloading...");
  try {
    const response = await fetch(CLOUDFLARED_DOWNLOAD_URL);
    if (!response.ok || !response.body) {
      console.warn(`[cloudflared] Download failed: HTTP ${response.status}`);
      return false;
    }
    const fileStream = fs.createWriteStream(CLOUDFLARED_EXE);
    const stream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
    await new Promise<void>((resolve, reject) => {
      stream.pipe(fileStream);
      stream.on("error", reject);
      fileStream.on("finish", () => resolve());
      fileStream.on("error", reject);
    });
    console.log("[cloudflared] Downloaded successfully");
    return true;
  } catch (error) {
    console.warn("[cloudflared] Download error:", error instanceof Error ? error.message : error);
    // Clean up partial file if exists
    try { fs.unlinkSync(CLOUDFLARED_EXE); } catch { /* ignore */ }
    return false;
  }
}

// ─── Cloudflared tunnel ──────────────────────────────────────────────────────

async function startCloudflared(): Promise<void> {
  const ok = await ensureCloudflared();
  if (!ok) {
    console.warn("[cloudflared] Cannot start without binary — tray will show 'not connected'");
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
    console.warn("[cloudflared] Failed to start:", error instanceof Error ? error.message : error);
    tunnelUrl = null;
    updateTrayMenu();
    return;
  }

  cloudflaredProcess.on("error", (error) => {
    console.warn("[cloudflared] Process error:", error.message);
    tunnelUrl = null;
    cloudflaredProcess = null;
    updateTrayMenu();
  });

  // cloudflared prints the tunnel URL to stderr
  cloudflaredProcess.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n")) {
      if (line.trim()) console.log(`[cloudflared] ${line.trim()}`);
    }
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      tunnelUrl = match[0];
      updateTrayMenu();
      console.log(`[cloudflared] Tunnel: ${tunnelUrl}`);
    }
  });

  // Also check stdout
  cloudflaredProcess.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n")) {
      if (line.trim()) console.log(`[cloudflared] ${line.trim()}`);
    }
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      tunnelUrl = match[0];
      updateTrayMenu();
      console.log(`[cloudflared] Tunnel: ${tunnelUrl}`);
    }
  });

  cloudflaredProcess.on("exit", (code) => {
    console.log(`[cloudflared] Exited with code ${code}`);
    tunnelUrl = null;
    cloudflaredProcess = null;
    updateTrayMenu();
  });
}

export function stopCloudflared(): void {
  if (cloudflaredProcess) {
    cloudflaredProcess.kill();
    cloudflaredProcess = null;
    tunnelUrl = null;
  }
}

// ─── Clipboard helper ────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  try {
    const ps = spawn("powershell", ["-command", "Set-Clipboard -Value $input"], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    ps.stdin.write(text);
    ps.stdin.end();
  } catch {
    // best-effort
  }
}

// ─── Tray ────────────────────────────────────────────────────────────────────

function updateTrayMenu(): void {
  if (!tray) return;

  const status = getServerStatus();
  const serverStatus = status.running ? `running on :${status.port}` : "stopped";
  const tunnelStatus = tunnelUrl ?? "not connected";

  // Copy tunnel URL
  const copyUrl = tray.item("Copy Server URL", {
    disabled: !tunnelUrl,
    action: () => {
      if (!tunnelUrl) return;
      copyToClipboard(tunnelUrl);
      tray?.notify("URL Copied", tunnelUrl);
    },
  });

  // Show login passwords
  const showReadwrite = tray.item(`Read-Write Password: ${config.authReadwritePassword}`, {
    action: () => {
      copyToClipboard(config.authReadwritePassword);
      tray?.notify("Password Copied", "Read-write password copied to clipboard.");
    },
  });

  const showReadonly = tray.item(`Read-Only Password: ${config.authReadonlyPassword}`, {
    action: () => {
      copyToClipboard(config.authReadonlyPassword);
      tray?.notify("Password Copied", "Read-only password copied to clipboard.");
    },
  });

  // Pause/resume
  const pauseItem = tray.item(capturePaused ? "Resume Capture" : "Pause Capture", {
    action: () => {
      capturePaused = !capturePaused;
      updateTrayMenu();
    },
  });

  // View logs
  const viewLogs = tray.item("View Logs", {
    action: () => {
      if (!fs.existsSync(paths.logFile)) {
        try {
          fs.mkdirSync(paths.logsDir, { recursive: true });
          fs.writeFileSync(paths.logFile, "", { flag: "a" });
        } catch {
          tray?.notify("No Logs", "Could not create log file.");
          return;
        }
      }
      try {
        const ps = spawn("powershell.exe", ["-NoExit", "-Command", `Get-Content (Get-Item -LiteralPath '${paths.logFile.replace(/'/g, "''")}') -Wait -Tail 50`], {
          windowsHide: false,
          stdio: "ignore",
        });
        ps.unref();
      } catch (error) {
        tray?.notify("Error", `Failed to open logs: ${error instanceof Error ? error.message : error}`);
      }
    },
  });

  // Check for updates
  const checkUpdates = tray.item("Check for Updates", {
    action: async () => {
      tray?.notify("Checking for updates...", "Fetching from remote...");
      const result = await checkForUpdates();
      if (!result.available) {
        tray?.notify("No Updates", result.message);
        return;
      }
      tray?.notify("Update Available", result.message + "\n\nPulling updates...");
      const pull = await pullUpdates();
      if (!pull.success) {
        tray?.notify("Update Failed", pull.message);
        return;
      }
      tray?.notify("Restarting", "Updates applied. Restarting...");
      applyUpdateAndRestart(async () => {
        stopCloudflared();
        await stopServer();
      });
    },
  });

  // Quit
  const quit = tray.item("Quit", {
    action: () => {
      stopCloudflared();
      stopServer();
      tray?.kill();
      process.exit(0);
    },
  });

  // Build the menu
  tray.setMenu(
    tray.item(`Server: ${serverStatus}`, { disabled: true }),
    tray.item(`Tunnel: ${tunnelStatus}`, { disabled: true }),
    tray.separator(),
    showReadwrite,
    showReadonly,
    tray.separator(),
    copyUrl,
    tray.separator(),
    pauseItem,
    viewLogs,
    checkUpdates,
    quit,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(true))
      .once("listening", () => { tester.close(() => resolve(false)); })
      .listen(port, "127.0.0.1");
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function initTray(): Promise<void> {
  const port = getServerStatus().port;
  const portTaken = await isPortInUse(port);

  if (portTaken) {
    const iconBuffer = (() => { try { return fs.readFileSync(ICON_PATH); } catch { return undefined; } })();
    const tmp = await Tray.create({ icon: iconBuffer, title: "CTM" });
    tmp?.notify("Cloghan Tank Monitor", "Server is already running. Check the system tray.");
    tmp?.kill();
    process.exit(0);
  }

  startServer();

  // Create tray
  let iconBuffer: Buffer | undefined;
  try {
    iconBuffer = fs.readFileSync(ICON_PATH);
  } catch {
    // Use default icon
  }

  tray = await Tray.create({
    icon: iconBuffer,
    title: "CTM",
  });

  updateTrayMenu();

  // Start cloudflared (async — won't block tray UI)
  void startCloudflared();

  tray?.notify("Cloghan Tank Monitor", "Server started");
  console.log("[tray] System tray initialized");
}

export function isCapturePaused(): boolean {
  return capturePaused;
}

export function getTunnelUrl(): string | null {
  return tunnelUrl;
}

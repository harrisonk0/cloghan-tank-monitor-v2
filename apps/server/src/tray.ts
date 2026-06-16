import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import Tray from "trayicon";
import { generateApiKey, listApiKeys, revokeApiKey } from "./db.js";
import { startServer, getServerStatus } from "./index.js";

// ─── State ───────────────────────────────────────────────────────────────────

let tray: Awaited<ReturnType<typeof Tray.create>> | null = null;
let ngrokProcess: ChildProcess | null = null;
let ngrokUrl: string | null = null;
let capturePaused = false;

const ICON_PATH = path.resolve(import.meta.dirname ?? ".", "tray-icon.png");

// ─── Ngrok ───────────────────────────────────────────────────────────────────

function startNgrok(): void {
  // Check ngrok version first
  try {
    const versionCheck = spawnSync("ngrok", ["--version"], { encoding: "utf-8", windowsHide: true });
    if (versionCheck.stdout) {
      const versionLine = versionCheck.stdout.trim().split("\n")[0];
      console.log("[ngrok] " + versionLine);
    }
  } catch {
    // Ignore version check errors
  }

  try {
    ngrokProcess = spawn("ngrok", ["http", "3000", "--inspect=false"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
  } catch (error) {
    console.warn("[ngrok] Failed to start:", error instanceof Error ? error.message : error);
    ngrokUrl = null;
    updateTrayMenu();
    return;
  }

  ngrokProcess.on("error", (error) => {
    console.warn("[ngrok] Process error:", error.message);
    ngrokUrl = null;
    ngrokProcess = null;
    updateTrayMenu();
  });

  ngrokProcess.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    // Look for the tunnel URL in ngrok output
    const match = text.match(/https:\/\/[a-z0-9-]+\.ngrok(?:-free)?\.app/);
    if (match) {
      ngrokUrl = match[0];
      updateTrayMenu();
      console.log(`[ngrok] Tunnel: ${ngrokUrl}`);
    }
  });

  ngrokProcess.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    // Log stderr output for debugging (ngrok sends errors here)
    if (text) {
      for (const line of text.split("\n")) {
        if (line.trim()) console.log(`[ngrok:err] ${line.trim()}`);
      }
    }
    // Also check for URL in stderr (ngrok sometimes logs there)
    const match = text.match(/https:\/\/[a-z0-9-]+\.ngrok(?:-free)?\.app/);
    if (match) {
      ngrokUrl = match[0];
      updateTrayMenu();
      console.log(`[ngrok] Tunnel: ${ngrokUrl}`);
    }
  });

  ngrokProcess.on("exit", (code) => {
    console.log(`[ngrok] Exited with code ${code}`);
    ngrokUrl = null;
    ngrokProcess = null;
    updateTrayMenu();
  });

  // Also poll the local API as a fallback
  const pollInterval = setInterval(async () => {
    if (!ngrokProcess) {
      clearInterval(pollInterval);
      return;
    }
    try {
      const res = await fetch("http://127.0.0.1:4040/api/tunnels");
      const data = (await res.json()) as { tunnels?: { public_url?: string }[] };
      const url = data.tunnels?.[0]?.public_url;
      if (url && url !== ngrokUrl) {
        ngrokUrl = url;
        updateTrayMenu();
        console.log(`[ngrok] Tunnel (via API): ${ngrokUrl}`);
      }
    } catch {
      // ngrok API not ready yet
    }
  }, 2000);
}

function stopNgrok(): void {
  if (ngrokProcess) {
    ngrokProcess.kill();
    ngrokProcess = null;
    ngrokUrl = null;
  }
}

// ─── Tray ────────────────────────────────────────────────────────────────────

function updateTrayMenu(): void {
  if (!tray) return;

  const status = getServerStatus();
  const serverStatus = status.running ? `running on :${status.port}` : "stopped";
  const tunnelStatus = ngrokUrl ?? "not connected";

  // Magic link generation
  const FRONTEND_URL = "https://cloghan-tm.vercel.app";

  function copyMagicLink(permissions: "readonly" | "readwrite") {
    if (!ngrokUrl) {
      tray?.notify("No Tunnel", "Tunnel is not connected yet.");
      return;
    }
    const key = generateApiKey(`magic-${permissions}`, permissions);
    const token = Buffer.from(JSON.stringify({ s: ngrokUrl, k: key })).toString("base64url");
    const magicLink = `${FRONTEND_URL}?token=${token}`;
    const ps = spawn("powershell", ["-command", "Set-Clipboard -Value $input"], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    ps.stdin.write(magicLink);
    ps.stdin.end();
    tray?.notify("Magic Link Copied", `Open this link in a browser to log in automatically.\n\n${magicLink}`);
  }

  const copyMagicReadOnly = tray.item("Copy Magic Link (Read-Only)", {
    disabled: !ngrokUrl,
    action: () => copyMagicLink("readonly"),
  });

  const copyMagicReadWrite = tray.item("Copy Magic Link (Read/Write)", {
    disabled: !ngrokUrl,
    action: () => copyMagicLink("readwrite"),
  });

  // View keys submenu
  const keys = listApiKeys();
  const viewKeysItems = keys.length
    ? keys.map((k) => {
        const item = tray!.item(`${k.label ?? "unnamed"} (${k.permissions}) - ${k.created_at}`);
        const revoke = tray!.item("Revoke", {
          action: () => {
            revokeApiKey(k.id);
            tray?.notify("Key Revoked", `Key "${k.label ?? "unnamed"}" has been revoked.`);
            updateTrayMenu();
          },
        });
        item.add(revoke);
        return item;
      })
    : [tray.item("(no active keys)", { disabled: true })];

  const viewKeys = tray.item("View Active API Keys");
  viewKeys.add(...viewKeysItems);

  // Pause/resume
  const pauseItem = tray.item(capturePaused ? "Resume Capture" : "Pause Capture", {
    action: () => {
      capturePaused = !capturePaused;
      updateTrayMenu();
    },
  });

  // View logs
  const logFile = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "runtime", "logs", "server.log");
  const viewLogs = tray.item("View Logs", {
    action: () => {
      if (!fs.existsSync(logFile)) {
        tray?.notify("No Logs", "No log file found yet.");
        return;
      }
      const ps = spawn("powershell.exe", ["-NoExit", "-Command", `Get-Content '${logFile}' -Wait -Tail 50`], {
        windowsHide: false,
        detached: true,
        stdio: "ignore",
      });
      ps.unref();
    },
  });

  // Quit
  const quit = tray.item("Quit", {
    action: () => {
      stopNgrok();
      tray?.kill();
      process.exit(0);
    },
  });

  // Build the menu
  tray.setMenu(
    tray.item(`Server: ${serverStatus}`, { disabled: true }),
    tray.item(`Tunnel: ${tunnelStatus}`, { disabled: true }),
    tray.separator(),
    copyMagicReadWrite,
    copyMagicReadOnly,
    viewKeys,
    tray.separator(),
    pauseItem,
    viewLogs,
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

  // Start ngrok
  startNgrok();

  tray?.notify("Cloghan Tank Monitor", "Server started");
  console.log("[tray] System tray initialized");
}

export function isCapturePaused(): boolean {
  return capturePaused;
}

export function getNgrokUrl(): string | null {
  return ngrokUrl;
}

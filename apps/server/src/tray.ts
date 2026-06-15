import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
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

  // Key generation items
  const genReadOnly = tray.item("Generate Read-Only API Key", {
    action: () => {
      const key = generateApiKey("read-only", "readonly");
      tray?.notify("API Key Created", `Read-only key copied to clipboard.\n\n${key}`);
      // Copy to clipboard via PowerShell
      spawn("powershell", ["-command", `Set-Clipboard -Value '${key}'`], { windowsHide: true });
    },
  });

  const genReadWrite = tray.item("Generate Read/Write API Key", {
    action: () => {
      const key = generateApiKey("read-write", "readwrite");
      tray?.notify("API Key Created", `Read/write key copied to clipboard.\n\n${key}`);
      spawn("powershell", ["-command", `Set-Clipboard -Value '${key}'`], { windowsHide: true });
    },
  });

  // View keys submenu
  const keys = listApiKeys();
  const viewKeysItems = keys.length
    ? keys.map((k) =>
        tray!.item(`${k.label ?? "unnamed"} (${k.permissions}) - ${k.created_at}`, {
          disabled: true,
        }),
      )
    : [tray.item("(no active keys)", { disabled: true })];

  const viewKeys = tray.item("View Active API Keys");
  viewKeys.add(...viewKeysItems);

  // Separator
  const sep1 = tray.separator();

  // Copy tunnel URL
  const copyUrl = tray.item("Copy Tunnel URL", {
    disabled: !ngrokUrl,
    action: () => {
      if (ngrokUrl) {
        spawn("powershell", ["-command", `Set-Clipboard -Value '${ngrokUrl}'`], { windowsHide: true });
        tray?.notify("Copied", "Tunnel URL copied to clipboard.");
      }
    },
  });

  const sep2 = tray.separator();

  // Pause/resume
  const pauseItem = tray.item(capturePaused ? "Resume Capture" : "Pause Capture", {
    action: () => {
      capturePaused = !capturePaused;
      updateTrayMenu();
    },
  });

  const sep3 = tray.separator();

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
    sep1,
    genReadOnly,
    genReadWrite,
    viewKeys,
    sep2,
    copyUrl,
    sep3,
    pauseItem,
    sep4(quit),
  );
}

// Helper since setMenu needs variadic args
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sep4(quit: any): any {
  return quit;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function initTray(): Promise<void> {
  // Start the server first
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

  console.log("[tray] System tray initialized");
}

export function isCapturePaused(): boolean {
  return capturePaused;
}

export function getNgrokUrl(): string | null {
  return ngrokUrl;
}

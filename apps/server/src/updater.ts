import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

let gitAvailable: boolean | null = null;
let checkingForUpdates = false;

function isGitAvailable(): boolean {
  if (gitAvailable !== null) return gitAvailable;
  try {
    const result = spawnSync("git", ["--version"], { encoding: "utf-8", windowsHide: true });
    gitAvailable = result.status === 0;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

function gitCwd(): string {
  return path.resolve(import.meta.dirname ?? ".", "..", "..", "..");
}

function readSpawn(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, windowsHide: true });
    let stdout = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: stdout.trim() });
    });
    proc.on("error", () => {
      resolve({ code: 1, stdout: "" });
    });
  });
}

export function checkForUpdates(): Promise<{ available: boolean; current: string; latest: string; message: string }> {
  return new Promise((resolve) => {
    if (!isGitAvailable()) {
      resolve({ available: false, current: "", latest: "", message: "Git is not installed or not in PATH." });
      return;
    }
    if (checkingForUpdates) {
      resolve({ available: false, current: "", latest: "", message: "Update check already in progress." });
      return;
    }
    checkingForUpdates = true;

    const cwd = gitCwd();

    const fetchProc = spawn("git", ["fetch", "origin"], { cwd, windowsHide: true });
    fetchProc.on("close", async (fetchCode) => {
      if (fetchCode !== 0) {
        checkingForUpdates = false;
        resolve({ available: false, current: "", latest: "", message: "git fetch failed." });
        return;
      }

      const current = await readSpawn("git", ["rev-parse", "HEAD"], cwd);
      const latest = await readSpawn("git", ["rev-parse", "origin/main"], cwd);

      checkingForUpdates = false;
      if (!current.stdout || !latest.stdout) {
        resolve({ available: false, current: "", latest: "", message: "Could not determine versions." });
      } else if (current.stdout === latest.stdout) {
        resolve({ available: false, current: current.stdout.slice(0, 7), latest: latest.stdout.slice(0, 7), message: "Up to date." });
      } else {
        resolve({ available: true, current: current.stdout.slice(0, 7), latest: latest.stdout.slice(0, 7), message: `Update available: ${current.stdout.slice(0, 7)} → ${latest.stdout.slice(0, 7)}` });
      }
    });
  });
}

export function pullUpdates(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    if (!isGitAvailable()) {
      resolve({ success: false, message: "Git is not installed." });
      return;
    }

    const cwd = gitCwd();

    // Stash only if there are local changes
    const stashProc = spawn("git", ["stash"], { cwd, windowsHide: true });
    let stashOut = "";
    stashProc.stdout?.on("data", (d: Buffer) => { stashOut += d.toString(); });
    stashProc.on("close", (stashCode) => {
      const hasChanges = stashCode === 0 && !stashOut.includes("No local changes to save");

      const pullProc = spawn("git", ["pull", "--ff-only", "origin"], { cwd, windowsHide: true });
      pullProc.on("close", (pullCode) => {
        if (pullCode !== 0) {
          if (hasChanges) {
            const popFail = spawn("git", ["stash", "pop"], { cwd, windowsHide: true });
            popFail.on("close", () => {
              resolve({ success: false, message: "git pull failed. Local changes may conflict." });
            });
          } else {
            resolve({ success: false, message: "git pull failed. Local changes may conflict." });
          }
          return;
        }

        if (hasChanges) {
          const popProc = spawn("git", ["stash", "pop"], { cwd, windowsHide: true });
          popProc.on("close", () => {
            resolve({ success: true, message: "Update pulled successfully." });
          });
        } else {
          resolve({ success: true, message: "Update pulled successfully." });
        }
      });
    });
  });
}

export function applyUpdateAndRestart(shutdown: () => Promise<void>): void {
  const cwd = gitCwd();
  const batPath = path.join(cwd, "start-tray.bat");

  shutdown().then(async () => {
    spawn("cmd.exe", ["/c", "start", "/b", "cmd.exe", "/c", batPath], {
      cwd,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    }).unref();
    await new Promise((r) => setTimeout(r, 1000));
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

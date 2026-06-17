import { getSettings } from "./db.js";
import { runRefresh } from "./refresh.js";

type ScheduleMode = "manual" | "10m" | "30m" | "1h" | "onTheHour" | "custom";

let timer: NodeJS.Timeout | null = null;
let running = false;
let nextRunAt: string | null = null;
let lastSchedulerStatus = "Manual refresh only.";

export function configureScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const settings = getSettings();
  const mode = normalizeScheduleMode(settings.scheduleMode ?? settings.refreshSchedule);

  if (mode === "manual") {
    nextRunAt = null;
    lastSchedulerStatus = "Manual refresh only.";
    return;
  }

  const delayMs = mode === "onTheHour"
    ? msToNextHour()
    : getScheduleIntervalMs(mode, settings);

  const nextTime = Date.now() + delayMs;
  nextRunAt = new Date(nextTime).toISOString();
  lastSchedulerStatus = `Next scheduled refresh at ${nextRunAt}.`;
  timer = setTimeout(() => {
    void runScheduledRefresh();
  }, delayMs);
}

export function getSchedulerStatus(): { nextRunAt: string | null; running: boolean; message: string } {
  return {
    nextRunAt,
    running,
    message: lastSchedulerStatus,
  };
}

async function runScheduledRefresh(): Promise<void> {
  if (running) {
    lastSchedulerStatus = "Previous scheduled refresh is still running.";
    configureScheduler();
    return;
  }

  running = true;
  lastSchedulerStatus = "Scheduled refresh running.";
  try {
    await runRefresh();
    lastSchedulerStatus = "Scheduled refresh completed.";
  } catch (error) {
    lastSchedulerStatus = error instanceof Error ? error.message : "Scheduled refresh failed.";
  } finally {
    running = false;
    configureScheduler();
  }
}

function getScheduleIntervalMs(mode: ScheduleMode, settings: ReturnType<typeof getSettings>): number {
  if (mode === "10m") return 10 * 60 * 1000;
  if (mode === "30m") return 30 * 60 * 1000;
  if (mode === "1h") return 60 * 60 * 1000;

  const minutes = Number(settings.customIntervalMinutes);
  if (!Number.isFinite(minutes) || minutes < 1) return 60 * 60 * 1000;
  return Math.round(minutes) * 60 * 1000;
}

function msToNextHour(): number {
  const now = Date.now();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  if (next.getTime() <= now) next.setHours(next.getHours() + 1);
  return next.getTime() - now;
}

function normalizeScheduleMode(value: string | undefined): ScheduleMode {
  if (value === "10m" || value === "30m" || value === "1h" || value === "onTheHour" || value === "custom") return value;
  return "manual";
}

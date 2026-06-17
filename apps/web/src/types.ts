export const TANKS = ["C1", "C2", "C3", "C4"] as const;
export const MAX_LEVEL = 22000;

export let nextToastId = 0;
export function incrementToastId() { return ++nextToastId; }

export const cachedNumberFmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 });
export const cachedDateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
export const cachedShortDateFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export type Page = "dashboard" | "readings" | "settings" | "history";
export type RefreshStatus = "idle" | "running" | "success" | "warning" | "failed" | "needs_review";
export type ToastKind = "success" | "warning" | "error" | "info";
export type Permissions = "readonly" | "readwrite";

export type TankName = (typeof TANKS)[number];

export type TankReading = {
  id?: number;
  tank: TankName | string;
  levelMm: number | null;
  temperatureC: number | null;
  tovM3: number | null;
  gsvM3: number | null;
};

export type Reading = {
  id?: number;
  capturedAt: string;
  source: string;
  confidence: number | null;
  totalLevelMm: number | null;
  totalLevelDiffMm: number | null;
  totalGsvM3: number | null;
  totalGsvDiffM3: number | null;
  verified: boolean;
  notes?: string | null;
  tanks: TankReading[];
};

export type RefreshRun = {
  id?: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  errorCode: string | null;
  message: string | null;
  confidence: number | null;
  durationMs: number | null;
  readingId: number | null;
};

export type Settings = {
  scheduleMode: "manual" | "10m" | "30m" | "1h" | "onTheHour" | "custom";
  customIntervalMinutes: number;
  notifySuccess: boolean;
  notifyWarning: boolean;
  notifyFailure: boolean;
  screenshotRetentionHours: number | null;
  aiConfigured: boolean;
  aiBaseUrl?: string;
  aiModel?: string;
  scheduler?: {
    nextRunAt: string | null;
    running: boolean;
    message: string;
  };
};

export type RefreshResult = {
  status: RefreshStatus;
  errorCode?: string | null;
  message?: string;
  confidence?: number | null;
  readingId?: number | null;
  reading?: Partial<Reading>;
  refreshRunId?: number;
  reviewId?: string;
};

export type Toast = { id: number; kind: ToastKind; message: string };

export type RawReading = Partial<Reading> & {
  captured_at?: unknown;
  total_level_mm?: unknown;
  total_level_diff_mm?: unknown;
  total_gsv_m3?: unknown;
  total_gsv_diff_m3?: unknown;
};

export type RawTank = Partial<TankReading> & {
  level_mm?: unknown;
  temperature_c?: unknown;
  tov_m3?: unknown;
  gsv_m3?: unknown;
};

export type RawRun = Partial<RefreshRun> & {
  started_at?: unknown;
  finished_at?: unknown;
  error_code?: unknown;
  duration_ms?: unknown;
  reading_id?: unknown;
};

export const defaultSettings: Settings = {
  scheduleMode: "manual",
  customIntervalMinutes: 15,
  notifySuccess: true,
  notifyWarning: true,
  notifyFailure: true,
  screenshotRetentionHours: 3,
  aiConfigured: false,
};

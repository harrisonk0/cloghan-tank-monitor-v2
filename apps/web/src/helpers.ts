import { TANKS, cachedNumberFmt, cachedDateFmt, cachedShortDateFmt, defaultSettings } from "./types.js";
import type { TankName, TankReading, Reading, RefreshRun, Settings, RawReading, RawTank, RawRun } from "./types.js";

export const emptyTank = (tank: TankName): TankReading => ({
  tank,
  levelMm: null,
  temperatureC: null,
  tovM3: null,
  gsvM3: null,
});

export const emptyReading = (): Reading => ({
  capturedAt: new Date().toISOString(),
  source: "manual",
  confidence: null,
  totalLevelMm: null,
  totalLevelDiffMm: null,
  totalGsvM3: null,
  totalGsvDiffM3: null,
  verified: true,
  notes: "",
  tanks: TANKS.map(emptyTank),
});

export function nullableNumber(v: unknown): number | null {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function numberOrUndefined(v: unknown): number | undefined {
  const n = nullableNumber(v);
  return n === null ? undefined : n;
}

export function toBool(v: unknown, fb: boolean): boolean {
  if (v === undefined || v === null) return fb;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  return ["true", "1", "yes"].includes(String(v).toLowerCase());
}

export function stringOrUndefined(v: unknown) {
  return typeof v === "string" && v.trim() ? v : undefined;
}

export function formatNumber(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined) return "\u2014";
  return `${cachedNumberFmt.format(value)}${suffix}`;
}

export function formatConfidence(value: number | null | undefined) {
  if (value === null || value === undefined) return "\u2014";
  return `${Math.round(value * 100)}%`;
}

export function formatDate(value: string) {
  return cachedDateFmt.format(new Date(value));
}

export function formatShortDate(value: string) {
  return cachedShortDateFmt.format(new Date(value));
}

export function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined) return "\u2014";
  return `${(Math.round(value) / 1000).toFixed(1)}s`;
}

export function toDateTimeLocal(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function labelStatus(status: string) {
  return status === "idle" ? "Ready" : status.replace(/_/g, " ");
}

export function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

export function asReadings(data: unknown): Reading[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { readings?: unknown[] })?.readings) ? (data as { readings: unknown[] }).readings : [];
  return list.map((item) => normalizeReading(item as RawReading)).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

export function asRuns(data: unknown): RefreshRun[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { refreshRuns?: unknown[]; runs?: unknown[] })?.refreshRuns) ? (data as { refreshRuns: unknown[] }).refreshRuns : Array.isArray((data as { runs?: unknown[] })?.runs) ? (data as { runs: unknown[] }).runs : [];
  return list.map((item) => normalizeRun(item as RawRun)).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function asSettings(data: unknown): Settings {
  const src = ((data as { settings?: unknown })?.settings || data || {}) as Record<string, unknown>;
  return {
    ...defaultSettings,
    scheduleMode: String(src.scheduleMode || src.refreshSchedule || defaultSettings.scheduleMode) as Settings["scheduleMode"],
    customIntervalMinutes: Number(src.customIntervalMinutes || defaultSettings.customIntervalMinutes),
    notifySuccess: toBool(src.notifySuccess, true),
    notifyWarning: toBool(src.notifyWarning, true),
    notifyFailure: toBool(src.notifyFailure, true),
    screenshotRetentionHours: src.screenshotRetentionHours == null ? defaultSettings.screenshotRetentionHours : Number(src.screenshotRetentionHours),
    aiConfigured: toBool(src.aiConfigured || src.ai_configured, false),
    aiBaseUrl: stringOrUndefined(src.aiBaseUrl),
    aiModel: stringOrUndefined(src.aiModel),
  };
}

export function normalizeReading(raw: RawReading): Reading {
  const tanks = Array.isArray(raw.tanks) ? raw.tanks : [];
  return {
    id: numberOrUndefined(raw.id),
    capturedAt: String(raw.capturedAt || raw.captured_at || new Date().toISOString()),
    source: String(raw.source || "ai"),
    confidence: nullableNumber(raw.confidence),
    totalLevelMm: nullableNumber(raw.totalLevelMm ?? raw.total_level_mm),
    totalLevelDiffMm: nullableNumber(raw.totalLevelDiffMm ?? raw.total_level_diff_mm),
    totalGsvM3: nullableNumber(raw.totalGsvM3 ?? raw.total_gsv_m3),
    totalGsvDiffM3: nullableNumber(raw.totalGsvDiffM3 ?? raw.total_gsv_diff_m3),
    verified: toBool(raw.verified, false),
    notes: stringOrUndefined(raw.notes) || "",
    tanks: TANKS.map((tank) => normalizeTank(tanks.find((item) => (item as TankReading).tank === tank) as RawTank | undefined, tank)),
  };
}

export function normalizeTank(raw: RawTank | undefined, tank: TankName): TankReading {
  return {
    id: numberOrUndefined(raw?.id),
    tank,
    levelMm: nullableNumber(raw?.levelMm ?? raw?.level_mm),
    temperatureC: nullableNumber(raw?.temperatureC ?? raw?.temperature_c),
    tovM3: nullableNumber(raw?.tovM3 ?? raw?.tov_m3),
    gsvM3: nullableNumber(raw?.gsvM3 ?? raw?.gsv_m3),
  };
}

export function normalizeRun(raw: RawRun): RefreshRun {
  return {
    id: numberOrUndefined(raw.id),
    startedAt: String(raw.startedAt || raw.started_at || new Date().toISOString()),
    finishedAt: raw.finishedAt || raw.finished_at ? String(raw.finishedAt || raw.finished_at) : null,
    status: String(raw.status || "unknown"),
    errorCode: stringOrUndefined(raw.errorCode ?? raw.error_code) || null,
    message: stringOrUndefined(raw.message) || null,
    confidence: nullableNumber(raw.confidence),
    durationMs: nullableNumber(raw.durationMs ?? raw.duration_ms),
    readingId: nullableNumber(raw.readingId ?? raw.reading_id),
  };
}

export function readingToPayload(reading: Reading) {
  return { ...reading, tanks: reading.tanks.map(({ tank, levelMm, temperatureC, tovM3, gsvM3 }) => ({ tank, levelMm, temperatureC, tovM3, gsvM3 })) };
}

export function settingsToPayload(s: Settings) {
  return { scheduleMode: s.scheduleMode, customIntervalMinutes: s.customIntervalMinutes, notifySuccess: s.notifySuccess, notifyWarning: s.notifyWarning, notifyFailure: s.notifyFailure };
}

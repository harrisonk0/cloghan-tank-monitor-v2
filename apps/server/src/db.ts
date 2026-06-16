import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import { paths } from "./config.js";
import type { ApiKey, ApiKeyPermissions, ReadingInput, TankName, TankReadingInput } from "./types.js";
import { localIsoNow } from "./util.js";

export type DbReadingRow = {
  id: number;
  captured_at: string;
  source: string;
  confidence: number | null;
  total_level_mm: number | null;
  total_level_diff_mm: number | null;
  total_gsv_m3: number | null;
  total_gsv_diff_m3: number | null;
  verified: 0 | 1;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type TankRow = {
  id: number;
  reading_id: number;
  tank: TankName;
  level_mm: number | null;
  temperature_c: number | null;
  tov_m3: number | null;
  gsv_m3: number | null;
};

export const db = openDatabase();

function openDatabase(): Database.Database {
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const database = new Database(paths.database);
  database.pragma("foreign_keys = ON");
  migrate(database);
  seedSettings(database);
  return database;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'ai',
      confidence REAL,
      total_level_mm INTEGER,
      total_level_diff_mm INTEGER,
      total_gsv_m3 REAL,
      total_gsv_diff_m3 REAL,
      verified INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tank_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reading_id INTEGER NOT NULL,
      tank TEXT NOT NULL,
      level_mm INTEGER,
      temperature_c REAL,
      tov_m3 REAL,
      gsv_m3 REAL,
      FOREIGN KEY (reading_id) REFERENCES readings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS refresh_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      error_code TEXT,
      message TEXT,
      confidence REAL,
      reading_id INTEGER,
      screenshot_paths TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reading_id) REFERENCES readings(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_readings_captured_at ON readings(captured_at);
    CREATE INDEX IF NOT EXISTS idx_tank_readings_reading_id ON tank_readings(reading_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_runs_started_at ON refresh_runs(started_at);

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT,
      permissions TEXT NOT NULL CHECK(permissions IN ('readonly', 'readwrite')),
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
  `);
}

function seedSettings(database: Database.Database): void {
  const insert = database.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  insert.run("refreshSchedule", "manual");
  insert.run("customIntervalMinutes", "60");
  insert.run("notifyOnSuccess", "true");
  insert.run("notifyOnWarning", "true");
  insert.run("notifyOnFailure", "true");
}

export function listReadings(limit = 200): unknown[] {
  const rows = db
    .prepare("SELECT * FROM readings ORDER BY captured_at DESC, id DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 1000)) as DbReadingRow[];
  return rows.map(hydrateReading);
}

export function getReading(id: number): unknown | null {
  const row = db.prepare("SELECT * FROM readings WHERE id = ?").get(id) as DbReadingRow | undefined;
  return row ? hydrateReading(row) : null;
}

export function insertReading(input: ReadingInput): number {
  validateReadingInput(input);
  const totals = calculateTotals(input.tanks);

  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO readings
          (captured_at, source, confidence, total_level_mm, total_level_diff_mm, total_gsv_m3, total_gsv_diff_m3, verified, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.capturedAt,
        input.source ?? "manual",
        input.confidence ?? null,
        totals.totalLevelMm,
        null,
        totals.totalGsvM3,
        null,
        input.verified ? 1 : 0,
        input.notes ?? null,
      );
    const readingId = Number(result.lastInsertRowid);
    insertTankRows(readingId, input.tanks);
    recomputeReadingDiffs(readingId);
    return readingId;
  });
  return transaction();
}

export function updateReading(id: number, input: ReadingInput): boolean {
  validateReadingInput(input);
  const totals = calculateTotals(input.tanks);
  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE readings SET
          captured_at = ?, source = ?, confidence = ?, total_level_mm = ?, total_gsv_m3 = ?, verified = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(input.capturedAt, input.source ?? "manual", input.confidence ?? null, totals.totalLevelMm, totals.totalGsvM3, input.verified ? 1 : 0, input.notes ?? null, id);
    if (result.changes === 0) return false;
    db.prepare("DELETE FROM tank_readings WHERE reading_id = ?").run(id);
    insertTankRows(id, input.tanks);
    recomputeReadingDiffs(id);
    return true;
  });
  return transaction();
}

export function deleteReading(id: number): boolean {
  const transaction = db.transaction(() => {
    // Nullify refresh_runs references before deleting the reading
    db.prepare("UPDATE refresh_runs SET reading_id = NULL WHERE reading_id = ?").run(id);
    const result = db.prepare("DELETE FROM readings WHERE id = ?").run(id);
    if (result.changes > 0) recomputeReadingDiffs();
    return result.changes > 0;
  });
  return transaction();
}

function hydrateReading(row: DbReadingRow): unknown {
  const tanks = db.prepare("SELECT * FROM tank_readings WHERE reading_id = ? ORDER BY tank").all(row.id) as TankRow[];
  return {
    id: row.id,
    capturedAt: row.captured_at,
    source: row.source,
    confidence: row.confidence,
    totalLevelMm: row.total_level_mm,
    totalLevelDiffMm: row.total_level_diff_mm,
    totalGsvM3: row.total_gsv_m3,
    totalGsvDiffM3: row.total_gsv_diff_m3,
    verified: row.verified === 1,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tanks: tanks.map((tank) => ({
      id: tank.id,
      tank: tank.tank,
      levelMm: tank.level_mm,
      temperatureC: tank.temperature_c,
      tovM3: tank.tov_m3,
      gsvM3: tank.gsv_m3,
    })),
  };
}

function insertTankRows(readingId: number, tanks: TankReadingInput[]): void {
  const insert = db.prepare("INSERT INTO tank_readings (reading_id, tank, level_mm, temperature_c, tov_m3, gsv_m3) VALUES (?, ?, ?, ?, ?, ?)");
  for (const tank of tanks) {
    insert.run(readingId, tank.tank, tank.levelMm, tank.temperatureC, tank.tovM3, tank.gsvM3);
  }
}

export function validateReadingInput(input: unknown): asserts input is ReadingInput {
  if (!input || typeof input !== "object") throw new Error("Reading body must be an object.");
  const value = input as ReadingInput;
  if (!value.capturedAt || Number.isNaN(Date.parse(value.capturedAt))) throw new Error("capturedAt must be an ISO date string.");
  if (!Array.isArray(value.tanks) || value.tanks.length !== 4) throw new Error("Exactly four tank readings are required.");
  const names = new Set(value.tanks.map((tank) => tank.tank));
  for (const name of ["C1", "C2", "C3", "C4"] satisfies TankName[]) {
    if (!names.has(name)) throw new Error(`Missing tank ${name}.`);
  }
  for (const tank of value.tanks) {
    if (!["C1", "C2", "C3", "C4"].includes(tank.tank)) throw new Error("Invalid tank name.");
    for (const field of ["levelMm", "temperatureC", "tovM3", "gsvM3"] as const) {
      const fieldValue = tank[field];
      if (fieldValue !== null && (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))) throw new Error(`${tank.tank}.${field} must be a finite number or null.`);
    }
  }
}

function calculateTotals(tanks: TankReadingInput[]): { totalLevelMm: number | null; totalGsvM3: number | null } {
  const levels = tanks.map((tank) => tank.levelMm);
  const gsvs = tanks.map((tank) => tank.gsvM3);
  return {
    totalLevelMm: levels.every((value) => value != null) ? (levels as number[]).reduce((sum, value) => sum + value, 0) : null,
    totalGsvM3: gsvs.every((value) => value != null) ? (gsvs as number[]).reduce((sum, value) => sum + value, 0) : null,
  };
}

function recomputeReadingDiffs(aroundId?: number): void {
  if (aroundId != null) {
    const allRows = db
      .prepare("SELECT id, total_level_mm, total_gsv_m3 FROM readings ORDER BY captured_at ASC, id ASC")
      .all() as { id: number; total_level_mm: number | null; total_gsv_m3: number | null }[];

    const idx = allRows.findIndex((r) => r.id === aroundId);
    if (idx === -1) return;

    const prev = idx > 0 ? allRows[idx - 1] : null;
    const current = allRows[idx];
    const levelDiff = current.total_level_mm != null && prev?.total_level_mm != null ? current.total_level_mm - prev.total_level_mm : null;
    const gsvDiff = current.total_gsv_m3 != null && prev?.total_gsv_m3 != null ? current.total_gsv_m3 - prev.total_gsv_m3 : null;
    db.prepare("UPDATE readings SET total_level_diff_mm = ?, total_gsv_diff_m3 = ? WHERE id = ?").run(levelDiff, gsvDiff, current.id);

    if (idx + 1 < allRows.length) {
      const next = allRows[idx + 1];
      const nextLevelDiff = next.total_level_mm != null && current.total_level_mm != null ? next.total_level_mm - current.total_level_mm : null;
      const nextGsvDiff = next.total_gsv_m3 != null && current.total_gsv_m3 != null ? next.total_gsv_m3 - current.total_gsv_m3 : null;
      db.prepare("UPDATE readings SET total_level_diff_mm = ?, total_gsv_diff_m3 = ? WHERE id = ?").run(nextLevelDiff, nextGsvDiff, next.id);
    }
  } else {
    const rows = db
      .prepare("SELECT id, total_level_mm, total_gsv_m3 FROM readings ORDER BY captured_at ASC, id ASC")
      .all() as { id: number; total_level_mm: number | null; total_gsv_m3: number | null }[];
    const update = db.prepare("UPDATE readings SET total_level_diff_mm = ?, total_gsv_diff_m3 = ? WHERE id = ?");
    let previousLevel: number | null = null;
    let previousGsv: number | null = null;
    for (const row of rows) {
      const levelDiff = row.total_level_mm != null && previousLevel != null ? row.total_level_mm - previousLevel : null;
      const gsvDiff = row.total_gsv_m3 != null && previousGsv != null ? row.total_gsv_m3 - previousGsv : null;
      update.run(levelDiff, gsvDiff, row.id);
      previousLevel = row.total_level_mm;
      previousGsv = row.total_gsv_m3;
    }
  }
}

export function getSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings ORDER BY key").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function updateSettings(settings: Record<string, unknown>): Record<string, string> {
  const transaction = db.transaction(() => {
    const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [key, value] of Object.entries(settings)) {
      if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error(`Invalid setting key: ${key}`);
      upsert.run(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  });
  transaction();
  return getSettings();
}

export function startRefreshRun(startedAt: string, screenshotPaths: string[]): number {
  const result = db
    .prepare("INSERT INTO refresh_runs (started_at, status, screenshot_paths) VALUES (?, 'running', ?)")
    .run(startedAt, JSON.stringify(screenshotPaths));
  return Number(result.lastInsertRowid);
}

export function finishRefreshRun(args: {
  id: number;
  startedAt: string;
  status: string;
  errorCode: string | null;
  message: string;
  confidence: number | null;
  readingId: number | null;
  screenshotPaths: string[];
}): void {
  const finishedAt = localIsoNow();
  const durationMs = Date.parse(finishedAt) - Date.parse(args.startedAt);
  db.prepare(
    `UPDATE refresh_runs SET
      finished_at = ?, status = ?, error_code = ?, message = ?, confidence = ?, reading_id = ?, screenshot_paths = ?, duration_ms = ?
     WHERE id = ?`,
  ).run(finishedAt, args.status, args.errorCode, args.message, args.confidence, args.readingId, JSON.stringify(args.screenshotPaths), durationMs, args.id);
}

export function listRefreshRuns(limit = 100): unknown[] {
  const rows = db.prepare("SELECT * FROM refresh_runs ORDER BY started_at DESC, id DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 1000)) as Record<string, unknown>[];
  return rows.map((row) => ({ ...row, screenshot_paths: JSON.parse(String(row.screenshot_paths ?? "[]")) }));
}

export function listExpiredSuccessfulScreenshotPaths(cutoffIso: string): string[] {
  const rows = db
    .prepare("SELECT screenshot_paths FROM refresh_runs WHERE status = 'success' AND finished_at IS NOT NULL AND finished_at < ?")
    .all(cutoffIso) as { screenshot_paths: string | null }[];
  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.screenshot_paths ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
}

// ─── API Keys ────────────────────────────────────────────────────────────────

export function generateApiKey(label: string, permissions: ApiKeyPermissions): string {
  const key = `ctm_live_${crypto.randomBytes(16).toString("hex")}`;
  db.prepare("INSERT INTO api_keys (key, label, permissions, created_at) VALUES (?, ?, ?, ?)").run(key, label, permissions, localIsoNow());
  return key;
}

export function validateApiKey(key: string): ApiKey | null {
  return (db.prepare("SELECT * FROM api_keys WHERE key = ? AND revoked_at IS NULL").get(key) as ApiKey | null) ?? null;
}

export function listApiKeys(): Omit<ApiKey, "key">[] {
  return db.prepare("SELECT id, label, permissions, created_at, revoked_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC").all() as Omit<ApiKey, "key">[];
}

export function revokeApiKey(id: number): boolean {
  const result = db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(localIsoNow(), id);
  return result.changes > 0;
}

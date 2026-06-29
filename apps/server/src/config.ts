import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 6): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  }
  return result;
}

function ensurePassword(envVar: string): string {
  const existing = process.env[envVar];
  if (existing) return existing;

  const generated = generatePassword();
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    const line = `\n${envVar}=${generated}\n`;
    if (fs.existsSync(envPath)) {
      fs.appendFileSync(envPath, line);
    } else {
      fs.writeFileSync(envPath, line.trimStart());
    }
    console.log(`[config] Generated ${envVar} and wrote to .env`);
  } catch {
    console.warn(`[config] Could not write ${envVar} to .env — using in-memory value`);
  }
  process.env[envVar] = generated;
  return generated;
}

export const config = {
  port: numberEnv("PORT", 3000),
  aiBaseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
  aiConfidenceThreshold: numberEnv("AI_CONFIDENCE_THRESHOLD", 0.85),
  screenshotSuccessRetentionHours: numberEnv("SCREENSHOT_SUCCESS_RETENTION_HOURS", 3),
  runtimeDir: path.resolve(process.cwd(), "runtime"),
  authReadonlyPassword: ensurePassword("AUTH_READONLY_PASSWORD"),
  authReadwritePassword: ensurePassword("AUTH_READWRITE_PASSWORD"),
};

export const paths = {
  dataDir: path.join(config.runtimeDir, "data"),
  screenshotDir: path.join(config.runtimeDir, "screenshots"),
  database: path.join(config.runtimeDir, "data", "cloghan_tanks.sqlite"),
  logsDir: path.join(config.runtimeDir, "logs"),
  logFile: path.join(config.runtimeDir, "logs", "server.log"),
};

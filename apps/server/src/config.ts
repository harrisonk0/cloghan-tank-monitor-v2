import "dotenv/config";
import path from "node:path";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: numberEnv("PORT", 3000),
  aiBaseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
  aiConfidenceThreshold: numberEnv("AI_CONFIDENCE_THRESHOLD", 0.85),
  screenshotSuccessRetentionHours: numberEnv("SCREENSHOT_SUCCESS_RETENTION_HOURS", 3),
  runtimeDir: path.resolve(process.cwd(), "runtime"),
};

export const paths = {
  dataDir: path.join(config.runtimeDir, "data"),
  screenshotDir: path.join(config.runtimeDir, "screenshots"),
  database: path.join(config.runtimeDir, "data", "cloghan_tanks.sqlite"),
  logsDir: path.join(config.runtimeDir, "logs"),
  logFile: path.join(config.runtimeDir, "logs", "server.log"),
};

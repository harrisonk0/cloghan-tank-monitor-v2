import cors from "@fastify/cors";
import Fastify from "fastify";
import cookie from "cookie";
import { authenticate, clearSessionCookie, requireReadWrite, setSessionCookie } from "./auth.js";
import { config, paths } from "./config.js";
import {
  deleteReading,
  generateApiKey,
  getReading,
  getSettings,
  insertReading,
  listApiKeys,
  listReadings,
  listRefreshRuns,
  revokeApiKey,
  updateReading,
  updateSettings,
  validateApiKey,
} from "./db.js";
import { confirmRefresh, runRefresh } from "./refresh.js";
import { configureScheduler, getSchedulerStatus } from "./scheduler.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "https://cloghan-tanks.vercel.app",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// ─── Public routes (no auth) ────────────────────────────────────────────────

app.get("/api/health", async () => ({
  status: "ok",
  time: new Date().toISOString(),
  database: paths.database,
  aiConfigured: Boolean(config.aiApiKey),
}));

// ─── Auth routes ─────────────────────────────────────────────────────────────

app.post("/api/auth", async (request, reply) => {
  const { key } = (request.body ?? {}) as { key?: string };
  if (!key || typeof key !== "string") {
    return reply.code(400).send({ error: "API key is required." });
  }
  const keyData = validateApiKey(key);
  if (!keyData) {
    return reply.code(401).send({ error: "Invalid API key." });
  }
  setSessionCookie(reply, key);
  return { ok: true, permissions: keyData.permissions };
});

app.delete("/api/auth", async (_request, reply) => {
  clearSessionCookie(reply);
  return { ok: true };
});

app.get("/api/auth", async (request, reply) => {
  // Check if current session is valid
  const cookies = cookie.parse(request.headers.cookie ?? "");
  const sessionKey = cookies.ctm_session;
  if (sessionKey) {
    const keyData = validateApiKey(sessionKey);
    if (keyData) {
      return { authenticated: true, permissions: keyData.permissions };
    }
  }
  return { authenticated: false };
});

// ─── Tray-only key management (used by tray.ts, no HTTP auth needed) ────────
// These are called internally by the tray module, not exposed over HTTP.

app.get("/api/keys", async () => {
  return listApiKeys();
});

app.post("/api/keys", async (request, reply) => {
  const { label, permissions } = (request.body ?? {}) as { label?: string; permissions?: string };
  if (permissions !== "readonly" && permissions !== "readwrite") {
    return reply.code(400).send({ error: "permissions must be 'readonly' or 'readwrite'." });
  }
  const key = generateApiKey(label ?? "", permissions);
  return { key, permissions };
});

app.delete("/api/keys/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) {
    return reply.code(400).send({ error: "Invalid key ID." });
  }
  const revoked = revokeApiKey(numId);
  if (!revoked) return reply.code(404).send({ error: "Key not found or already revoked." });
  return { ok: true };
});

// ─── Read-only routes ────────────────────────────────────────────────────────

app.get("/api/readings", { preHandler: authenticate }, async (request) => {
  const query = request.query as { limit?: string };
  return listReadings(query.limit ? Number(query.limit) : 200);
});

app.get("/api/readings/:id", { preHandler: authenticate }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const reading = getReading(Number(id));
  if (!reading) return reply.code(404).send({ error: "Reading not found." });
  return reading;
});

app.get("/api/refresh-runs", { preHandler: authenticate }, async (request) => {
  const query = request.query as { limit?: string };
  return listRefreshRuns(query.limit ? Number(query.limit) : 100);
});

app.get("/api/settings", { preHandler: authenticate }, async () => settingsResponse());

// ─── Read-write routes ───────────────────────────────────────────────────────

app.post("/api/readings", { preHandler: requireReadWrite }, async (request, reply) => {
  try {
    const id = insertReading(request.body as never);
    return reply.code(201).send(getReading(id));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid reading." });
  }
});

app.put("/api/readings/:id", { preHandler: requireReadWrite }, async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const updated = updateReading(Number(id), request.body as never);
    if (!updated) return reply.code(404).send({ error: "Reading not found." });
    return getReading(Number(id));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid reading." });
  }
});

app.delete("/api/readings/:id", { preHandler: requireReadWrite }, async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!deleteReading(Number(id))) return reply.code(404).send({ error: "Reading not found." });
  return { ok: true };
});

app.post("/api/refresh", { preHandler: requireReadWrite }, async () => runRefresh());

app.post("/api/refresh/confirm", { preHandler: requireReadWrite }, async (request, reply) => {
  try {
    return confirmRefresh(request.body);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Refresh confirmation failed." });
  }
});

app.put("/api/settings", { preHandler: requireReadWrite }, async (request, reply) => {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) return reply.code(400).send({ error: "Settings body must be an object." });
  try {
    updateSettings(normalizeIncomingSettings(request.body as Record<string, unknown>));
    configureScheduler();
    return settingsResponse();
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid settings." });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function settingsResponse(): Record<string, unknown> {
  const settings = getSettings();
  return {
    scheduleMode: settings.scheduleMode ?? settings.refreshSchedule ?? "manual",
    customIntervalMinutes: Number(settings.customIntervalMinutes ?? 60),
    notifySuccess: settings.notifyOnSuccess !== "false",
    notifyWarning: settings.notifyOnWarning !== "false",
    notifyFailure: settings.notifyOnFailure !== "false",
    screenshotRetentionHours: config.screenshotSuccessRetentionHours,
    aiConfigured: Boolean(config.aiApiKey),
    aiBaseUrlConfigured: Boolean(config.aiBaseUrl),
    aiModel: config.aiModel,
    aiConfidenceThreshold: config.aiConfidenceThreshold,
    scheduler: getSchedulerStatus(),
  };
}

function normalizeIncomingSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    scheduleMode: settings.scheduleMode ?? settings.refreshSchedule ?? "manual",
    customIntervalMinutes: settings.customIntervalMinutes ?? 60,
    notifyOnSuccess: settings.notifySuccess ?? settings.notifyOnSuccess ?? true,
    notifyOnWarning: settings.notifyWarning ?? settings.notifyOnWarning ?? true,
    notifyOnFailure: settings.notifyFailure ?? settings.notifyOnFailure ?? true,
  };
}

// ─── Start ───────────────────────────────────────────────────────────────────

let serverRunning = false;

export function startServer(): void {
  if (serverRunning) return;
  try {
    configureScheduler();
    app.listen({ port: config.port, host: "127.0.0.1" }).then(() => {
      serverRunning = true;
      console.log(`[server] Listening on http://127.0.0.1:${config.port}`);
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

export function getServerStatus(): { running: boolean; port: number } {
  return { running: serverRunning, port: config.port };
}

// Auto-start only when run directly (not imported by tray)
const isMainModule = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMainModule) {
  startServer();
}

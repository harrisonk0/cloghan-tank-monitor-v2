import cors from "@fastify/cors";
import Fastify from "fastify";
import { authenticate, checkPassword, requireReadWrite } from "./auth.js";
import { config, paths } from "./config.js";
import {
  createSession,
  deleteSession,
  deleteReading,
  getReading,
  getSettings,
  insertReading,
  listReadings,
  listRefreshRuns,
  updateReading,
  updateSettings,
  validateSession,
} from "./db.js";
import { confirmRefresh, runRefresh } from "./refresh.js";
import { ReadingInput } from "./types.js";
import { configureScheduler, getSchedulerStatus } from "./scheduler.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    try {
      const hostname = new URL(origin).hostname;
      if (/\.trycloudflare\.com$/.test(hostname)) return cb(null, true);
      if (/\.ngrok(-free)?\.(dev|app)$/.test(hostname)) return cb(null, true); // backwards compat
      if (/\.vercel\.app$/.test(hostname)) return cb(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    } catch {
      // malformed origin
    }
    cb(null, false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Allow empty/missing Content-Type on POST (e.g. /api/refresh with no body)
app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
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
  const { password } = (request.body ?? {}) as { password?: string };
  if (!password || typeof password !== "string") {
    return reply.code(400).send({ error: "Password is required." });
  }
  const permissions = checkPassword(password);
  if (!permissions) {
    return reply.code(401).send({ error: "Invalid password." });
  }
  const session = createSession(permissions);
  return { token: session.token, permissions: session.permissions, expiresAt: session.expiresAt };
});

app.delete("/api/auth", async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    deleteSession(token);
  }
  return { ok: true };
});

app.get("/api/auth", async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const session = validateSession(token);
    if (session) {
      return { authenticated: true, permissions: session.permissions };
    }
  }
  return { authenticated: false };
});

// ─── Read-only routes ────────────────────────────────────────────────────────

app.get("/api/readings", { preHandler: authenticate }, async (request) => {
  const query = request.query as { limit?: string };
  const limitParam = query.limit ? Number(query.limit) : undefined;
  const limit = limitParam != null && Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 1000) : undefined;
  return listReadings(limit ?? 200);
});

app.get("/api/readings/:id", { preHandler: authenticate }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) {
    return reply.code(400).send({ error: "Invalid ID." });
  }
  const reading = getReading(numId);
  if (!reading) return reply.code(404).send({ error: "Reading not found." });
  return reading;
});

app.get("/api/refresh-runs", { preHandler: authenticate }, async (request) => {
  const query = request.query as { limit?: string };
  const limitParam = query.limit ? Number(query.limit) : undefined;
  const limit = limitParam != null && Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 1000) : undefined;
  return listRefreshRuns(limit ?? 100);
});

app.get("/api/settings", { preHandler: authenticate }, async () => settingsResponse());

// ─── Read-write routes ───────────────────────────────────────────────────────

app.post("/api/readings", { preHandler: requireReadWrite }, async (request, reply) => {
  try {
    const id = insertReading(request.body as ReadingInput);
    return reply.code(201).send(getReading(id));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid reading." });
  }
});

app.put("/api/readings/:id", { preHandler: requireReadWrite }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) {
    return reply.code(400).send({ error: "Invalid ID." });
  }
  try {
    const updated = updateReading(numId, request.body as ReadingInput);
    if (!updated) return reply.code(404).send({ error: "Reading not found." });
    return getReading(numId);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid reading." });
  }
});

app.delete("/api/readings/:id", { preHandler: requireReadWrite }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) {
    return reply.code(400).send({ error: "Invalid ID." });
  }
  if (!deleteReading(numId)) return reply.code(404).send({ error: "Reading not found." });
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
  app
    .listen({ port: config.port, host: "127.0.0.1" })
    .then(() => {
      serverRunning = true;
      console.log(`[server] Listening on http://127.0.0.1:${config.port}`);
    })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}

export function getServerStatus(): { running: boolean; port: number } {
  return { running: serverRunning, port: config.port };
}

export async function stopServer(): Promise<void> {
  if (!serverRunning) return;
  try {
    await app.close();
    serverRunning = false;
    console.log("[server] Stopped.");
  } catch (error) {
    console.error("[server] Error stopping:", error);
  }
}

// Auto-start only when run directly (not imported by tray)
const isMainModule = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMainModule) {
  startServer();
}

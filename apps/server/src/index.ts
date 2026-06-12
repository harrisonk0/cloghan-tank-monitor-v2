import cors from "@fastify/cors";
import Fastify from "fastify";
import { config, paths } from "./config.js";
import { deleteReading, getReading, getSettings, insertReading, listReadings, listRefreshRuns, updateReading, updateSettings } from "./db.js";
import { confirmRefresh, runRefresh } from "./refresh.js";
import { configureScheduler, getSchedulerStatus } from "./scheduler.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/api/health", async () => ({
  status: "ok",
  time: new Date().toISOString(),
  database: paths.database,
  aiConfigured: Boolean(config.aiApiKey),
}));

app.get("/api/readings", async (request) => {
  const query = request.query as { limit?: string };
  return listReadings(query.limit ? Number(query.limit) : 200);
});

app.get("/api/readings/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const reading = getReading(Number(id));
  if (!reading) return reply.code(404).send({ error: "Reading not found." });
  return reading;
});

app.post("/api/readings", async (request, reply) => {
  try {
    const id = insertReading(request.body as never);
    return reply.code(201).send(getReading(id));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid reading." });
  }
});

app.put("/api/readings/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const updated = updateReading(Number(id), request.body as never);
    if (!updated) return reply.code(404).send({ error: "Reading not found." });
    return getReading(Number(id));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid reading." });
  }
});

app.delete("/api/readings/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!deleteReading(Number(id))) return reply.code(404).send({ error: "Reading not found." });
  return { ok: true };
});

app.get("/api/settings", async () => settingsResponse());

app.put("/api/settings", async (request, reply) => {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) return reply.code(400).send({ error: "Settings body must be an object." });
  try {
    updateSettings(normalizeIncomingSettings(request.body as Record<string, unknown>));
    configureScheduler();
    return settingsResponse();
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid settings." });
  }
});

app.get("/api/refresh-runs", async (request) => {
  const query = request.query as { limit?: string };
  return listRefreshRuns(query.limit ? Number(query.limit) : 100);
});

app.post("/api/refresh", async () => runRefresh());

app.post("/api/refresh/confirm", async (request, reply) => {
  try {
    return confirmRefresh(request.body);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Refresh confirmation failed." });
  }
});

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

try {
  configureScheduler();
  await app.listen({ port: config.port, host: "127.0.0.1" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

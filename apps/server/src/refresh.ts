import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import screenshot from "screenshot-desktop";
import { config, paths } from "./config.js";
import { finishRefreshRun, insertReading, listExpiredSuccessfulScreenshotPaths, startRefreshRun, validateReadingInput } from "./db.js";
import { notify } from "./notify.js";
import type { AiExtraction, PendingReview, ReadingInput, RefreshErrorCode, TankName } from "./types.js";
import { localIsoNow } from "./util.js";

const pendingReviews = new Map<string, PendingReview>();

const PENDING_REVIEW_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function prunePendingReviews(): void {
  const now = Date.now();
  for (const [id, review] of pendingReviews) {
    if (now - Date.parse(review.createdAt) > PENDING_REVIEW_TTL_MS) {
      pendingReviews.delete(id);
    }
  }
}

export async function runRefresh(): Promise<unknown> {
  prunePendingReviews();
  const startedAt = localIsoNow();
  let screenshotPaths: string[] = [];
  let runId: number | null = null;

  try {
    await cleanupSuccessfulScreenshots();
    screenshotPaths = await captureScreenshots();
    runId = startRefreshRun(startedAt, screenshotPaths);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screenshot capture failed.";
    if (runId == null) runId = startRefreshRun(startedAt, screenshotPaths);
    finishRefreshRun({ id: runId, startedAt, status: "failed", errorCode: "ERR_SCREENSHOT_FAILED", message, confidence: null, readingId: null, screenshotPaths });
    notify("failure", `Refresh failed - ${message}`);
    return refreshResponse("failed", "ERR_SCREENSHOT_FAILED", message, null, null);
  }
  if (runId == null) throw new Error("Refresh run could not be started.");

  try {
    const extraction = await callVisionApi(screenshotPaths);
    const validationError = validateExtraction(extraction);
    if (validationError) {
      finishRefreshRun({ id: runId, startedAt, status: "failed", errorCode: validationError, message: extraction.message || "AI response failed validation.", confidence: extraction.confidence ?? null, readingId: null, screenshotPaths });
      notify("failure", `Refresh failed - ${extraction.message || validationError}`);
      return refreshResponse("failed", validationError, extraction.message || "AI response failed validation.", extraction.confidence ?? null, null);
    }

    if (extraction.status !== "success" && extraction.status !== "ok") {
      const errorCode = extraction.errorCode ?? "ERR_AI_INVALID_RESPONSE";
      finishRefreshRun({ id: runId, startedAt, status: "failed", errorCode, message: extraction.message, confidence: extraction.confidence, readingId: null, screenshotPaths });
      notify("failure", `Refresh failed - ${extraction.message}`);
      return refreshResponse("failed", errorCode, extraction.message, extraction.confidence, null);
    }

    const reading = toReadingInput(extraction, startedAt);
    if (extraction.confidence < config.aiConfidenceThreshold) {
      const reviewId = randomUUID();
      pendingReviews.set(reviewId, { reviewId, runId, extraction, screenshotPaths, createdAt: startedAt });
      finishRefreshRun({ id: runId, startedAt, status: "needs_review", errorCode: "ERR_LOW_CONFIDENCE", message: "Low confidence extraction requires review.", confidence: extraction.confidence, readingId: null, screenshotPaths });
      notify("warning", "Low confidence extraction - review required.");
      return { status: "needs_review", errorCode: "ERR_LOW_CONFIDENCE", message: "Low confidence extraction requires review.", confidence: extraction.confidence, reviewId, reading };
    }

    const readingId = insertReading(reading);
    finishRefreshRun({ id: runId, startedAt, status: "success", errorCode: null, message: extraction.message, confidence: extraction.confidence, readingId, screenshotPaths });
    notify("success", `Refresh successful - reading #${readingId} inserted.`);
    return refreshResponse("success", null, extraction.message, extraction.confidence, readingId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed.";
    const errorCode: RefreshErrorCode = message.includes("AI") || message.includes("fetch") ? "ERR_AI_API_UNAVAILABLE" : "ERR_DATABASE_WRITE_FAILED";
    finishRefreshRun({ id: runId, startedAt, status: "failed", errorCode, message, confidence: null, readingId: null, screenshotPaths });
    notify("failure", `Refresh failed - ${message}`);
    return refreshResponse("failed", errorCode, message, null, null);
  }
}

export function confirmRefresh(body: unknown): unknown {
  prunePendingReviews();
  if (!body || typeof body !== "object") throw new Error("Confirm body must be an object.");
  const { reviewId, reading } = body as { reviewId?: string; reading?: ReadingInput };
  if (!reviewId) throw new Error("reviewId is required.");
  const pending = pendingReviews.get(reviewId);
  if (!pending) throw new Error("Pending review was not found or has expired.");

  const finalReading = reading ?? toReadingInput(pending.extraction, pending.createdAt, true);
  validateReadingInput(finalReading);
  const readingId = insertReading({ ...finalReading, source: finalReading.source ?? "ai_review", confidence: finalReading.confidence ?? pending.extraction.confidence, verified: true });
  pendingReviews.delete(reviewId);

  finishRefreshRun({
    id: pending.runId,
    startedAt: pending.createdAt,
    status: "success",
    errorCode: null,
    message: `Low confidence extraction confirmed and inserted as reading #${readingId}.`,
    confidence: pending.extraction.confidence,
    readingId,
    screenshotPaths: pending.screenshotPaths,
  });
  notify("success", `Refresh confirmed - reading #${readingId} inserted.`);
  return { status: "success", errorCode: null, message: "Confirmed reading inserted.", confidence: pending.extraction.confidence, readingId };
}

async function captureScreenshots(): Promise<string[]> {
  await fs.mkdir(paths.screenshotDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const module = screenshot as unknown as { all?: () => Promise<Buffer[]>; capture?: (options?: { format?: string }) => Promise<Buffer | string> };
  const captureOne = screenshot as unknown as (options?: { format?: string }) => Promise<Buffer | string>;
  const buffers = module.all ? await module.all() : [await (module.capture ?? captureOne)({ format: "png" })];
  const files: string[] = [];

  for (const [index, buffer] of buffers.entries()) {
    const file = path.join(paths.screenshotDir, `${stamp}-screen-${index + 1}.png`);
    if (Buffer.isBuffer(buffer)) {
      await fs.writeFile(file, buffer);
    } else {
      await fs.writeFile(file, Buffer.from(buffer));
    }
    files.push(file);
  }

  if (files.length === 0) throw new Error("No screenshots were captured.");
  return files;
}

async function callVisionApi(screenshotPaths: string[]): Promise<AiExtraction> {
  if (!config.aiApiKey) throw new Error("AI_API_KEY is not configured.");
  const images = await Promise.all(screenshotPaths.map(async (file) => `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`));
  const response = await fetch(`${config.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Return JSON only. Extract the visible Cloghan tank monitoring table. Required tanks are C1, C2, C3, C4. Do not guess missing values. Use null only for truly blank numeric cells. Remove commas and trailing M suffixes from numbers.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract tank readings using the exact contract: {status,errorCode,message,confidence,reading:{tanks:[{tank,levelMm,temperatureC,tovM3,gsvM3}]},details}. Do NOT include capturedAt — the server sets it automatically. If table missing use ERR_TABLE_NOT_FOUND; if incomplete use ERR_INCOMPLETE_TABLE." },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`AI API request failed with HTTP ${response.status}.`);
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response did not include message content.");
  return parseStrictJson(content);
}

function parseStrictJson(content: string): AiExtraction {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new Error("AI response was not strict JSON.");
  try {
    return JSON.parse(trimmed) as AiExtraction;
  } catch {
    throw new Error("AI response JSON could not be parsed.");
  }
}

function validateExtraction(extraction: AiExtraction): RefreshErrorCode | null {
  if (!extraction || typeof extraction !== "object") return "ERR_AI_INVALID_RESPONSE";
  if (extraction.status === "failed") return extraction.errorCode ?? "ERR_AI_INVALID_RESPONSE";
  if (extraction.status !== "success" && extraction.status !== "ok") return "ERR_AI_INVALID_RESPONSE";
  if (typeof extraction.message !== "string") return "ERR_AI_INVALID_RESPONSE";
  if (typeof extraction.confidence !== "number" || extraction.confidence < 0 || extraction.confidence > 1) return "ERR_AI_INVALID_RESPONSE";
  if (!extraction.reading) return "ERR_VALIDATION_FAILED";
  try {
    validateReadingInput(toReadingInput(extraction, localIsoNow()));
    return null;
  } catch {
    return "ERR_VALIDATION_FAILED";
  }
}

function toReadingInput(extraction: AiExtraction, fallbackCapturedAt: string, reviewed = false): ReadingInput {
  if (!extraction.reading) throw new Error("Extraction did not include a reading.");
  return {
    capturedAt: fallbackCapturedAt,
    source: reviewed ? "ai_review" : "ai",
    confidence: extraction.confidence,
    verified: reviewed,
    tanks: extraction.reading.tanks.map((tank) => ({
      tank: tank.tank as TankName,
      levelMm: normalizeNumber(tank.levelMm),
      temperatureC: normalizeNumber(tank.temperatureC),
      tovM3: normalizeNumber(tank.tovM3),
      gsvM3: normalizeNumber(tank.gsvM3),
    })),
  };
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").replace(/M$/i, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function cleanupSuccessfulScreenshots(): Promise<void> {
  const cutoffIso = new Date(Date.now() - config.screenshotSuccessRetentionHours * 60 * 60 * 1000).toISOString();
  try {
    const files = listExpiredSuccessfulScreenshotPaths(cutoffIso);
    await Promise.all(files.map((file) => fs.rm(file, { force: true })));
  } catch {
    // Retention cleanup is best-effort and must not block refresh.
  }
}

function refreshResponse(status: string, errorCode: RefreshErrorCode | null, message: string, confidence: number | null, readingId: number | null): unknown {
  return { status, errorCode, message, confidence, readingId };
}

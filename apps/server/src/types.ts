export type TankName = "C1" | "C2" | "C3" | "C4";

export type RefreshStatus = "running" | "success" | "warning" | "failed" | "needs_review";

export type RefreshErrorCode =
  | "ERR_SCREENSHOT_FAILED"
  | "ERR_AI_API_UNAVAILABLE"
  | "ERR_AI_INVALID_RESPONSE"
  | "ERR_TABLE_NOT_FOUND"
  | "ERR_INCOMPLETE_TABLE"
  | "ERR_LOW_CONFIDENCE"
  | "ERR_VALIDATION_FAILED"
  | "ERR_DATABASE_WRITE_FAILED";

export type TankReadingInput = {
  tank: TankName;
  levelMm: number | null;
  temperatureC: number | null;
  tovM3: number | null;
  gsvM3: number | null;
};

export type ReadingInput = {
  capturedAt: string;
  source?: string;
  confidence?: number | null;
  verified?: boolean;
  notes?: string | null;
  tanks: TankReadingInput[];
};

export type AiExtraction = {
  status: "success" | "ok" | "failed";
  errorCode: RefreshErrorCode | null;
  message: string;
  confidence: number;
  reading?: {
    capturedAt: string;
    tanks: TankReadingInput[];
  };
  details?: unknown;
};

export type PendingReview = {
  reviewId: string;
  runId: number;
  extraction: AiExtraction;
  screenshotPaths: string[];
  createdAt: string;
};

export type ApiKeyPermissions = "readonly" | "readwrite";

export type ApiKey = {
  id: number;
  key: string;
  label: string | null;
  permissions: ApiKeyPermissions;
  created_at: string;
  revoked_at: string | null;
};

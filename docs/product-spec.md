# Cloghan Tank Monitor V2 — Product Specification and Implementation Plan

## 1. Purpose

Cloghan Tank Monitor V2 is a standalone Windows-only local web application for capturing, extracting, storing, reviewing, correcting, and visualising Cloghan tank readings.

Version 1 depended on OpenWork/OpenCode manually reading screenshots and inserting data into SQLite. Version 2 must be independent: a user starts a local server, opens a browser page on `localhost`, and the application performs the capture/extraction/database workflow itself.

## 2. Operating Model

- Platform: Windows only.
- Runtime during development: Node.js via `npm run dev`.
- Future packaging target: single Windows executable or app bundle.
- UI access: local browser at `http://localhost:<port>`.
- Data store: local SQLite database.
- AI extraction: OpenAI-compatible vision API configured only through `.env`.
- Tank table visibility: the table must be visible on the active Windows desktop. It may be on any physical monitor. Virtual desktops are out of scope.

## 3. Key User Flows

### 3.1 Start App

1. User runs `npm run dev`.
2. Backend starts.
3. Frontend is served by Vite in development.
4. User opens the localhost URL.

### 3.2 Manual Refresh

1. User clicks `Refresh Data` in the site header.
2. Website shows refresh progress.
3. Backend captures all visible monitors/screens.
4. Backend sends screenshot images to the configured OpenAI-compatible API.
5. AI returns structured JSON.
6. Backend validates the result.
7. If confidence is high and data is valid, reading is inserted automatically.
8. If confidence is low but data is parseable, UI opens a preview modal and user confirms or edits before insertion.
9. If extraction fails, no reading is inserted and user receives notification.

### 3.3 Scheduled Refresh

1. User configures schedule in Settings.
2. Options:
   - Manual only
   - Every 10 minutes
   - Every 30 minutes
   - Every hour
   - Custom interval
3. Backend scheduler triggers the same refresh pipeline as manual refresh.
4. User receives completion/failure notifications.

### 3.4 Manual Data Correction

User can add, edit, and delete readings from the web UI. Duplicate readings are allowed as long as timestamps differ.

## 4. Functional Requirements

### 4.1 Dashboard

The dashboard should be professional but simple. It should show:

- Latest reading summary.
- C1/C2/C3/C4 level and GSV cards.
- Total level.
- Total GSV.
- Total level difference from previous reading.
- Total GSV difference from previous reading.
- Level trend chart.
- GSV trend chart.
- Recent refresh status.

### 4.2 Header

Every page should include:

- App name.
- `Refresh Data` button.
- Refresh progress/status indicator.
- Last refresh result.

### 4.3 Readings Page

Table of database readings with CRUD actions.

Minimum columns:

- Timestamp
- C1 level, temperature, TOV, GSV
- C2 level, temperature, TOV, GSV
- C3 level, temperature, TOV, GSV
- C4 level, temperature, TOV, GSV
- Total level
- Total level diff
- Total GSV
- Total GSV diff
- Source
- Confidence
- Verified

### 4.4 Settings Page

Settings should include:

- Refresh schedule.
- Custom interval controls.
- Notification preferences.
- Screenshot retention summary.
- AI config status only; API key and base URL must not be editable in the website.

### 4.5 Refresh History Page

Shows every refresh attempt, including failures.

Columns:

- Started at
- Finished at
- Status
- Error code
- Message
- Confidence
- Duration
- Linked reading ID if inserted

## 5. Notifications

The application should support:

- In-app toast notifications.
- Windows desktop notifications.

Notification preferences:

- Notify on success.
- Notify on warning.
- Notify on failure.

Examples:

- Success: `Refresh successful — reading #42 inserted.`
- Warning: `Low confidence extraction — review required.`
- Failure: `Refresh failed — table not found.`

## 6. Structured Refresh Results

Every refresh must produce a structured result.

```ts
type RefreshStatus = "running" | "success" | "warning" | "failed" | "needs_review";

type RefreshErrorCode =
  | "ERR_SCREENSHOT_FAILED"
  | "ERR_AI_API_UNAVAILABLE"
  | "ERR_AI_INVALID_RESPONSE"
  | "ERR_TABLE_NOT_FOUND"
  | "ERR_INCOMPLETE_TABLE"
  | "ERR_LOW_CONFIDENCE"
  | "ERR_VALIDATION_FAILED"
  | "ERR_DATABASE_WRITE_FAILED";
```

Example success:

```json
{
  "status": "success",
  "errorCode": null,
  "message": "Tank table found and extracted successfully.",
  "confidence": 0.96,
  "readingId": 42
}
```

Example failure:

```json
{
  "status": "failed",
  "errorCode": "ERR_TABLE_NOT_FOUND",
  "message": "No tank monitoring table was visible in the screenshot.",
  "confidence": 0.12
}
```

## 7. AI Extraction Contract

The model must return JSON only.

Expected shape:

```json
{
  "status": "success",
  "errorCode": null,
  "message": "Extracted tank table.",
  "confidence": 0.95,
  "reading": {
    "capturedAt": "2026-06-12T10:30:00.000Z",
    "tanks": [
      {
        "tank": "C1",
        "levelMm": 19901,
        "temperatureC": 11.84,
        "tovM3": 36023.173,
        "gsvM3": 36120.437
      }
    ]
  },
  "details": {}
}
```

Rules:

- Extract TANK C1, C2, C3, C4.
- Do not guess missing/cut-off values.
- Remove commas from numeric output.
- Remove any trailing `M` suffix.
- If the table is missing, return `ERR_TABLE_NOT_FOUND`.
- If fields are cut off/missing, return `ERR_INCOMPLETE_TABLE`.

## 8. Confidence and Review Behaviour

- High confidence valid result: insert automatically.
- Low confidence valid result: do not insert immediately. Return `needs_review`; frontend opens a modal showing extracted data. User can confirm, edit, or cancel.
- Invalid/failure result: do not insert. Notify user and log refresh failure.

Initial threshold:

```txt
AI_CONFIDENCE_THRESHOLD=0.85
```

## 9. Screenshot Handling

- Capture all visible physical monitors/screens where the screenshot library supports it.
- Store screenshots under `runtime/screenshots/`.
- Successful refresh screenshots retained for 3 hours.
- Failed refresh screenshots retained indefinitely for diagnostics.
- `.gitignore` must exclude screenshots and runtime data.

## 10. Environment Variables

`.env` only; not editable in UI.

```env
PORT=3000
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=replace-me
AI_MODEL=gpt-4o-mini
AI_CONFIDENCE_THRESHOLD=0.85
SCREENSHOT_SUCCESS_RETENTION_HOURS=3
```

## 11. Database Schema

Use SQLite at `runtime/data/cloghan_tanks.sqlite`.

### readings

```sql
CREATE TABLE readings (
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
```

### tank_readings

```sql
CREATE TABLE tank_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reading_id INTEGER NOT NULL,
  tank TEXT NOT NULL,
  level_mm INTEGER,
  temperature_c REAL,
  tov_m3 REAL,
  gsv_m3 REAL,
  FOREIGN KEY (reading_id) REFERENCES readings(id) ON DELETE CASCADE
);
```

### refresh_runs

```sql
CREATE TABLE refresh_runs (
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
```

### settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## 12. API Design

```http
GET    /api/health
GET    /api/readings
GET    /api/readings/:id
POST   /api/readings
PUT    /api/readings/:id
DELETE /api/readings/:id

POST   /api/refresh
POST   /api/refresh/confirm
GET    /api/refresh-runs

GET    /api/settings
PUT    /api/settings
```

## 13. Tech Stack

Recommended implementation:

- Node.js
- TypeScript
- Fastify backend
- better-sqlite3
- React + Vite frontend
- Tailwind CSS or simple CSS modules
- Recharts for charts
- screenshot-desktop for screenshots
- node-notifier for Windows notifications
- OpenAI-compatible HTTP client implemented with `fetch`

## 14. Implementation Plan

### Phase 1 — Project scaffold

- Create clean subfolder.
- Add package scripts.
- Set up backend/frontend TypeScript.
- Add `.env.example` and `.gitignore`.

### Phase 2 — Database and API basics

- Implement SQLite connection and migrations.
- Implement readings CRUD.
- Implement settings storage.
- Implement refresh run logging.

### Phase 3 — Screenshot and AI extraction

- Capture all monitors/screens.
- Store screenshots under runtime folder.
- Implement OpenAI-compatible vision request.
- Implement strict JSON parsing and validation.

### Phase 4 — Refresh pipeline

- Implement manual refresh endpoint.
- Implement progress/status model.
- Implement confidence handling.
- Implement preview/confirm flow for low-confidence data.
- Implement notifications.

### Phase 5 — Scheduler

- Implement Manual/10 min/30 min/hour/custom schedules.
- Persist settings.
- Show next refresh and last refresh in UI.

### Phase 6 — Frontend

- Professional dashboard.
- Readings CRUD table.
- Settings page.
- Refresh history page.
- Header refresh button.
- Progress bar and toast notifications.
- Low-confidence preview modal.

### Phase 7 — Verification and docs

- Test DB CRUD.
- Test manual refresh with mocked AI.
- Test failed states such as table not found.
- Test dashboard updates.
- Document usage.

## 15. Non-goals for initial V2

- Excel export.
- Virtual desktop switching.
- Cloud hosting.
- User authentication.
- Multi-site support.
- Long-term screenshot archival beyond diagnostic failed captures.

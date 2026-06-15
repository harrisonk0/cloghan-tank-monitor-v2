import fs from "node:fs/promises";
import path from "node:path";

// Load .env
const envPath = path.resolve(import.meta.dirname, "../../../.env");
const envContent = await fs.readFile(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

const API_BASE = process.env.AI_BASE_URL || "https://api.openai.com/v1";
const API_KEY = process.env.AI_API_KEY || "";
const MODEL = process.env.AI_MODEL || "gpt-4o-mini";

const SCREENSHOT = process.argv[2] || path.resolve("runtime/screenshots/sample.png");

console.log("=== AI Refresh Test ===");
console.log(`Base URL:  ${API_BASE}`);
console.log(`Model:     ${MODEL}`);
console.log(`API Key:   ${API_KEY.slice(0, 12)}...`);
console.log(`Screenshot: ${SCREENSHOT}`);
console.log();

// Read and encode the screenshot
const imageBuffer = await fs.readFile(SCREENSHOT);
const base64 = imageBuffer.toString("base64");
const dataUrl = `data:image/png;base64,${base64}`;
console.log(`Image size: ${(imageBuffer.length / 1024).toFixed(1)} KB (${base64.length} chars base64)`);
console.log();

// Call the vision API
console.log("Calling AI API...");
const startTime = Date.now();

const response = await fetch(`${API_BASE.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: MODEL,
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
          { type: "text", text: "Extract tank readings using the exact contract: {status,errorCode,message,confidence,reading:{capturedAt,tanks:[{tank,levelMm,temperatureC,tovM3,gsvM3}]},details}. If table missing use ERR_TABLE_NOT_FOUND; if incomplete use ERR_INCOMPLETE_TABLE." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  }),
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`Response: HTTP ${response.status} (${elapsed}s)`);
console.log();

if (!response.ok) {
  const errorText = await response.text();
  console.error("API Error:");
  console.error(errorText);
  process.exit(1);
}

const payload = await response.json();
const content = payload.choices?.[0]?.message?.content;

if (!content) {
  console.error("No content in response:");
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log("=== Raw AI Response ===");
console.log(content);
console.log();

// Parse and validate
try {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    console.error("Response is not valid JSON object");
    process.exit(1);
  }
  const extraction = JSON.parse(trimmed);
  console.log("=== Parsed Extraction ===");
  console.log(`Status:     ${extraction.status}`);
  console.log(`Error Code: ${extraction.errorCode || "none"}`);
  console.log(`Message:    ${extraction.message}`);
  console.log(`Confidence: ${extraction.confidence}`);
  if (extraction.reading) {
    console.log(`Captured:   ${extraction.reading.capturedAt}`);
    console.log(`Tanks:      ${extraction.reading.tanks?.length || 0}`);
    if (extraction.reading.tanks) {
      for (const tank of extraction.reading.tanks) {
        console.log(`  ${tank.tank}: level=${tank.levelMm}mm, temp=${tank.temperatureC}C, TOV=${tank.tovM3}m³, GSV=${tank.gsvM3}m³`);
      }
    }
  }
  console.log();
  
  // Validation
  const threshold = Number(process.env.AI_CONFIDENCE_THRESHOLD || "0.85");
  if (extraction.status === "success" && extraction.confidence >= threshold) {
    console.log("✅ PASS — High confidence, would auto-insert");
  } else if (extraction.status === "success" && extraction.confidence < threshold) {
    console.log("⚠️  PASS — Low confidence, would show review modal");
  } else {
    console.log("❌ FAIL — AI reported failure");
  }
} catch (err: any) {
  console.error("Failed to parse JSON:", err.message);
  process.exit(1);
}

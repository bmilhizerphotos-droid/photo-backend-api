/**
 * scan-screenshots.js
 * Uses Gemini 2.5 Flash (FREE tier) to detect screenshots and screen recordings.
 * Free tier: ~10 RPM — no cost.
 *
 * Usage:
 *   node scan-screenshots.js             # unscanned only
 *   node scan-screenshots.js --all       # rescan everything
 *   node scan-screenshots.js --limit 100
 *   node scan-screenshots.js --dry-run
 */

// Load .env manually (dotenv not installed as dep)
import { readFileSync } from "fs";
try {
  const envText = readFileSync(new URL(".env", import.meta.url), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([^#=\s][^=]*?)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

import path from "path";
import fs from "fs";
import { db, dbRun, dbAll } from "./db.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const THUMB_DIR = path.resolve("thumb-cache");
const BATCH_SIZE = 8;
const DELAY_MS = 7000; // ~8 req/min, safely under free-tier 10 RPM

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ALL = args.includes("--all");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not set in .env");
  process.exit(1);
}

// ── Heuristic fast-path ────────────────────────────────────────────────────
// Filename patterns that strongly indicate screenshots
const SCREENSHOT_FILENAME_RE =
  /^(screenshot[_\s-]|screen[_\s-]?shot[_\s-]|screen[_\s-]?cap|capture|screengrab|screenrec|scr\d|snapshot[_\s-]|sc[_\s-]\d)/i;

// Also catch: "Screenshot 2023-01-01 at 12.00.00", "Screenshot_20230101_120000"
const SCREENSHOT_FILENAME2_RE = /screenshot/i;

// Folder hints
const SCREENSHOT_FOLDER_RE =
  /\b(screenshot|screen[_-]shot|screen[_-]cap|screenrec|capture)\b/i;

// Video/recording extensions — if your DB has video files
const RECORDING_EXT_RE = /\.(mp4|mov|avi|mkv|wmv|webm|m4v|3gp|flv)$/i;

function heuristicIsScreenshot(filename, fullPath) {
  if (SCREENSHOT_FILENAME_RE.test(filename)) return true;
  if (SCREENSHOT_FILENAME2_RE.test(filename)) return true;
  if (RECORDING_EXT_RE.test(filename)) return true;
  if (fullPath && SCREENSHOT_FOLDER_RE.test(fullPath)) return true;
  return false;
}

// ── Ensure DB columns ──────────────────────────────────────────────────────
async function ensureColumns() {
  for (const sql of [
    "ALTER TABLE photos ADD COLUMN is_screenshot INTEGER DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN screenshot_scanned INTEGER DEFAULT 0",
  ]) {
    try { await dbRun(sql); }
    catch (err) { if (!/duplicate column/i.test(err?.message || "")) throw err; }
  }
  await dbRun("CREATE INDEX IF NOT EXISTS idx_photos_is_screenshot ON photos(is_screenshot)");
}

// ── Load thumbnail as base64 ───────────────────────────────────────────────
function loadThumb(thumbPath) {
  try {
    if (!thumbPath) return null;
    const abs = path.isAbsolute(thumbPath) ? thumbPath : path.join(THUMB_DIR, thumbPath);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs).toString("base64");
  } catch { return null; }
}

// ── Gemini batch classifier ────────────────────────────────────────────────
async function classifyBatch(photos) {
  const parts = [];
  parts.push({
    text:
      "You are a photo classifier. For each numbered image below, answer YES or NO only: " +
      "Is this image a screenshot (a capture of a computer screen, phone screen, app, website, " +
      "chat, game, code editor, or any digital UI), OR a screen recording thumbnail? " +
      "Answer one line per image: 1:YES or 1:NO (no other text).",
  });

  let included = 0;
  const indexMap = [];
  for (const photo of photos) {
    const b64 = loadThumb(photo.thumbnail_path);
    if (!b64) continue;
    included++;
    indexMap.push(photo);
    parts.push({ text: `Image ${included}:` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
  }

  if (included === 0) return photos.map(() => false);

  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0, maxOutputTokens: 128 },
  };

  let text = "";
  try {
    const res = await globalThis.fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (data?.error) console.warn("Gemini error:", data.error.message);
  } catch (err) {
    console.warn("Gemini batch error:", err.message);
    return photos.map(() => false);
  }

  const results = new Map();
  for (const line of text.split(/\n/)) {
    const m = line.match(/^(\d+)\s*:\s*(YES|NO)/i);
    if (m) results.set(parseInt(m[1], 10), m[2].toUpperCase() === "YES");
  }
  return indexMap.map((_, i) => results.get(i + 1) ?? false);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  await ensureColumns();

  let query = `
    SELECT id, filename, full_path, thumbnail_path
    FROM photos
    WHERE is_deleted = 0
  `;
  if (!ALL) query += " AND (screenshot_scanned = 0 OR screenshot_scanned IS NULL)";
  query += " ORDER BY id ASC";
  if (LIMIT > 0) query += ` LIMIT ${LIMIT}`;

  const photos = await dbAll(query);
  console.log(`Photos to scan: ${photos.length}${DRY_RUN ? " (DRY RUN)" : ""}`);

  let heuristicHits = 0, aiHits = 0, processed = 0, errors = 0;

  // Pass 1: heuristics
  const needsAI = [];
  for (const photo of photos) {
    if (heuristicIsScreenshot(photo.filename, photo.full_path)) {
      heuristicHits++;
      if (!DRY_RUN) {
        await dbRun(
          "UPDATE photos SET is_screenshot = 1, screenshot_scanned = 1 WHERE id = ?",
          [photo.id]
        );
      } else {
        console.log(`  [heuristic] ${photo.filename}`);
      }
      processed++;
    } else {
      needsAI.push(photo);
    }
  }
  console.log(`Heuristic matches: ${heuristicHits}`);

  // Pass 2: Gemini Vision
  console.log(`Sending ${needsAI.length} photos to Gemini in batches of ${BATCH_SIZE}…`);
  for (let i = 0; i < needsAI.length; i += BATCH_SIZE) {
    const batch = needsAI.slice(i, i + BATCH_SIZE);
    let results;
    try {
      results = await classifyBatch(batch);
    } catch (err) {
      console.warn(`Batch ${i} failed:`, err.message);
      results = batch.map(() => false);
      errors++;
    }

    for (let j = 0; j < batch.length; j++) {
      const photo = batch[j];
      const isSS = results[j];
      if (!DRY_RUN) {
        await dbRun(
          "UPDATE photos SET is_screenshot = ?, screenshot_scanned = 1 WHERE id = ?",
          [isSS ? 1 : 0, photo.id]
        );
      }
      if (isSS) {
        aiHits++;
        if (DRY_RUN) console.log(`  [AI] ${photo.filename}`);
      }
      processed++;
    }

    if (processed % 200 === 0 || i + BATCH_SIZE >= needsAI.length) {
      process.stdout.write(
        `\r  Progress: ${processed}/${photos.length} | screenshots: ${heuristicHits + aiHits} | errors: ${errors}   `
      );
    }

    if (i + BATCH_SIZE < needsAI.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n\nDone!`);
  console.log(`  Heuristic: ${heuristicHits}`);
  console.log(`  AI:        ${aiHits}`);
  console.log(`  Total:     ${heuristicHits + aiHits} screenshots/recordings found`);
  console.log(`  Errors:    ${errors}`);

  await db.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

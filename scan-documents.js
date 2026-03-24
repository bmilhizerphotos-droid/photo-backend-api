/**
 * scan-documents.js
 * Uses Gemini 2.0 Flash Lite (FREE tier) to classify photos as documents.
 * Free tier limits: 30 requests/min, 1,500 requests/day — no cost.
 * Reads thumbnails from thumb-cache/, sends them in batches,
 * and writes is_document=1 on matched photos.
 *
 * Usage:
 *   node scan-documents.js             # process unscanned photos
 *   node scan-documents.js --all       # rescan everything
 *   node scan-documents.js --limit 100 # only process N photos
 *   node scan-documents.js --dry-run   # show what would be marked, no writes
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import { db, dbRun, dbAll } from "./db.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
// gemini-2.0-flash-lite = FREE tier (30 RPM, 1500 RPD, no billing required)
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent";
const THUMB_DIR = path.resolve("thumb-cache");
const BATCH_SIZE = 8;   // photos per request (8 images × ~1KB each = well within limits)
const DELAY_MS = 2100;  // 2.1s between batches → ~28 req/min (free tier cap: 30 RPM)

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
const DOC_FILENAME_RE =
  /\b(scan|scann|receipt|invoice|document|doc|contract|letter|statement|form|ticket|boarding|tax|w2|1099|check|cheque|certificate|permit|license|id[_-]card|passport|insurance)\b/i;

const DOC_FOLDER_RE =
  /\b(scan|scann|receipt|invoice|document|doc|contract|statement|tax|forms|papers)\b/i;

function heuristicIsDocument(filename, fullPath) {
  if (DOC_FILENAME_RE.test(filename)) return true;
  if (fullPath && DOC_FOLDER_RE.test(fullPath)) return true;
  return false;
}

// ── Ensure DB column ───────────────────────────────────────────────────────
async function ensureColumn() {
  try {
    await dbRun("ALTER TABLE photos ADD COLUMN is_document INTEGER DEFAULT 0");
    await dbRun("ALTER TABLE photos ADD COLUMN document_scanned INTEGER DEFAULT 0");
    console.log("Added is_document and document_scanned columns.");
  } catch (err) {
    if (!/duplicate column/i.test(err?.message || "")) throw err;
  }
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_photos_is_document ON photos(is_document)"
  );
}

// ── Load thumbnail as base64 ───────────────────────────────────────────────
function loadThumb(thumbPath) {
  try {
    if (!thumbPath) return null;
    const abs = path.isAbsolute(thumbPath) ? thumbPath : path.join(THUMB_DIR, thumbPath);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs).toString("base64");
  } catch {
    return null;
  }
}

// ── Call Gemini on a batch of photos ──────────────────────────────────────
async function classifyBatch(photos) {
  // Build parts: for each photo include the thumbnail + a reference label
  const parts = [];

  parts.push({
    text:
      "You are a photo classifier. For each numbered image below, answer exactly YES or NO: " +
      "Is this image primarily a photo of a document, screenshot, scan, receipt, invoice, form, certificate, " +
      "ticket, letter, or any other text-heavy paper/screen artifact? " +
      "Answer one line per image in the format: 1:YES or 1:NO (no other text).",
  });

  let included = 0;
  const indexMap = []; // index in parts → photo
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
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    console.warn("Gemini batch error:", err.message);
    return photos.map(() => false);
  }

  // Parse "1:YES\n2:NO\n3:YES\n..." into boolean array
  const results = new Map();
  for (const line of text.split(/\n/)) {
    const m = line.match(/^(\d+)\s*:\s*(YES|NO)/i);
    if (m) results.set(parseInt(m[1], 10), m[2].toUpperCase() === "YES");
  }

  return indexMap.map((_, i) => results.get(i + 1) ?? false);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  await ensureColumn();

  // Build query
  let query = `
    SELECT id, filename, full_path, thumbnail_path
    FROM photos
    WHERE is_deleted = 0
  `;
  if (!ALL) {
    query += " AND (document_scanned = 0 OR document_scanned IS NULL)";
  }
  query += " ORDER BY id ASC";
  if (LIMIT > 0) query += ` LIMIT ${LIMIT}`;

  const photos = await dbAll(query);
  console.log(`Photos to scan: ${photos.length}${DRY_RUN ? " (DRY RUN)" : ""}`);

  let heuristicHits = 0;
  let aiHits = 0;
  let processed = 0;
  let errors = 0;

  // ── Pass 1: heuristics ─────────────────────────────────────────────────
  const needsAI = [];
  for (const photo of photos) {
    if (heuristicIsDocument(photo.filename, photo.full_path)) {
      heuristicHits++;
      if (!DRY_RUN) {
        await dbRun(
          "UPDATE photos SET is_document = 1, document_scanned = 1 WHERE id = ?",
          [photo.id]
        );
      }
      processed++;
    } else {
      needsAI.push(photo);
    }
  }
  console.log(`Heuristic matches: ${heuristicHits}`);

  // ── Pass 2: Gemini Vision on remaining ─────────────────────────────────
  console.log(`Sending ${needsAI.length} photos to Gemini in batches of ${BATCH_SIZE}…`);

  for (let i = 0; i < needsAI.length; i += BATCH_SIZE) {
    const batch = needsAI.slice(i, i + BATCH_SIZE);
    let results;
    try {
      results = await classifyBatch(batch);
    } catch (err) {
      console.warn(`Batch ${i}–${i + BATCH_SIZE} failed:`, err.message);
      results = batch.map(() => false);
      errors++;
    }

    for (let j = 0; j < batch.length; j++) {
      const photo = batch[j];
      const isDoc = results[j];
      if (!DRY_RUN) {
        await dbRun(
          "UPDATE photos SET is_document = ?, document_scanned = 1 WHERE id = ?",
          [isDoc ? 1 : 0, photo.id]
        );
      }
      if (isDoc) {
        aiHits++;
        if (DRY_RUN) console.log(`  [AI] Would mark: ${photo.filename}`);
      }
      processed++;
    }

    if (processed % 200 === 0 || i + BATCH_SIZE >= needsAI.length) {
      process.stdout.write(
        `\r  Progress: ${processed}/${photos.length} | documents: ${heuristicHits + aiHits} | errors: ${errors}   `
      );
    }

    // Rate-limit delay
    if (i + BATCH_SIZE < needsAI.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n\nDone!`);
  console.log(`  Heuristic: ${heuristicHits}`);
  console.log(`  AI:        ${aiHits}`);
  console.log(`  Total:     ${heuristicHits + aiHits} documents found`);
  console.log(`  Errors:    ${errors}`);

  await db.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

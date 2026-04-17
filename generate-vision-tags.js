/**
 * generate-vision-tags.js
 *
 * Auto-tag all family photos using Google Gemini 2.5 Flash Vision.
 * Analyzes each photo thumbnail and generates 10-15 searchable tags
 * (scene, location, activities, objects, occasions, conditions).
 *
 * Tags are stored in photo_tags (added_by='gemini-vision') and merged into
 * photo_captions.keywords so the FTS search index also benefits.
 *
 * The script is fully resumable — it skips photos that already have
 * gemini-vision tags. Run multiple times to continue where you left off.
 *
 * Usage:
 *   node generate-vision-tags.js                          # all untagged photos
 *   node generate-vision-tags.js --limit 20 --dry-run    # preview, no writes
 *   node generate-vision-tags.js --limit 2000            # batch of 2000
 *   node generate-vision-tags.js --force                 # retag already-tagged
 *   node generate-vision-tags.js --concurrency 3 --rpm 12
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

// ── Manual .env parsing (no dotenv dependency — matches regenerate-memories.js) ──
const __dir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dir, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { dbGet, dbAll, dbRun } from "./db.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const GEMINI_MODEL       = "gemini-2.5-flash";
const GEMINI_URL         = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const THUMB_CACHE_DIR    = path.join(__dir, "thumb-cache");
const MAX_RETRIES        = 2;
const INITIAL_BACKOFF_MS = 3000;
const REQUEST_TIMEOUT_MS = 30000;
const getApiKey          = () => process.env.GEMINI_API_KEY || "";

// Non-JPEG originals we CAN safely send as fallback (when no thumb cache entry)
const SAFE_FALLBACK_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// Formats Sharp can convert to JPEG on the fly (Gemini cannot accept these natively)
const SHARP_CONVERT_EXTS = new Set([".heic", ".heif", ".tiff", ".tif", ".gif"]);

// ── Arg parsing ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArgVal(name, defaultVal) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : defaultVal;
}
const LIMIT       = parseInt(getArgVal("--limit", "0"), 10);      // 0 = no limit
const OFFSET      = parseInt(getArgVal("--offset", "0"), 10);
const CONCURRENCY = parseInt(getArgVal("--concurrency", "2"), 10);
const RPM_LIMIT   = parseInt(getArgVal("--rpm", "10"), 10);
const DRY_RUN     = args.includes("--dry-run");
const FORCE       = args.includes("--force");

// ── Shared rate limiter ───────────────────────────────────────────────────────
// Uses a rolling 60-second window shared across all concurrent workers.
const _rateWindow = [];
async function acquireRateLimit() {
  const windowMs = 60000;
  // Purge timestamps outside the window
  const now = Date.now();
  while (_rateWindow.length > 0 && now - _rateWindow[0] >= windowMs) _rateWindow.shift();
  if (_rateWindow.length >= RPM_LIMIT) {
    const waitMs = windowMs - (Date.now() - _rateWindow[0]) + 150;
    await new Promise((r) => setTimeout(r, waitMs));
    return acquireRateLimit(); // re-check after waiting
  }
  _rateWindow.push(Date.now());
}

// ── Gemini Vision call ────────────────────────────────────────────────────────
const VISION_PROMPT = `Analyze this family photo and return ONLY a valid JSON array of 10-15 lowercase tags.
No markdown, no code fences, no explanation — only the JSON array.

Include tags from these categories as applicable:
- Setting/location: beach, mountains, kitchen, park, pool, church, backyard, restaurant, living room, school, yard, forest, lake
- Activities: swimming, eating, dancing, hiking, playing, cooking, opening gifts, blowing candles, running, reading
- Objects: birthday cake, christmas tree, dog, cat, balloons, presents, bonfire, pumpkin, fireplace
- Occasions: birthday, christmas, halloween, thanksgiving, wedding, graduation, easter, vacation, reunion
- Conditions: indoor, outdoor, night, winter, snow, summer, sunny, rainy

Example response (array only, no other text): ["beach","outdoor","swimming","summer","vacation","sunny","children","playing","family"]`;

function parseTagsArray(text) {
  if (!text) return null;
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((t) => typeof t === "string" && t.length >= 2 && t.length <= 50)
        .map((t) => t.toLowerCase().trim())
        .slice(0, 20);
    }
  } catch { /* fall through */ }
  // Try to find an array anywhere in the response
  const match = stripped.match(/\[[\s\S]+?\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        return arr
          .filter((t) => typeof t === "string" && t.length >= 2)
          .map((t) => t.toLowerCase().trim())
          .slice(0, 20);
      }
    } catch { /* ignore */ }
  }
  return null;
}

async function callGeminiVision(base64, mimeType = "image/jpeg") {
  const parts = [
    { inline_data: { mime_type: mimeType, data: base64 } },
    { text: VISION_PROMPT },
  ];

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(
        `${GEMINI_URL}?key=${encodeURIComponent(getApiKey())}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 512,
              // Disable thinking — tag extraction doesn't need reasoning and
              // thinking tokens consume the output budget, causing MAX_TOKENS truncation.
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(tid);

      if (!res.ok) {
        const errText = await res.text();
        lastError = new Error(`Gemini ${res.status}: ${errText.substring(0, 200)}`);
        if ([429, 500, 503].includes(res.status)) continue;
        throw lastError;
      }

      const data = await res.json();
      const text         = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const finishReason = data.candidates?.[0]?.finishReason;

      // Safety filter blocked the image — skip immediately, no retries
      if (data.promptFeedback?.blockReason) {
        return null;
      }

      if (finishReason === "MAX_TOKENS") {
        lastError = new Error(`Response truncated (MAX_TOKENS) — thinking used too many tokens`);
        continue;
      }

      const tags = parseTagsArray(text);
      if (!tags || tags.length === 0) {
        lastError = new Error(`Empty/unparseable response: ${text?.substring(0, 100)}`);
        continue;
      }
      return tags;
    } catch (err) {
      clearTimeout(tid);
      if (err.name === "AbortError") { lastError = new Error("Gemini timed out"); continue; }
      lastError = err;
      if (attempt < MAX_RETRIES) continue;
    }
  }
  return null; // all retries exhausted
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function upsertTagsForPhoto(photoId, tags) {
  let added = 0;
  for (const rawTag of tags) {
    const t = rawTag.trim().toLowerCase();
    if (!t || t.length < 2 || t.length > 50) continue;
    await dbRun(`INSERT OR IGNORE INTO tags (name, type) VALUES (?, 'ai')`, [t]);
    const tag = await dbGet(`SELECT id FROM tags WHERE name = ? AND type = 'ai'`, [t]);
    if (!tag) continue;
    const result = await dbRun(
      `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, added_by, added_at)
       VALUES (?, ?, 'gemini-vision', datetime('now'))`,
      [photoId, tag.id]
    );
    if (result.changes > 0) added++;
  }
  return added;
}

async function updatePhotoCaptions(photoId, tags) {
  const keywords = tags.join(",");
  await dbRun(
    `INSERT INTO photo_captions (photo_id, caption, keywords, updated_at)
     VALUES (?, COALESCE((SELECT caption FROM photo_captions WHERE photo_id = ?), ''), ?, datetime('now'))
     ON CONFLICT(photo_id) DO UPDATE SET
       keywords = CASE
         WHEN photo_captions.keywords IS NULL OR photo_captions.keywords = ''
           THEN excluded.keywords
         ELSE photo_captions.keywords || ',' || excluded.keywords
       END,
       updated_at = datetime('now')`,
    [photoId, photoId, keywords]
  );
}

// ── Concurrency runner (from prewarm-heic-thumbs.js) ─────────────────────────
async function runWithConcurrency(tasks, concurrency, fn) {
  let i = 0;
  let done = 0;
  const results = new Array(tasks.length);

  return new Promise((resolve) => {
    function next() {
      if (i >= tasks.length) {
        if (done === tasks.length) resolve(results);
        return;
      }
      const idx = i++;
      fn(tasks[idx])
        .then((r) => {
          results[idx] = r;
          done++;
          next();
          if (done === tasks.length) resolve(results);
        })
        .catch((err) => {
          results[idx] = { status: "error", error: err.message };
          done++;
          next();
          if (done === tasks.length) resolve(results);
        });
    }
    for (let j = 0; j < Math.min(concurrency, tasks.length); j++) next();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!getApiKey()) {
    console.error("ERROR: GEMINI_API_KEY not set. Add it to .env or set it in the environment.");
    process.exit(1);
  }

  // Build photo query — resume-safe by default
  const resumeFilter = FORCE
    ? ""
    : `AND NOT EXISTS (
        SELECT 1 FROM photo_tags pt
        JOIN tags t ON t.id = pt.tag_id
        WHERE pt.photo_id = p.id AND pt.added_by = 'gemini-vision'
      )`;
  const limitClause  = LIMIT > 0 ? `LIMIT ${LIMIT}` : "";
  const offsetClause = OFFSET > 0 ? `OFFSET ${OFFSET}` : "";

  const photos = await dbAll(
    `SELECT p.id, p.full_path, p.filename
     FROM photos p
     WHERE p.is_deleted = 0
     ${resumeFilter}
     ORDER BY p.id ASC
     ${limitClause} ${offsetClause}`
  );

  if (photos.length === 0) {
    console.log("No photos to process — all already have gemini-vision tags.");
    console.log("Use --force to retag already-tagged photos.");
    process.exit(0);
  }

  const totalInDb = (await dbGet("SELECT COUNT(*) AS c FROM photos WHERE is_deleted = 0")).c;
  const etaMins   = Math.round(photos.length / RPM_LIMIT);
  console.log("\nGemini Vision Tag Generator");
  console.log("=".repeat(40));
  console.log(`  Photos to tag : ${photos.length.toLocaleString()} (of ${totalInDb.toLocaleString()} active)`);
  console.log(`  Model         : ${GEMINI_MODEL}`);
  console.log(`  Rate limit    : ${RPM_LIMIT} RPM`);
  console.log(`  Concurrency   : ${CONCURRENCY}`);
  console.log(`  Dry run       : ${DRY_RUN}`);
  console.log(`  Force retag   : ${FORCE}`);
  console.log(`  ETA           : ~${etaMins} min`);
  console.log("");

  const startTime = Date.now();
  let tagged = 0, tagsAdded = 0, skipped = 0, errors = 0;

  await runWithConcurrency(photos, CONCURRENCY, async (row) => {
    // Determine image source: prefer thumb-cache, fall back to original for safe exts,
    // or use Sharp to convert unsupported formats (HEIC, TIFF, GIF, etc.) to JPEG.
    const thumbPath       = path.join(THUMB_CACHE_DIR, `${row.id}.jpg`);
    let imagePath         = null;
    let mimeType          = "image/jpeg";
    let useSharpConvert   = false;

    if (fs.existsSync(thumbPath)) {
      imagePath = thumbPath;
    } else if (row.full_path && fs.existsSync(row.full_path)) {
      const ext = path.extname(row.full_path).toLowerCase();
      if (SAFE_FALLBACK_EXTS.has(ext)) {
        imagePath = row.full_path;
        mimeType  = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      } else if (SHARP_CONVERT_EXTS.has(ext)) {
        imagePath       = row.full_path;
        mimeType        = "image/jpeg";
        useSharpConvert = true;
      }
    }

    if (!imagePath) {
      skipped++;
      updateProgress(tagged, skipped, errors, photos.length, tagsAdded, startTime);
      return { status: "no-image" };
    }

    try {
      const buf    = useSharpConvert
        ? await sharp(imagePath).rotate().jpeg({ quality: 80 }).toBuffer()
        : fs.readFileSync(imagePath);
      const base64 = buf.toString("base64");

      await acquireRateLimit();
      const tags = await callGeminiVision(base64, mimeType);

      if (!tags) {
        skipped++;
        updateProgress(tagged, skipped, errors, photos.length, tagsAdded, startTime);
        return { status: "blocked-or-failed" };
      }

      if (DRY_RUN) {
        tagged++;
        if (tagged <= 5) {
          // Show first 5 in dry-run for visibility
          process.stdout.write(`\n  [DRY-RUN] id=${row.id} ${row.filename}: ${tags.join(", ")}\n`);
        }
        updateProgress(tagged, skipped, errors, photos.length, tagsAdded, startTime);
        return { status: "dry-run", tags };
      }

      const added = await upsertTagsForPhoto(row.id, tags);
      await updatePhotoCaptions(row.id, tags);
      tagsAdded += added;
      tagged++;

      updateProgress(tagged, skipped, errors, photos.length, tagsAdded, startTime);
      return { status: "ok", tagCount: tags.length };
    } catch (err) {
      errors++;
      updateProgress(tagged, skipped, errors, photos.length, tagsAdded, startTime);
      return { status: "error", error: err.message };
    }
  });

  // Rebuild FTS index after batch
  if (!DRY_RUN && tagged > 0) {
    process.stdout.write("\n");
    console.log("\nRebuilding FTS search index...");
    try {
      await dbRun(`INSERT INTO photo_search_fts(photo_search_fts) VALUES('rebuild')`);
      console.log("FTS index rebuilt.");
    } catch (err) {
      console.warn("FTS rebuild warning:", err.message);
    }
  }

  const totalSec = (Date.now() - startTime) / 1000;
  process.stdout.write("\n");
  console.log("\n" + "=".repeat(40));
  console.log(`Vision Tagging ${DRY_RUN ? "(DRY RUN) " : ""}Complete`);
  console.log("=".repeat(40));
  console.log(`  Tagged   : ${tagged.toLocaleString()} photos`);
  console.log(`  Tags added: ${tagsAdded.toLocaleString()} new tag links`);
  console.log(`  Skipped  : ${skipped.toLocaleString()} (no image available)`);
  console.log(`  Errors   : ${errors.toLocaleString()}`);
  console.log(`  Time     : ${(totalSec / 60).toFixed(1)} min`);
  if (DRY_RUN) console.log("\n  (Dry run — no DB changes were made)");
  process.exit(0);
}

function updateProgress(tagged, skipped, errors, total, tagsAdded, startTime) {
  const elapsed  = ((Date.now() - startTime) / 1000).toFixed(0);
  const done     = tagged + skipped + errors;
  const pct      = ((done / total) * 100).toFixed(1);
  const elapsedMin = (Date.now() - startTime) / 60000;
  const ratePerMin = tagged > 0 ? (tagged / elapsedMin).toFixed(1) : "0";
  const remaining  = total - done;
  const etaSec     = tagged > 0
    ? Math.round(remaining / (tagged / ((Date.now() - startTime) / 1000)))
    : "?";

  process.stdout.write(
    `\r[${elapsed}s] ${done}/${total} (${pct}%) | tagged:${tagged} skip:${skipped} err:${errors} | tags:${tagsAdded} | ${ratePerMin}/min | ETA:${etaSec}s   `
  );
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});

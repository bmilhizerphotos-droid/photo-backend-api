/**
 * regenerate-memories.js
 *
 * Re-enrich all memories (or a limited batch) with Gemini Vision + Nominatim.
 * Processes memories that still have generic "Photos from..." titles.
 * Safely resumable — run multiple times until all memories are enriched.
 *
 * Usage:
 *   node regenerate-memories.js              # process all unenriched (7s/memory)
 *   node regenerate-memories.js --limit=50   # process next 50
 *   node regenerate-memories.js --force      # re-enrich ALL memories (overwrite existing)
 *   node regenerate-memories.js --test=3     # test with 3 memories, verbose output
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Manual .env parsing (no dotenv dependency) ──────────────────────────────
const __dir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dir, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { dbAll, dbGet, dbRun } from "./db.js";
import { generateNarrativeWithVision, generateNarrative } from "./gemini-narrative.js";

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const limitArg  = args.find((a) => a.startsWith("--limit="));
const testArg   = args.find((a) => a.startsWith("--test="));
const forceFlag = args.includes("--force");
const LIMIT     = testArg  ? parseInt(testArg.split("=")[1], 10)
                : limitArg ? parseInt(limitArg.split("=")[1], 10)
                : 0; // 0 = no limit
const VERBOSE   = !!testArg;

// ── Rate limiting ────────────────────────────────────────────────────────────
const GEMINI_DELAY_MS   = 7000;  // 7s → ~8.5 RPM (under 10 RPM free tier)
const NOMINATIM_DELAY_MS = 1200; // 1.2s → safe under Nominatim 1 req/sec limit
const geocodeCache = new Map();

async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS));
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`,
      { headers: { "User-Agent": "FamilyPhotoApp/1.0 (family-photo-gallery)" },
        signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) { geocodeCache.set(key, null); return null; }
    const d = await res.json();
    const addr = d.address || {};
    const city  = addr.city || addr.town || addr.village || addr.county || null;
    const state = addr.state || null;
    const label = city && state ? `${city}, ${state}` : city || state || null;
    geocodeCache.set(key, label);
    return label;
  } catch {
    geocodeCache.set(key, null);
    return null;
  }
}

// ── Photo selection ──────────────────────────────────────────────────────────
function selectPhotoPaths(rows, n = 4) {
  if (rows.length <= n) return rows.map((r) => r.full_path).filter(Boolean);
  const step = (rows.length - 1) / (n - 1);
  const selected = new Set();
  for (let i = 0; i < n; i++) selected.add(Math.round(i * step));
  return [...selected].map((i) => rows[i].full_path).filter(Boolean);
}

// ── Metadata gathering ───────────────────────────────────────────────────────
function getSeason(date) {
  const m = date.getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "fall";
  return "winter";
}

async function buildMetadata(memory) {
  const photos = await dbAll(
    `SELECT p.full_path, p.filename, p.date_taken FROM photos p
     JOIN memory_photos mp ON p.id = mp.photo_id
     WHERE mp.memory_id = ? AND p.full_path IS NOT NULL AND p.full_path != ''
     ORDER BY p.date_taken ASC`,
    [memory.id]
  );

  const people = await dbAll(
    `SELECT DISTINCT pe.name FROM people pe
     JOIN photo_people pp ON pe.id = pp.person_id
     JOIN memory_photos mp ON pp.photo_id = mp.photo_id
     WHERE mp.memory_id = ?`,
    [memory.id]
  );

  const tags = await dbAll(
    `SELECT t.name FROM tags t
     JOIN photo_tags pt ON t.id = pt.tag_id
     JOIN memory_photos mp ON pt.photo_id = mp.photo_id
     WHERE mp.memory_id = ?
     GROUP BY t.name ORDER BY COUNT(*) DESC LIMIT 12`,
    [memory.id]
  );

  const startDate = new Date(memory.event_date_start);
  const endDate   = new Date(memory.event_date_end);
  const spanDays  = Math.round((endDate - startDate) / 86400000);

  let avgHour = 12;
  if (photos.length > 0) {
    const total = photos.filter((p) => p.date_taken).reduce((s, p) => s + new Date(p.date_taken).getHours(), 0);
    avgHour = Math.round(total / Math.max(1, photos.filter((p) => p.date_taken).length));
  }
  const timeOfDay = avgHour < 6 ? "night" : avgHour < 12 ? "morning" : avgHour < 17 ? "afternoon" : avgHour < 21 ? "evening" : "night";

  return {
    eventDateStart: memory.event_date_start,
    eventDateEnd:   memory.event_date_end,
    centerLat:  memory.center_lat,
    centerLng:  memory.center_lng,
    photoCount: memory.photo_count,
    people:     people.map((p) => p.name),
    tags:       tags.map((t) => t.name),
    filenames:  photos.slice(0, 8).map((p) => p.filename),
    photoPaths: photos.map((p) => p.full_path),
    season:     getSeason(startDate),
    dayOfWeek:  startDate.toLocaleDateString("en-US", { weekday: "long" }),
    timeOfDay,
    spanDays,
  };
}

// ── Apply AI tags to photos in this memory ──────────────────────────────────
async function applyTags(memoryId, aiTags) {
  if (!aiTags?.length) return;
  const photoRows = await dbAll(`SELECT photo_id FROM memory_photos WHERE memory_id = ?`, [memoryId]);
  for (const rawTag of aiTags) {
    const t = rawTag.trim().toLowerCase();
    if (!t || t.length < 2 || t.length > 40) continue;
    await dbRun(`INSERT OR IGNORE INTO tags (name, type) VALUES (?, 'ai')`, [t]);
    const tag = await dbGet(`SELECT id FROM tags WHERE name = ?`, [t]);
    if (!tag) continue;
    for (const { photo_id } of photoRows) {
      await dbRun(
        `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, added_by, added_at) VALUES (?, ?, 'ai', datetime('now'))`,
        [photo_id, tag.id]
      );
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const whereClause = forceFlag
    ? "" // re-enrich everything
    : "WHERE m.title IS NULL OR m.title LIKE 'Photos from%'";

  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : "";

  const memories = await dbAll(
    `SELECT id, title, event_date_start, event_date_end, center_lat, center_lng, photo_count
     FROM memories m
     ${whereClause}
     ORDER BY event_date_start DESC
     ${limitClause}`
  );

  if (memories.length === 0) {
    console.log("✅ All memories are already enriched! Nothing to do.");
    console.log("   Use --force to re-enrich all memories.");
    process.exit(0);
  }

  const total = (await dbAll("SELECT COUNT(*) as c FROM memories"))[0].c;
  const etaMins = Math.round((memories.length * GEMINI_DELAY_MS) / 60000);
  console.log(`\n🧠 Regenerating ${memories.length} memories (${total} total)`);
  console.log(`   Model: gemini-2.5-flash (vision) + Nominatim reverse geocoding`);
  console.log(`   Rate: 1 memory every ${GEMINI_DELAY_MS / 1000}s → ~${etaMins} min estimated\n`);

  let enriched = 0;
  let failed   = 0;
  const startTime = Date.now();

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];

    try {
      const metadata = await buildMetadata(memory);
      const photoPaths = selectPhotoPaths(
        metadata.photoPaths.map((p) => ({ full_path: p })), 4
      );

      // Reverse geocode (uses cache, delays built-in)
      const locationLabel = await reverseGeocode(metadata.centerLat, metadata.centerLng);

      // Call Gemini Vision (or text-only fallback)
      const result = photoPaths.length > 0
        ? await generateNarrativeWithVision(metadata, photoPaths, locationLabel)
        : await generateNarrative({ ...metadata, locationLabel });

      const title         = result.title || `Photos from ${new Date(metadata.eventDateStart).toLocaleDateString()}`;
      const narrative     = result.narrative || null;
      const finalLocation = result.locationLabel || locationLabel || null;

      await dbRun(
        `UPDATE memories SET title = ?, narrative = ?, location_label = ?, updated_at = datetime('now') WHERE id = ?`,
        [title, narrative, finalLocation, memory.id]
      );
      await applyTags(memory.id, result.tags);

      enriched++;

      if (VERBOSE) {
        console.log(`[${i + 1}/${memories.length}] Memory ${memory.id}`);
        console.log(`  Title:    ${title}`);
        console.log(`  Location: ${finalLocation || "(none)"}`);
        console.log(`  Tags:     ${result.tags?.join(", ") || "(none)"}`);
        console.log(`  Narrative: ${narrative?.substring(0, 100)}...`);
        console.log();
      } else if ((i + 1) % 10 === 0 || i === 0 || i === memories.length - 1) {
        const elapsed  = Math.round((Date.now() - startTime) / 60000);
        const remaining = Math.round(((memories.length - i - 1) * GEMINI_DELAY_MS) / 60000);
        const pct = Math.round(((i + 1) / memories.length) * 100);
        console.log(`  [${i + 1}/${memories.length}] ${pct}% — ${elapsed}min elapsed, ~${remaining}min left — ${title}`);
      }
    } catch (err) {
      console.error(`  ❌ Memory ${memory.id} failed:`, err.message);
      failed++;
      // Don't overwrite existing good titles on failure
      if (!memory.title || memory.title.startsWith("Photos from")) {
        const fallback = `Photos from ${new Date(memory.event_date_start).toLocaleDateString()}`;
        await dbRun(`UPDATE memories SET title = ? WHERE id = ?`, [fallback, memory.id]).catch(() => {});
      }
    }

    // Rate limit — wait between Gemini calls
    if (i < memories.length - 1) {
      await new Promise((r) => setTimeout(r, GEMINI_DELAY_MS));
    }
  }

  const totalMin = Math.round((Date.now() - startTime) / 60000);
  const remaining = memories.length - enriched - failed;
  console.log(`\n✅ Done! ${enriched} enriched, ${failed} failed in ${totalMin} min.`);
  if (remaining > 0) console.log(`   ${remaining} skipped.`);

  const stillGeneric = await dbAll("SELECT COUNT(*) as c FROM memories WHERE title LIKE 'Photos from%' OR title IS NULL");
  console.log(`   Still generic/untitled: ${stillGeneric[0].c} — run again to continue.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

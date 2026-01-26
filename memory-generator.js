/**
 * Memory Generator - clusters photos into events by date/location
 * and stores them as "memories" in the database.
 * Supports both incremental generation and full regeneration with AI enrichment.
 */

import { dbRun, dbAll, dbGet, dbBegin, dbCommit, dbRollback } from "./db.js";
import { generateNarrative } from "./gemini-narrative.js";

const TIME_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours
const DIST_THRESHOLD_KM = 30;
const MIN_PHOTOS = 3;
const MAX_PHOTOS_PER_MEMORY = 200;
const NARRATIVE_DELAY_MS = 1500; // 1.5s between Gemini calls (safe under 15 RPM)

/**
 * Haversine distance between two GPS coordinates in km
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Derive season from a Date's month
 */
function getSeason(date) {
  const m = date.getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "fall";
  return "winter";
}

/**
 * Split clusters that exceed MAX_PHOTOS_PER_MEMORY
 */
function splitLargeClusters(events) {
  const result = [];
  for (const event of events) {
    if (event.length <= MAX_PHOTOS_PER_MEMORY) {
      result.push(event);
    } else {
      for (let i = 0; i < event.length; i += MAX_PHOTOS_PER_MEMORY) {
        const chunk = event.slice(i, i + MAX_PHOTOS_PER_MEMORY);
        if (chunk.length >= MIN_PHOTOS) {
          result.push(chunk);
        }
      }
    }
  }
  return result;
}

/**
 * Cluster photos into events based on time gaps and GPS distance.
 * Returns array of photo arrays (each is an event cluster).
 */
function clusterPhotos(photos) {
  if (photos.length === 0) return [];

  const events = [];
  let currentEvent = [photos[0]];

  for (let i = 1; i < photos.length; i++) {
    const prev = photos[i - 1];
    const curr = photos[i];

    const prevTime = new Date(prev.date_taken).getTime();
    const currTime = new Date(curr.date_taken).getTime();
    const timeGap = currTime - prevTime;

    let withinDistance = true;
    if (
      prev.gps_lat != null && prev.gps_lng != null &&
      curr.gps_lat != null && curr.gps_lng != null
    ) {
      const dist = haversine(prev.gps_lat, prev.gps_lng, curr.gps_lat, curr.gps_lng);
      if (dist > DIST_THRESHOLD_KM) {
        withinDistance = false;
      }
    }

    if (timeGap <= TIME_GAP_MS && withinDistance) {
      currentEvent.push(curr);
    } else {
      events.push(currentEvent);
      currentEvent = [curr];
    }
  }
  events.push(currentEvent);

  // Filter out small events and split large ones
  return splitLargeClusters(events.filter((ev) => ev.length >= MIN_PHOTOS));
}

/**
 * Create a memory record and its photo associations in the database.
 * Returns the new memory ID or null on failure.
 */
async function createMemoryRecord(event) {
  const dateStart = event[0].date_taken;
  const dateEnd = event[event.length - 1].date_taken;

  const gpsPhotos = event.filter((p) => p.gps_lat != null && p.gps_lng != null);
  let centerLat = null;
  let centerLng = null;
  if (gpsPhotos.length > 0) {
    centerLat = gpsPhotos.reduce((s, p) => s + p.gps_lat, 0) / gpsPhotos.length;
    centerLng = gpsPhotos.reduce((s, p) => s + p.gps_lng, 0) / gpsPhotos.length;
  }

  const coverPhotoId = event[0].id;

  try {
    await dbBegin();

    const result = await dbRun(
      `INSERT INTO memories (cover_photo_id, event_date_start, event_date_end, center_lat, center_lng, photo_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [coverPhotoId, dateStart, dateEnd, centerLat, centerLng, event.length]
    );

    const memoryId = result.lastID;

    for (const photo of event) {
      await dbRun(
        `INSERT OR IGNORE INTO memory_photos (memory_id, photo_id) VALUES (?, ?)`,
        [memoryId, photo.id]
      );
    }

    await dbCommit();
    return memoryId;
  } catch (err) {
    await dbRollback();
    console.error(`Failed to create memory for event starting ${dateStart}:`, err.message);
    return null;
  }
}

/**
 * Gather rich metadata for a memory to send to Gemini.
 */
async function gatherMetadata(memoryId) {
  const memory = await dbGet(
    `SELECT id, event_date_start, event_date_end, center_lat, center_lng, photo_count
     FROM memories WHERE id = ?`,
    [memoryId]
  );
  if (!memory) return null;

  const people = await dbAll(
    `SELECT DISTINCT p.name
     FROM people p
     JOIN photo_people pp ON p.id = pp.person_id
     JOIN memory_photos mp ON pp.photo_id = mp.photo_id
     WHERE mp.memory_id = ?`,
    [memoryId]
  );

  const tags = await dbAll(
    `SELECT t.name, COUNT(*) as cnt
     FROM tags t
     JOIN photo_tags pt ON t.id = pt.tag_id
     JOIN memory_photos mp ON pt.photo_id = mp.photo_id
     WHERE mp.memory_id = ?
     GROUP BY t.name
     ORDER BY cnt DESC
     LIMIT 15`,
    [memoryId]
  );

  const fileRows = await dbAll(
    `SELECT p.filename FROM photos p
     JOIN memory_photos mp ON p.id = mp.photo_id
     WHERE mp.memory_id = ?
     LIMIT 10`,
    [memoryId]
  );

  const timePhotos = await dbAll(
    `SELECT p.date_taken FROM photos p
     JOIN memory_photos mp ON p.id = mp.photo_id
     WHERE mp.memory_id = ? AND p.date_taken IS NOT NULL`,
    [memoryId]
  );

  const startDate = new Date(memory.event_date_start);
  const endDate = new Date(memory.event_date_end);
  const spanDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  let avgHour = 12;
  if (timePhotos.length > 0) {
    const totalHours = timePhotos.reduce((sum, p) => sum + new Date(p.date_taken).getHours(), 0);
    avgHour = Math.round(totalHours / timePhotos.length);
  }
  const timeOfDay = avgHour < 6 ? "night" : avgHour < 12 ? "morning" : avgHour < 17 ? "afternoon" : avgHour < 21 ? "evening" : "night";

  return {
    eventDateStart: memory.event_date_start,
    eventDateEnd: memory.event_date_end,
    centerLat: memory.center_lat,
    centerLng: memory.center_lng,
    photoCount: memory.photo_count,
    filenames: fileRows.map((f) => f.filename),
    people: people.map((p) => p.name),
    tags: tags.map((t) => t.name),
    season: getSeason(startDate),
    dayOfWeek: startDate.toLocaleDateString("en-US", { weekday: "long" }),
    timeOfDay,
    spanDays,
  };
}

/**
 * Apply AI-generated tags to all photos in a memory.
 */
async function applyTagsToMemory(memoryId, aiTags) {
  if (!aiTags || !Array.isArray(aiTags) || aiTags.length === 0) return 0;

  const photoRows = await dbAll(
    `SELECT photo_id FROM memory_photos WHERE memory_id = ?`,
    [memoryId]
  );
  if (photoRows.length === 0) return 0;

  let applied = 0;
  for (const rawTag of aiTags) {
    const normalized = rawTag.trim().toLowerCase();
    if (!normalized || normalized.length < 2 || normalized.length > 30) continue;
    if (/[^a-z0-9\s\-]/.test(normalized)) continue;

    await dbRun(`INSERT OR IGNORE INTO tags (name, type) VALUES (?, 'ai')`, [normalized]);
    const tag = await dbGet(`SELECT id FROM tags WHERE name = ? AND type = 'ai'`, [normalized]);
    if (!tag) continue;

    for (const { photo_id } of photoRows) {
      await dbRun(
        `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, added_by, added_at) VALUES (?, ?, 'ai', datetime('now'))`,
        [photo_id, tag.id]
      );
    }
    applied++;
  }
  return applied;
}

/**
 * Enrich a single memory with AI-generated title, narrative, location, and tags.
 * Returns true on success (including fallback).
 */
async function enrichMemory(memoryId) {
  const metadata = await gatherMetadata(memoryId);
  if (!metadata) return false;

  const result = await generateNarrative(metadata);

  const title = result.title || `Photos from ${new Date(metadata.eventDateStart).toLocaleDateString()}`;
  const narrative = result.narrative || null;
  const locationLabel = result.locationLabel || null;

  await dbRun(
    `UPDATE memories SET title = ?, narrative = ?, location_label = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [title, narrative, locationLabel, memoryId]
  );

  // Apply AI-generated tags to photos in this memory
  await applyTagsToMemory(memoryId, result.tags);

  return true;
}

/**
 * Incremental generation: Cluster photos into events and store them as memories.
 * Skips date ranges that already have memories. Does NOT generate narratives.
 * Returns { created, skipped }.
 */
export async function generateMemories() {
  const photos = await dbAll(`
    SELECT id, filename, date_taken, gps_lat, gps_lng
    FROM photos
    WHERE date_taken IS NOT NULL
    ORDER BY date_taken ASC
  `);

  if (photos.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const validEvents = clusterPhotos(photos);

  // Get existing memory date ranges to avoid duplicates
  const existingMemories = await dbAll(`SELECT event_date_start, event_date_end FROM memories`);
  const existingRanges = existingMemories.map((m) => ({
    start: new Date(m.event_date_start).getTime(),
    end: new Date(m.event_date_end).getTime(),
  }));

  let created = 0;
  let skipped = 0;

  for (const event of validEvents) {
    const startMs = new Date(event[0].date_taken).getTime();
    const endMs = new Date(event[event.length - 1].date_taken).getTime();

    const isDuplicate = existingRanges.some((r) => {
      const overlapStart = Math.max(r.start, startMs);
      const overlapEnd = Math.min(r.end, endMs);
      return overlapEnd >= overlapStart;
    });

    if (isDuplicate) {
      skipped++;
      continue;
    }

    const memoryId = await createMemoryRecord(event);
    if (memoryId) created++;
  }

  return { created, skipped };
}

/**
 * Generate Gemini narratives for memories that don't have titles yet.
 * Processes up to 10 memories per run.
 * Returns number of narratives generated.
 */
export async function generateNarratives() {
  const memories = await dbAll(
    `SELECT id FROM memories WHERE title IS NULL LIMIT 10`
  );

  let generated = 0;
  for (let i = 0; i < memories.length; i++) {
    try {
      const ok = await enrichMemory(memories[i].id);
      if (ok) generated++;
    } catch (err) {
      console.error(`Failed to enrich memory ${memories[i].id}:`, err.message);
      // Fallback title so we don't retry endlessly
      const mem = await dbGet(`SELECT event_date_start FROM memories WHERE id = ?`, [memories[i].id]);
      const fallbackTitle = `Photos from ${new Date(mem?.event_date_start || Date.now()).toLocaleDateString()}`;
      await dbRun(`UPDATE memories SET title = ?, updated_at = datetime('now') WHERE id = ?`, [fallbackTitle, memories[i].id]);
      generated++;
    }

    if (i < memories.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, NARRATIVE_DELAY_MS));
    }
  }

  return generated;
}

/**
 * Full regeneration: Delete all memories, re-cluster from scratch,
 * and enrich every memory with AI (no cap).
 * Returns { created, enriched }.
 */
export async function regenerateAllMemories() {
  // Step 1: Reset
  console.log("🗑️  Deleting all existing memories...");
  await dbBegin();
  try {
    await dbRun("DELETE FROM memory_photos");
    await dbRun("DELETE FROM memories");
    await dbCommit();
    console.log("✅ All memories deleted.");
  } catch (err) {
    await dbRollback();
    throw new Error("Failed to reset memories: " + err.message);
  }

  // Step 2: Cluster
  console.log("📊 Clustering photos...");
  const photos = await dbAll(`
    SELECT id, filename, date_taken, gps_lat, gps_lng
    FROM photos
    WHERE date_taken IS NOT NULL
    ORDER BY date_taken ASC
  `);

  if (photos.length === 0) {
    return { created: 0, enriched: 0, message: "No photos with date_taken found" };
  }

  const validEvents = clusterPhotos(photos);
  console.log(`📊 Found ${validEvents.length} events from ${photos.length} photos.`);

  // Step 3: Create memory records
  const memoryIds = [];
  for (const event of validEvents) {
    const memoryId = await createMemoryRecord(event);
    if (memoryId) memoryIds.push(memoryId);
  }
  console.log(`✅ Created ${memoryIds.length} memories.`);

  // Step 4: Enrich ALL memories with AI (no cap)
  console.log(`🧠 Enriching ${memoryIds.length} memories with AI...`);
  let enriched = 0;
  for (let i = 0; i < memoryIds.length; i++) {
    const memoryId = memoryIds[i];
    try {
      const ok = await enrichMemory(memoryId);
      if (ok) {
        enriched++;
        console.log(`  ✅ [${i + 1}/${memoryIds.length}] Memory ${memoryId} enriched.`);
      }
    } catch (err) {
      console.error(`  ❌ [${i + 1}/${memoryIds.length}] Memory ${memoryId} failed:`, err.message);
      // Set fallback title
      const mem = await dbGet(`SELECT event_date_start FROM memories WHERE id = ?`, [memoryId]);
      const fallbackTitle = `Photos from ${new Date(mem?.event_date_start || Date.now()).toLocaleDateString()}`;
      await dbRun(`UPDATE memories SET title = ?, updated_at = datetime('now') WHERE id = ?`, [fallbackTitle, memoryId]);
    }

    // Rate limit between Gemini calls
    if (i < memoryIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, NARRATIVE_DELAY_MS));
    }
  }

  console.log(`✅ Enrichment complete: ${enriched}/${memoryIds.length} memories enriched.`);
  return { created: memoryIds.length, enriched };
}

export default { generateMemories, generateNarratives, regenerateAllMemories };

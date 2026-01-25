/**
 * Memory Generator - clusters photos into events by date/location
 * and stores them as "memories" in the database.
 */

import { dbRun, dbAll, dbGet, dbBegin, dbCommit, dbRollback } from "./db.js";
import { generateNarrative } from "./gemini-narrative.js";

const TIME_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours
const DIST_THRESHOLD_KM = 50;
const MIN_PHOTOS = 5;
const MAX_NARRATIVES_PER_RUN = 10;
const NARRATIVE_DELAY_MS = 1000;

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
 * Cluster photos into events and store them as memories.
 * Returns { created, skipped }.
 */
export async function generateMemories() {
  // 1. Fetch all photos with date_taken, ordered chronologically
  const photos = await dbAll(`
    SELECT id, date_taken, gps_lat, gps_lng
    FROM photos
    WHERE date_taken IS NOT NULL
    ORDER BY date_taken ASC
  `);

  if (photos.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // 2. Walk photos and group into events
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

  // 3. Filter out small events
  const validEvents = events.filter((ev) => ev.length >= MIN_PHOTOS);

  // 4. Get existing memory date ranges to avoid duplicates
  const existingMemories = await dbAll(`SELECT event_date_start, event_date_end FROM memories`);
  const existingRanges = existingMemories.map((m) => ({
    start: new Date(m.event_date_start).getTime(),
    end: new Date(m.event_date_end).getTime(),
  }));

  let created = 0;
  let skipped = 0;

  for (const event of validEvents) {
    const dateStart = event[0].date_taken;
    const dateEnd = event[event.length - 1].date_taken;
    const startMs = new Date(dateStart).getTime();
    const endMs = new Date(dateEnd).getTime();

    // Skip if an existing memory overlaps significantly
    const isDuplicate = existingRanges.some((r) => {
      const overlapStart = Math.max(r.start, startMs);
      const overlapEnd = Math.min(r.end, endMs);
      return overlapEnd >= overlapStart;
    });

    if (isDuplicate) {
      skipped++;
      continue;
    }

    // Compute GPS centroid from photos that have coordinates
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
      created++;
    } catch (err) {
      await dbRollback();
      console.error(`Failed to create memory for event starting ${dateStart}:`, err.message);
    }
  }

  return { created, skipped };
}

/**
 * Generate Gemini narratives for memories that don't have titles yet.
 * Processes up to MAX_NARRATIVES_PER_RUN memories.
 * Returns number of narratives generated.
 */
export async function generateNarratives() {
  const memories = await dbAll(
    `SELECT id, event_date_start, event_date_end, center_lat, center_lng, photo_count
     FROM memories
     WHERE title IS NULL
     LIMIT ?`,
    [MAX_NARRATIVES_PER_RUN]
  );

  let generated = 0;

  for (const memory of memories) {
    // Gather people present in this memory's photos
    const people = await dbAll(
      `SELECT DISTINCT p.name
       FROM people p
       JOIN photo_people pp ON p.id = pp.person_id
       JOIN memory_photos mp ON pp.photo_id = mp.photo_id
       WHERE mp.memory_id = ?`,
      [memory.id]
    );

    // Gather top tags
    const tags = await dbAll(
      `SELECT t.name, COUNT(*) as cnt
       FROM tags t
       JOIN photo_tags pt ON t.id = pt.tag_id
       JOIN memory_photos mp ON pt.photo_id = mp.photo_id
       WHERE mp.memory_id = ?
       GROUP BY t.name
       ORDER BY cnt DESC
       LIMIT 10`,
      [memory.id]
    );

    const startDate = new Date(memory.event_date_start);
    const season = getSeason(startDate);

    const metadata = {
      eventDateStart: memory.event_date_start,
      eventDateEnd: memory.event_date_end,
      centerLat: memory.center_lat,
      centerLng: memory.center_lng,
      photoCount: memory.photo_count,
      people: people.map((p) => p.name),
      tags: tags.map((t) => t.name),
      season,
    };

    try {
      const result = await generateNarrative(metadata);

      const title = result.title || `Photos from ${startDate.toLocaleDateString()}`;
      const narrative = result.narrative || null;
      const locationLabel = result.locationLabel || null;

      await dbRun(
        `UPDATE memories SET title = ?, narrative = ?, location_label = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [title, narrative, locationLabel, memory.id]
      );

      generated++;
    } catch (err) {
      console.error(`Failed to generate narrative for memory ${memory.id}:`, err.message);
      // Fallback: set a default title so we don't retry endlessly
      const fallbackTitle = `Photos from ${startDate.toLocaleDateString()}`;
      await dbRun(
        `UPDATE memories SET title = ?, updated_at = datetime('now') WHERE id = ?`,
        [fallbackTitle, memory.id]
      );
      generated++;
    }

    // Rate limit between calls
    if (memories.indexOf(memory) < memories.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, NARRATIVE_DELAY_MS));
    }
  }

  return generated;
}

export default { generateMemories, generateNarratives };

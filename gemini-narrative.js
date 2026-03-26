/**
 * Gemini Narrative Generator — Vision-enhanced
 * Uses Gemini 2.5 Flash with actual photo images for accurate memory titles/narratives.
 * Falls back to text-only when no photos are available.
 */

import sharp from "sharp";
import fs from "fs";

// Read lazily so standalone scripts can parse .env before these functions are called
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const getApiKey = () => process.env.GEMINI_API_KEY || "";

const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 3000;
const REQUEST_TIMEOUT_MS = 30000;
const THUMB_SIZE = 512; // px — max dimension for vision thumbnails
const MAX_PHOTOS_PER_REQUEST = 4;

/**
 * Load an image, resize to thumbnail, return as base64 JPEG. Returns null on failure.
 */
async function photoToBase64(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const buf = await sharp(filePath)
      .rotate()
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/**
 * Parse JSON from a Gemini response string, handling markdown code fences.
 */
function parseGeminiJson(text) {
  if (!text) return null;
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]+\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

/**
 * Core Gemini API call with retry/backoff.
 */
async function callGemini(parts) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`  ↩ Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms...`);
      await new Promise((r) => setTimeout(r, backoff));
    }

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(getApiKey())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 3000,
            // Note: do NOT use responseMimeType with vision — causes truncation
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(tid);

      if (!res.ok) {
        const errText = await res.text();
        lastError = new Error(`Gemini ${res.status}: ${errText.substring(0, 200)}`);
        if ([429, 500, 503].includes(res.status)) continue;
        throw lastError;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const finishReason = data.candidates?.[0]?.finishReason;

      if (finishReason === "MAX_TOKENS" && !text) {
        lastError = new Error("Response truncated with no content");
        continue;
      }

      const parsed = parseGeminiJson(text);
      if (!parsed) {
        lastError = new Error(`JSON parse failed: ${text?.substring(0, 100)}`);
        continue;
      }

      return {
        title: typeof parsed.title === "string" ? parsed.title.trim() : null,
        narrative: typeof parsed.narrative === "string" ? parsed.narrative.trim() : null,
        locationLabel: typeof parsed.locationLabel === "string" ? parsed.locationLabel.trim() : null,
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === "string") : [],
      };
    } catch (err) {
      clearTimeout(tid);
      if (err.name === "AbortError") { lastError = new Error("Gemini timed out"); continue; }
      lastError = err;
      if (attempt < MAX_RETRIES) continue;
    }
  }

  console.error("  ✗ Gemini failed:", lastError?.message);
  return null;
}

/**
 * Generate memory narrative using Gemini Vision (photos + metadata).
 * @param {Object} metadata  - Event metadata (dates, GPS, people, tags, etc.)
 * @param {string[]} photoPaths - File system paths to representative photos (up to 4 used)
 * @param {string|null} locationLabel - Pre-fetched place name from reverse geocoding
 */
export async function generateNarrativeWithVision(metadata, photoPaths = [], locationLabel = null) {
  if (!getApiKey()) return fallbackResult(metadata);

  // Build image parts from file paths
  const parts = [];
  let imagesAdded = 0;
  for (const p of photoPaths.slice(0, MAX_PHOTOS_PER_REQUEST)) {
    const b64 = await photoToBase64(p);
    if (b64) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: b64 } });
      imagesAdded++;
    }
  }

  const dateStr = new Date(metadata.eventDateStart).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const spanLabel = (metadata.spanDays ?? 0) > 0
    ? `${metadata.spanDays} day${metadata.spanDays > 1 ? "s" : ""}`
    : "single day";
  const gpsStr = metadata.centerLat != null
    ? `${metadata.centerLat.toFixed(4)}, ${metadata.centerLng.toFixed(4)}`
    : null;

  const ctx = [
    `Date: ${dateStr} (${spanLabel}, ${metadata.season})`,
    `Time of day: ${metadata.timeOfDay || "unknown"}`,
    gpsStr ? `GPS: ${gpsStr}` : null,
    locationLabel ? `Location: ${locationLabel}` : null,
    `Photo count: ${metadata.photoCount}`,
    metadata.people?.length > 0 ? `People: ${metadata.people.join(", ")}` : null,
    metadata.tags?.length > 0 ? `Existing tags: ${metadata.tags.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  const visionNote = imagesAdded > 0
    ? `You are viewing ${imagesAdded} representative photo${imagesAdded > 1 ? "s" : ""} from this family event. Use what you actually see to inform your response.`
    : "No photos available — base your response on the metadata only.";

  const prompt = `You are a warm family photo album narrator. ${visionNote}

Event context:
${ctx}

Respond with ONLY valid JSON (no markdown, no code fences):
{"title":"3-7 evocative words based on what you see","narrative":"2 warm sentences referencing specific visual details and people by name if known","locationLabel":"City, State or specific place name (null if unknown)","tags":["5 to 8 lowercase descriptive tags based on activities/setting/mood visible in photos"]}`;

  parts.push({ text: prompt });

  const result = await callGemini(parts);
  if (!result) return fallbackResult(metadata);

  return {
    title: result.title || fallbackTitle(metadata),
    narrative: result.narrative || null,
    locationLabel: result.locationLabel || locationLabel || null,
    tags: result.tags || [],
  };
}

/**
 * Text-only narrative generation (no vision). Used as fallback or in bulk text mode.
 */
export async function generateNarrative(metadata) {
  if (!getApiKey()) return fallbackResult(metadata);

  const gpsInfo = metadata.centerLat != null
    ? `${metadata.centerLat.toFixed(4)}, ${metadata.centerLng.toFixed(4)}`
    : "No GPS data";

  const prompt = `You are a warm family photo album narrator.

Given metadata about a group of photos from the same event, produce:
1. title — 3-7 evocative words. Be specific: use names, places, or activities when available.
2. narrative — Nostalgic 2-3 sentence story. Reference people by name. Mention season/time/location.
3. locationLabel — Human-readable place name from GPS. "City, State" format. null if no GPS.
4. tags — 5-10 descriptive lowercase tags. Activities, settings, moods, occasions.

Respond with ONLY valid JSON (no markdown, no code fences):
{"title":"...","narrative":"...","locationLabel":"...","tags":["..."]}

Metadata:
- Date: ${metadata.eventDateStart} to ${metadata.eventDateEnd} (${metadata.spanDays ?? 0}d, ${metadata.season})
- Time: ${metadata.dayOfWeek || ""} ${metadata.timeOfDay || ""}
- GPS: ${gpsInfo}
- Photos: ${metadata.photoCount}
- People: ${metadata.people?.join(", ") || "Unknown"}
- Tags: ${metadata.tags?.join(", ") || "None"}
- Filenames: ${metadata.filenames?.join(", ") || "None"}`;

  const result = await callGemini([{ text: prompt }]);
  if (!result) return fallbackResult(metadata);

  return {
    title: result.title || fallbackTitle(metadata),
    narrative: result.narrative || null,
    locationLabel: result.locationLabel || null,
    tags: result.tags || [],
  };
}

function fallbackTitle(metadata) {
  return `Photos from ${new Date(metadata.eventDateStart).toLocaleDateString()}`;
}
function fallbackResult(metadata) {
  return { title: fallbackTitle(metadata), narrative: null, locationLabel: null, tags: [] };
}

export default { generateNarrative, generateNarrativeWithVision };

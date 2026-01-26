/**
 * Gemini Narrative Generator
 * Calls Gemini 2.0 Flash to generate titles, narratives, location labels, and tags for memories.
 * Includes retry with exponential backoff and request timeouts.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 2000;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Generate a narrative for a memory event.
 * @param {Object} metadata
 * @param {string} metadata.eventDateStart
 * @param {string} metadata.eventDateEnd
 * @param {number|null} metadata.centerLat
 * @param {number|null} metadata.centerLng
 * @param {number} metadata.photoCount
 * @param {string[]} metadata.people
 * @param {string[]} metadata.tags
 * @param {string} metadata.season
 * @param {string[]} [metadata.filenames]
 * @param {string} [metadata.dayOfWeek]
 * @param {string} [metadata.timeOfDay]
 * @param {number} [metadata.spanDays]
 * @returns {Promise<{title: string, narrative: string|null, locationLabel: string|null, tags: string[]}>}
 */
export async function generateNarrative(metadata) {
  if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY not set — using fallback title");
    return {
      title: `Photos from ${new Date(metadata.eventDateStart).toLocaleDateString()}`,
      narrative: null,
      locationLabel: null,
      tags: [],
    };
  }

  const gpsInfo =
    metadata.centerLat != null && metadata.centerLng != null
      ? `${metadata.centerLat.toFixed(4)}, ${metadata.centerLng.toFixed(4)}`
      : "No GPS data";

  const peopleInfo =
    metadata.people.length > 0 ? metadata.people.join(", ") : "Unknown";

  const tagsInfo =
    metadata.tags && metadata.tags.length > 0 ? metadata.tags.join(", ") : "None";

  const filenamesInfo =
    metadata.filenames && metadata.filenames.length > 0
      ? metadata.filenames.join(", ")
      : "None";

  const spanLabel =
    metadata.spanDays != null
      ? metadata.spanDays === 0
        ? "single day"
        : `${metadata.spanDays} day${metadata.spanDays > 1 ? "s" : ""}`
      : "unknown";

  const dayInfo = metadata.dayOfWeek || "unknown";
  const timeInfo = metadata.timeOfDay || "unknown";

  const prompt = `You are a warm family photo album narrator.

Given metadata about a group of photos from the same event, produce:
1. title — A short evocative title (3-7 words). Be specific: use names, places, or activities when available. Avoid generic titles like "Family Fun" or "A Day Out".
2. narrative — A nostalgic 2-3 sentence story. Reference specific people by name if listed. Mention the setting (season, time of day, location). Write as if captioning a scrapbook page.
3. locationLabel — A human-readable place name derived from the GPS coordinates. Use the format "City, State" or "Neighborhood, City" if possible. Return null if no GPS data.
4. tags — An array of 5-10 descriptive tags for this event. Lowercase. Focus on: activities, settings, moods, occasions, themes. Examples: "birthday party", "beach", "sunset", "family dinner", "hiking", "holiday".

Respond in JSON only: { "title": "...", "narrative": "...", "locationLabel": "...", "tags": ["..."] }

Event metadata:
- Date range: ${metadata.eventDateStart} to ${metadata.eventDateEnd}
- Duration: ${spanLabel}
- Day: ${dayInfo}
- Time of day: ${timeInfo}
- Season: ${metadata.season}
- GPS centroid: ${gpsInfo}
- Photos: ${metadata.photoCount}
- Sample filenames: ${filenamesInfo}
- People present: ${peopleInfo}
- Existing photo tags: ${tagsInfo}`;

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`  Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: 400,
              responseMimeType: "application/json",
            },
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        lastError = new Error(`Gemini API ${response.status}: ${errText}`);
        // Retry on 429, 500, 503
        if ([429, 500, 503].includes(response.status)) {
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Try regex extraction as fallback
        const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
        const narrativeMatch = text.match(/"narrative"\s*:\s*"([^"]+)"/);
        const locationMatch = text.match(/"locationLabel"\s*:\s*"([^"]+)"/);
        parsed = {
          title: titleMatch?.[1] || null,
          narrative: narrativeMatch?.[1] || null,
          locationLabel: locationMatch?.[1] || null,
          tags: [],
        };
      }

      return {
        title: parsed.title || null,
        narrative: parsed.narrative || null,
        locationLabel: parsed.locationLabel || null,
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        lastError = new Error("Gemini request timed out");
        continue;
      }
      lastError = err;
      // Only retry on timeout/server errors, not client errors
      if (attempt < MAX_RETRIES) continue;
    }
  }

  console.error("Gemini narrative generation failed after retries:", lastError?.message);
  return {
    title: `Photos from ${new Date(metadata.eventDateStart).toLocaleDateString()}`,
    narrative: null,
    locationLabel: null,
    tags: [],
  };
}

export default { generateNarrative };

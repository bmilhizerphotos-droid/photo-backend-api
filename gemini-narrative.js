/**
 * Gemini Narrative Generator
 * Calls Gemini 2.0 Flash to generate titles, narratives, and location labels for memories.
 * Uses fetch() directly — no npm dependency needed.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

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
 * @returns {Promise<{title: string, narrative: string|null, locationLabel: string|null}>}
 */
export async function generateNarrative(metadata) {
  if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY not set — using fallback title");
    return {
      title: `Photos from ${new Date(metadata.eventDateStart).toLocaleDateString()}`,
      narrative: null,
      locationLabel: null,
    };
  }

  const gpsInfo =
    metadata.centerLat != null && metadata.centerLng != null
      ? `${metadata.centerLat.toFixed(4)}, ${metadata.centerLng.toFixed(4)}`
      : "No GPS data";

  const peopleInfo =
    metadata.people.length > 0 ? metadata.people.join(", ") : "Unknown";

  const tagsInfo =
    metadata.tags.length > 0 ? metadata.tags.join(", ") : "None";

  const prompt = `You are a family photo album narrator. Given metadata about a cluster of photos from the same event, generate:
1. A short, evocative title (3-7 words)
2. A nostalgic 2-3 sentence story describing the moment

Respond in JSON only: { "title": "...", "narrative": "...", "locationLabel": "..." }
(locationLabel = best-guess place name from coordinates, or null if no GPS)

Event metadata:
- Date range: ${metadata.eventDateStart} to ${metadata.eventDateEnd}
- GPS centroid: ${gpsInfo}
- Number of photos: ${metadata.photoCount}
- People present: ${peopleInfo}
- Photo tags: ${tagsInfo}
- Season: ${metadata.season}`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API ${response.status}: ${errText}`);
    }

    const data = await response.json();

    // Extract text from the Gemini response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    const parsed = JSON.parse(text);

    return {
      title: parsed.title || null,
      narrative: parsed.narrative || null,
      locationLabel: parsed.locationLabel || null,
    };
  } catch (err) {
    console.error("Gemini narrative generation failed:", err.message);
    return {
      title: `Photos from ${new Date(metadata.eventDateStart).toLocaleDateString()}`,
      narrative: null,
      locationLabel: null,
    };
  }
}

export default { generateNarrative };

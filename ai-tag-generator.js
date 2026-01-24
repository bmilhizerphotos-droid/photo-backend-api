/**
 * AI Tag Generator using Ollama
 * Generates descriptive tags for photos based on metadata and existing tags
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral:latest';

/**
 * Generate AI tags for a photo based on its metadata
 * @param {Object} photoData - Photo metadata
 * @param {string} photoData.filename - Photo filename
 * @param {string[]} photoData.existingTags - Existing user/ai tags
 * @param {string[]} photoData.people - People tagged in the photo
 * @param {string} photoData.dateTaken - Date the photo was taken
 * @param {Object} photoData.exif - EXIF metadata (camera, lens, etc.)
 * @returns {Promise<string[]>} - Array of generated tag names
 */
export async function generateTags(photoData) {
  const { filename, existingTags = [], people = [], dateTaken, exif = {} } = photoData;

  // Build context from metadata
  const contextParts = [];

  // Filename often contains useful info
  const cleanFilename = filename
    .replace(/\.[^.]+$/, '') // Remove extension
    .replace(/[-_]/g, ' ')   // Replace separators with spaces
    .replace(/\d{8,}/g, '')  // Remove long number sequences (dates, IDs)
    .trim();

  if (cleanFilename && cleanFilename.length > 2) {
    contextParts.push(`Filename hints: ${cleanFilename}`);
  }

  // Existing tags provide context
  if (existingTags.length > 0) {
    contextParts.push(`Existing tags: ${existingTags.join(', ')}`);
  }

  // People in the photo
  if (people.length > 0) {
    contextParts.push(`People in photo: ${people.join(', ')}`);
  }

  // Date information
  if (dateTaken) {
    const date = new Date(dateTaken);
    if (!isNaN(date.getTime())) {
      const month = date.toLocaleString('en-US', { month: 'long' });
      const year = date.getFullYear();
      const season = getSeason(date);
      contextParts.push(`Date: ${month} ${year} (${season})`);
    }
  }

  // Camera/EXIF metadata
  if (exif.Make || exif.Model) {
    contextParts.push(`Camera: ${[exif.Make, exif.Model].filter(Boolean).join(' ')}`);
  }
  if (exif.LensModel) {
    contextParts.push(`Lens: ${exif.LensModel}`);
  }

  // If we have very little context, return empty (can't generate meaningful tags)
  if (contextParts.length === 0) {
    return [];
  }

  const context = contextParts.join('\n');

  const prompt = `You are a photo tagging assistant. Based on the following metadata about a photo, suggest relevant descriptive tags.

${context}

Rules:
- Generate 3-8 relevant tags
- Tags should be lowercase, single words or short phrases (2-3 words max)
- Focus on: events, activities, locations, occasions, moods, themes
- Do NOT repeat existing tags
- Do NOT include people's names as tags (they're already tagged separately)
- Do NOT include technical camera information as tags
- Respond with ONLY a comma-separated list of tags, nothing else

Tags:`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 100,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    const rawTags = data.response || '';

    // Parse and normalize tags
    const tags = parseTags(rawTags, existingTags);
    return tags;

  } catch (error) {
    console.error('AI tag generation failed:', error.message);
    return [];
  }
}

/**
 * Parse and normalize tags from LLM response
 */
function parseTags(rawResponse, existingTags = []) {
  const existingLower = new Set(existingTags.map(t => t.toLowerCase()));

  return rawResponse
    .split(/[,\n]/)
    .map(tag => tag.trim().toLowerCase())
    .filter(tag => {
      // Must be non-empty
      if (!tag || tag.length < 2) return false;
      // Must not be too long
      if (tag.length > 30) return false;
      // Must not be a duplicate
      if (existingLower.has(tag)) return false;
      // Must not contain special characters (except spaces and hyphens)
      if (!/^[a-z0-9\s-]+$/.test(tag)) return false;
      // Must not be just numbers
      if (/^\d+$/.test(tag)) return false;
      return true;
    })
    .slice(0, 8); // Max 8 tags
}

/**
 * Get season from date
 */
function getSeason(date) {
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

/**
 * Check if Ollama is available
 */
export async function checkOllamaHealth() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get available Ollama models
 */
export async function getAvailableModels() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.models || [];
  } catch {
    return [];
  }
}

export default {
  generateTags,
  checkOllamaHealth,
  getAvailableModels,
};

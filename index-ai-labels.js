#!/usr/bin/env node

import { dbAll, dbRun } from './db.js';
import sharp from 'sharp';
import fs from 'fs';

const args = process.argv.slice(2);
const options = {
  limit: 200,
  offset: 0,
  rescan: false,
  verbose: false,
  concurrency: 3,
  retry: 1,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--limit':
      options.limit = parseInt(args[++i], 10) || 200;
      break;
    case '--offset':
      options.offset = parseInt(args[++i], 10) || 0;
      break;
    case '--rescan':
      options.rescan = true;
      break;
    case '--verbose':
    case '-v':
      options.verbose = true;
      break;
    case '--concurrency':
      options.concurrency = Math.max(1, parseInt(args[++i], 10) || 3);
      break;
    case '--retry':
      options.retry = Math.max(0, parseInt(args[++i], 10) || 1);
      break;
    case '--help':
    case '-h':
      console.log(`\nAI Label Indexer\n\nUsage: node index-ai-labels.js [options]\n\nOptions:\n  --limit N     Max photos to process (default: 200)\n  --offset N    Skip first N photos\n  --rescan      Re-index photos that already have AI labels\n  --verbose     Show detailed logs\n  --concurrency N  Parallel workers (default: 3)\n  --retry N     Retry attempts per photo (default: 1)\n`);
      process.exit(0);
  }
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const VISION_MODEL = process.env.SEARCH_VISION_MODEL || process.env.OLLAMA_VISION_MODEL || 'llava:7b';

function normalizeLabel(label) {
  return String(label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function extractFirstJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // continue
    }
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function parseLabelResponse(raw) {
  const parsed = extractFirstJsonObject(raw);
  if (Array.isArray(parsed?.labels)) {
    return parsed.labels;
  }

  // Fallback: parse loose comma-separated text when model ignores JSON instructions
  return String(raw || '')
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 15)
    .map((name) => ({ name, confidence: 0.55 }));
}

async function imageToBase64Jpeg(filePath) {
  const buf = await sharp(filePath)
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 65 })
    .toBuffer();

  return buf.toString('base64');
}

function fileExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

async function withRetries(fn, attempts) {
  let lastError = null;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
      }
    }
  }
  throw lastError || new Error('retry failed');
}

async function generateLabels(photoPath) {
  const imageBase64 = await imageToBase64Jpeg(photoPath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const prompt = `Analyze this image for photo search.
Return ONLY valid JSON in the format:
{"labels":[{"name":"dog","confidence":0.95}]}

Rules:
- 5 to 15 labels
- include animals, objects, scene type, activity, event
- lowercase labels
- confidence between 0 and 1`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt,
        images: [imageBase64],
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 200,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const data = await res.json();
    const raw = String(data?.response || '').trim();
    if (!raw) return [];

    const labels = parseLabelResponse(raw);

    const cleaned = labels
      .map((x) => ({
        name: normalizeLabel(x?.name),
        confidence: Number(x?.confidence),
      }))
      .filter((x) => x.name.length >= 2)
      .map((x) => ({
        ...x,
        confidence: Number.isFinite(x.confidence)
          ? Math.max(0, Math.min(1, x.confidence))
          : 0.6,
      }))
      .slice(0, 20);

    return cleaned;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function getPhotosToProcess() {
  const where = options.rescan
    ? 'WHERE full_path IS NOT NULL'
    : `WHERE full_path IS NOT NULL
       AND id NOT IN (SELECT DISTINCT photo_id FROM photo_ai_labels)`;

  return dbAll(
    `SELECT id, filename, full_path
     FROM photos
     ${where}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [options.limit, options.offset]
  );
}

async function processPhoto(photo, progress, total) {
  if (options.verbose) {
    console.log(`[${progress}/${total}] ${photo.id} ${photo.filename}`);
  }

  if (!photo.full_path || !fileExists(photo.full_path)) return false;

  const labels = await withRetries(() => generateLabels(photo.full_path), options.retry);
  if (!labels.length) return false;

  await dbRun('DELETE FROM photo_ai_labels WHERE photo_id = ?', [photo.id]);

  for (const label of labels) {
    await dbRun(
      `INSERT OR IGNORE INTO photo_ai_labels (photo_id, label, confidence, model, source)
       VALUES (?, ?, ?, ?, 'vision')`,
      [photo.id, label.name, label.confidence, VISION_MODEL]
    );
  }

  return true;
}

async function main() {
  const photos = await getPhotosToProcess();
  console.log(`Indexing AI labels for ${photos.length} photos (model=${VISION_MODEL}, concurrency=${options.concurrency})`);

  let processed = 0;
  let labeled = 0;

  const queue = [...photos];
  const workers = Array.from({ length: Math.max(1, options.concurrency) }, async () => {
    while (queue.length > 0) {
      const photo = queue.shift();
      if (!photo) break;
      processed++;
      try {
        const ok = await processPhoto(photo, processed, photos.length);
        if (ok) labeled++;
      } catch (err) {
        if (options.verbose) {
          console.error(`Failed photo ${photo.id}:`, err.message);
        }
      }
    }
  });

  await Promise.all(workers);

  console.log(`Done. Processed: ${processed}, labeled: ${labeled}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('AI label indexing failed:', err.message);
  process.exit(1);
});

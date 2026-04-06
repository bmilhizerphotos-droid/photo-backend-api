/**
 * prewarm-heic-thumbs.js
 * Pre-generates thumbnails for all HEIC/HEIF photos that don't have a cached
 * thumbnail yet.  Run once to populate thumb-cache/ so every HEIC photo serves
 * instantly instead of triggering a slow first-time conversion.
 *
 * Usage:
 *   node prewarm-heic-thumbs.js              # process all uncached HEIC photos
 *   node prewarm-heic-thumbs.js --limit 100  # only process first 100 (test)
 *   node prewarm-heic-thumbs.js --concurrency 2
 */

import fs from "fs";
import path from "path";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dbAll } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const THUMB_CACHE_DIR = path.join(__dirname, "thumb-cache");
const HEIC_WORKER_PATH = path.join(__dirname, "heic-worker.js");

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;
const concurrency = args.includes("--concurrency")
  ? parseInt(args[args.indexOf("--concurrency") + 1])
  : 4;

if (!fs.existsSync(THUMB_CACHE_DIR)) {
  fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
}

function runHeicWorker(filePath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(HEIC_WORKER_PATH, { workerData: { filePath } });
    worker.once("message", (msg) => {
      if (msg.ok) resolve(Buffer.from(msg.jpeg));
      else reject(new Error(msg.error));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker exited ${code}`));
    });
  });
}

async function generateThumb(row) {
  const cached = path.join(THUMB_CACHE_DIR, `${row.id}.jpg`);
  if (fs.existsSync(cached)) return "cached";

  let filePath = row.full_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return "missing";
  }

  try {
    const jpegBuf = await runHeicWorker(filePath);
    const thumbBuf = await sharp(jpegBuf)
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();
    await fs.promises.writeFile(cached, thumbBuf);
    return "generated";
  } catch (err) {
    return `error: ${err.message}`;
  }
}

async function runWithConcurrency(tasks, concurrency, fn) {
  let i = 0;
  let done = 0;
  const results = [];

  return new Promise((resolve) => {
    function next() {
      if (i >= tasks.length) {
        if (done === tasks.length) resolve(results);
        return;
      }
      const idx = i++;
      fn(tasks[idx]).then((r) => {
        results[idx] = r;
        done++;
        next();
        if (done === tasks.length) resolve(results);
      }).catch((err) => {
        results[idx] = `error: ${err.message}`;
        done++;
        next();
        if (done === tasks.length) resolve(results);
      });
    }
    for (let j = 0; j < Math.min(concurrency, tasks.length); j++) next();
  });
}

async function main() {
  console.log("Loading HEIC photos from DB...");
  const rows = await dbAll(
    `SELECT id, filename, full_path FROM photos
     WHERE is_deleted = 0
       AND (LOWER(filename) LIKE '%.heic' OR LOWER(filename) LIKE '%.heif')
     ORDER BY id ASC`
  );

  // Filter to only uncached
  const uncached = rows.filter((r) => !fs.existsSync(path.join(THUMB_CACHE_DIR, `${r.id}.jpg`)));
  const toProcess = limit === Infinity ? uncached : uncached.slice(0, limit);

  console.log(`Total HEIC photos: ${rows.length}`);
  console.log(`Already cached:    ${rows.length - uncached.length}`);
  console.log(`To generate:       ${toProcess.length}`);
  console.log(`Concurrency:       ${concurrency}`);
  console.log("");

  if (toProcess.length === 0) {
    console.log("All HEIC thumbnails already cached. Nothing to do.");
    process.exit(0);
  }

  let generated = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  const results = await runWithConcurrency(toProcess, concurrency, async (row) => {
    const status = await generateThumb(row);

    if (status === "generated") generated++;
    else if (status === "cached") skipped++;
    else if (status === "missing") { skipped++; }
    else errors++;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const total = generated + skipped + errors;
    const pct = ((total / toProcess.length) * 100).toFixed(1);
    const rate = (generated / Math.max(1, (Date.now() - startTime) / 1000)).toFixed(1);
    const eta = generated > 0
      ? Math.round((toProcess.length - total) / parseFloat(rate))
      : "?";

    process.stdout.write(
      `\r[${elapsed}s] ${total}/${toProcess.length} (${pct}%) | gen:${generated} skip:${skipped} err:${errors} | ${rate}/s | ETA:${eta}s   `
    );

    return status;
  });

  console.log("\n\nDone!");
  console.log(`Generated: ${generated}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Errors:    ${errors}`);
  console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

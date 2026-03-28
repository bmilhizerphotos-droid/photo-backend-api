/**
 * scan-videos.js
 * Walks G:/Photos and indexes all video files into the photos table with is_video=1.
 * Safe to re-run — skips files already indexed by filename.
 *
 * Usage: node scan-videos.js [--dry-run] [--limit N]
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Manual .env parsing (dotenv not installed as dep)
try {
  const envText = fs.readFileSync(new URL("./.env", import.meta.url), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* no .env — fine */ }

import { dbRun, dbAll, dbGet } from "./db.js";

const PHOTO_ROOT = process.env.PHOTO_ROOT || "G:/Photos";
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".3gp", ".mkv", ".webm", ".wmv", ".flv"]);
const EXCLUDED_DIRS = new Set(["_duplicates", ".thumb", "@eaDir", "thumb-cache", "node_modules"]);
const SERVE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)));

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity;

function walkForVideos(root) {
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) results.push(full);
      }
    }
  }
  return results;
}

function sha256(filePath) {
  try {
    const hash = crypto.createHash("sha256");
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(65536);
    let pos = 0;
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
      pos += n;
      if (pos > 5 * 1024 * 1024) break; // hash first 5MB only for speed
    }
    fs.closeSync(fd);
    return hash.digest("hex") + "_partial";
  } catch { return null; }
}

async function main() {
  console.log(`🎬 Video scanner starting — PHOTO_ROOT: ${PHOTO_ROOT}`);
  if (DRY_RUN) console.log("   (dry-run mode — no DB changes)");

  // Exclude the serving directory itself
  const serveResolved = path.resolve(PHOTO_ROOT);
  const videoFiles = walkForVideos(PHOTO_ROOT)
    .filter(f => !f.startsWith(SERVE_DIR))
    .slice(0, LIMIT);

  console.log(`📂 Found ${videoFiles.length} video files on disk`);

  // Build a set of already-indexed filenames
  const indexed = new Set((await dbAll("SELECT filename FROM photos WHERE is_video=1")).map(r => r.filename));
  console.log(`📋 Already indexed: ${indexed.size} videos`);

  let added = 0, skipped = 0;

  for (const fullPath of videoFiles) {
    const filename = path.basename(fullPath);
    if (indexed.has(filename)) { skipped++; continue; }

    // Try to get file stats
    let stat;
    try { stat = fs.statSync(fullPath); } catch { skipped++; continue; }

    if (!DRY_RUN) {
      try {
        await dbRun(
          `INSERT OR IGNORE INTO photos
             (filename, filepath, full_path, is_video, created_at, modified_at)
           VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`,
          [filename, path.dirname(fullPath), fullPath]
        );
        added++;
        if (added % 100 === 0) console.log(`  ✅ ${added} added so far…`);
      } catch (e) {
        console.error(`  ❌ Failed to insert ${filename}:`, e.message);
        skipped++;
      }
    } else {
      console.log(`  [dry-run] Would add: ${filename}`);
      added++;
    }
  }

  console.log(`\n✅ Done. Added: ${added}, Skipped/already indexed: ${skipped}`);
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });

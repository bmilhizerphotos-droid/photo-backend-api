#!/usr/bin/env node
/**
 * fix-dates-from-e-drive.js
 *
 * Scans E:\ for image/video files. For every file whose name matches a photo
 * in the DB, takes the EARLIEST date across all backup copies and:
 *   1. Updates date_taken in the database.
 *   2. Updates the file modification time (mtime) of the live file in G:\Photos.
 *
 * Date sources used (fastest/most reliable first — no EXIF parsing):
 *   - File birthtime  (Windows creation date — preserved in many backup tools)
 *   - File mtime      (modification date)
 *   - Date from filename pattern (IMG_20210704_..., 2021-07-04_..., etc.)
 *   - Year from folder name
 *
 * Usage:
 *   node fix-dates-from-e-drive.js              # live run
 *   node fix-dates-from-e-drive.js --dry-run    # preview only, no writes
 *   node fix-dates-from-e-drive.js --limit 500  # process only N matched files
 *   node fix-dates-from-e-drive.js --db-only    # update DB only, skip file mtime
 */

import fs from "fs";
import path from "path";
import { dbAll, dbRun } from "./db.js";

const args = process.argv.slice(2);
const DRY_RUN    = args.includes("--dry-run");
const DB_ONLY    = args.includes("--db-only");
const limitIdx   = args.indexOf("--limit");
const LIMIT      = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;
const dirIdx     = args.indexOf("--scan-dir");
const SCAN_ROOT  = dirIdx !== -1 ? args[dirIdx + 1] : "E:\\";
const EXCLUDE_DIRS = new Set([
  path.resolve("E:\\System Volume Information"),
  path.resolve("E:\\$RECYCLE.BIN"),
  path.resolve("E:\\$Recycle.Bin"),
  path.resolve("E:\\$Application Data"),
  // Non-photo directories — skip to save time
  path.resolve("E:\\Torrents"),
  path.resolve("E:\\onedrive"),
  path.resolve("E:\\audio"),
  path.resolve("E:\\work"),
  path.resolve("E:\\Medical"),
  path.resolve("E:\\large attachments"),
  path.resolve("E:\\videos"),
  // Google Photos Takeout trees — hundreds of album subdirs, very slow on HDD
  // These files have dates from folder names already captured by dateFromFolder()
  path.resolve("E:\\all photo backup\\gphotos2"),
  path.resolve("E:\\all photo backup\\dell office 2024\\gphotos2"),
  path.resolve("E:\\all photo backup\\dell office 2024\\gphotos delete"),
  path.resolve("E:\\all photo backup\\dell office 2024\\gphotos 2023"),
  path.resolve("E:\\all photo backup\\dell office 2024\\gdrive videos"),
  path.resolve("E:\\gphotos2"),
]);

const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".heic", ".heif",
  ".gif", ".bmp", ".tiff", ".tif", ".webp",
  ".mp4", ".mov", ".m4v", ".avi", ".3gp", ".mkv",
]);

const TODAY      = new Date();
const DATE_1990  = new Date("1990-01-01");

// ── Filename-based date heuristics ───────────────────────────────────────────
const FILENAME_PATTERNS = [
  [/(\d{4})[-_](\d{2})[-_](\d{2})[ _T](\d{2})[.:_-](\d{2})[.:_-](\d{2})/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)],
  [/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)],
  [/^(\d{2})-(\d{2})-(\d{2})_(\d{2})(\d{2})/,
   (m) => {
     const yy = parseInt(m[3], 10);
     const yr = yy < 30 ? 2000 + yy : 1900 + yy;
     return new Date(`${yr}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:00`);
   }],
  [/^(\d{4})(\d{2})(\d{2})[^\d]/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}`)],
  [/(\d{4})[-_](\d{2})[-_](\d{2})/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}`)],
];

function dateFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  for (const [re, fn] of FILENAME_PATTERNS) {
    const m = base.match(re);
    if (m) {
      const d = fn(m);
      if (d && !isNaN(d) && d >= DATE_1990 && d <= TODAY) return d;
    }
  }
  return null;
}

function dateFromFolder(filePath) {
  const parts = filePath.split(/[\\/]/);
  for (const part of parts) {
    const m = part.match(/\b(19[89]\d|20[012]\d)\b/);
    if (m) {
      const d = new Date(`${m[1]}-01-01`);
      if (d <= TODAY) return d;
    }
  }
  return null;
}

function validDate(d) {
  return d && !isNaN(d) && d >= DATE_1990 && d <= TODAY ? d : null;
}

function bestDate(...dates) {
  const valid = dates.map(validDate).filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a < b ? a : b)); // earliest
}

// ── Filesystem walker ─────────────────────────────────────────────────────────
function* walkDir(root) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(path.resolve(full))) stack.push(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTS.has(ext)) yield full;
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🔍 Loading photo filenames from database...`);

  const rows = await dbAll(
    `SELECT id, filename, full_path, date_taken FROM photos WHERE is_deleted = 0`
  );

  // Build lookup: lowercase filename → array of {id, full_path, dateTaken}
  const byFilename = new Map();
  for (const row of rows) {
    const key = row.filename.toLowerCase();
    if (!byFilename.has(key)) byFilename.set(key, []);
    byFilename.get(key).push({ id: row.id, fullPath: row.full_path, dateTaken: row.date_taken });
  }

  console.log(`📂 Loaded ${rows.length} photos (${byFilename.size} unique filenames)`);
  console.log(`🔍 Scanning ${SCAN_ROOT} for backup photos (no EXIF, stat-only)...`);
  if (DRY_RUN) console.log(`⚠️  DRY RUN — no changes will be written`);
  if (DB_ONLY) console.log(`ℹ️  DB-ONLY — file mtime will not be updated`);
  console.log();

  // Single-pass: scan AND apply updates incrementally so progress isn't lost if killed
  // Track best date seen per filename across multiple backup copies
  const bestSeen = new Map(); // key → { date, applied: bool }
  let scanned     = 0;
  let matched     = 0;
  let dbUpdated   = 0;
  let dbSkipped   = 0;
  let mtimeUpdated = 0;

  for (const filePath of walkDir(SCAN_ROOT)) {
    const filename = path.basename(filePath);
    const key = filename.toLowerCase();

    scanned++;
    if (scanned % 500 === 0) {
      console.log(`  Scanned ${scanned.toLocaleString()} files, matched ${matched.toLocaleString()}, updated ${dbUpdated.toLocaleString()} DB rows ...`);
    }

    if (!byFilename.has(key)) continue;
    matched++;

    // Get dates from stat (instant — no file content reading)
    let birthtime = null, mtime = null;
    try {
      const stat = fs.statSync(filePath);
      birthtime = validDate(stat.birthtime);
      mtime     = validDate(stat.mtime);
    } catch { /* skip */ }

    const fnDate     = dateFromFilename(filename);
    const folderDate = dateFromFolder(filePath);
    const candidate  = bestDate(birthtime, mtime, fnDate, folderDate);
    if (!candidate) continue;

    // Only update if this is earlier than what we've seen before for this filename
    const prev = bestSeen.get(key);
    if (prev && candidate >= prev.date) continue;
    bestSeen.set(key, { date: candidate });

    // Apply update immediately to all matching DB rows
    const dbPhotos = byFilename.get(key);
    for (const photo of dbPhotos) {
      const currentDate = photo.dateTaken ? new Date(photo.dateTaken) : null;
      const shouldUpdateDb = !currentDate || (candidate < currentDate && candidate >= DATE_1990);

      if (shouldUpdateDb) {
        const isoDate = candidate.toISOString();
        if (!DRY_RUN) {
          await dbRun(`UPDATE photos SET date_taken = ? WHERE id = ?`, [isoDate, photo.id]);
          // Update in-memory so later passes use the new date
          photo.dateTaken = isoDate;
        }
        dbUpdated++;
        if (dbUpdated <= 10 || dbUpdated % 500 === 0) {
          console.log(
            `  ✅ #${photo.id} ${key}: ` +
            `${currentDate ? currentDate.toISOString().slice(0, 10) : "NULL"} → ${isoDate.slice(0, 10)}` +
            ` (${path.basename(path.dirname(filePath))})`
          );
        }
      } else {
        dbSkipped++;
      }

      // Update live file mtime
      if (!DB_ONLY && !DRY_RUN && photo.fullPath) {
        try {
          if (fs.existsSync(photo.fullPath)) {
            const liveStat = fs.statSync(photo.fullPath);
            if (candidate < liveStat.mtime) {
              fs.utimesSync(photo.fullPath, candidate, candidate);
              mtimeUpdated++;
            }
          }
        } catch (err) {
          console.warn(`  ⚠️  mtime failed: ${err.message}`);
        }
      }
    }

    if (LIMIT > 0 && matched >= LIMIT) {
      console.log(`\n  Reached --limit ${LIMIT}, stopping scan.`);
      break;
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`   Scanned       : ${scanned.toLocaleString()} files`);
  console.log(`   Matched       : ${matched.toLocaleString()} filenames`);
  console.log(`   DB updated    : ${dbUpdated.toLocaleString()} photos`);
  console.log(`   DB skipped    : ${dbSkipped.toLocaleString()} (already earlier or equal)`);
  console.log(`   mtime updated : ${mtimeUpdated.toLocaleString()} live files`);

  if (DRY_RUN) console.log(`\n⚠️  DRY RUN — run without --dry-run to apply changes`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

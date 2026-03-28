#!/usr/bin/env node
/**
 * fix-dates-from-backup.js
 *
 * Scans all of G:\ (excluding G:\Photos, the live serve directory) for image files.
 * For every file whose name matches a photo in the DB, takes the EARLIEST date
 * across all backup copies and updates date_taken in the database.
 *
 * Also fills in NULL date_taken entries where the backup has a valid date.
 *
 * Usage:
 *   node fix-dates-from-backup.js              # live run
 *   node fix-dates-from-backup.js --dry-run    # preview only, no DB writes
 *   node fix-dates-from-backup.js --limit 500  # process only N matched files
 */

import fs from "fs";
import path from "path";
import exifr from "exifr";
import { dbAll, dbRun } from "./db.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;

// ── Config ────────────────────────────────────────────────────────────────────
const SCAN_ROOT = "G:\\";
const EXCLUDE_DIRS = new Set([
  path.resolve("G:\\Photos"),               // live serve dir
  path.resolve("G:\\System Volume Information"),
  path.resolve("G:\\$RECYCLE.BIN"),
  path.resolve("G:\\$Recycle.Bin"),
  path.resolve("G:\\VMs"),                  // 126 GB of VM images
  path.resolve("G:\\Immich"),               // docker config, no originals
  path.resolve("G:\\APP"),                  // uploader app
  path.resolve("G:\\tools"),               // software tools
  path.resolve("G:\\website backups"),
  path.resolve("G:\\$Application Data"),
]);

const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".heic", ".heif",
  ".gif", ".bmp", ".tiff", ".tif", ".webp",
  ".mp4", ".mov", ".m4v", ".avi", ".3gp",
]);

const TODAY = new Date();

// ── Filename → date heuristics (same logic as update-exif-dates.js) ───────────
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
      if (d && !isNaN(d) && d >= new Date("1990-01-01") && d <= TODAY) return d;
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

async function dateFromExif(filePath) {
  try {
    const tags = await exifr.parse(filePath, {
      pick: ["DateTimeOriginal", "CreateDate", "DateTime", "GPSDateStamp"],
      reviveValues: true,
    });
    if (!tags) return null;
    const raw =
      tags.DateTimeOriginal || tags.CreateDate || tags.DateTime || tags.GPSDateStamp;
    if (!raw) return null;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(d) || d < new Date("1990-01-01") || d > TODAY) return null;
    return d;
  } catch {
    return null;
  }
}

function bestDate(...dates) {
  const valid = dates.filter(Boolean).filter((d) => !isNaN(d));
  if (valid.length === 0) return null;
  // Return earliest
  return valid.reduce((a, b) => (a < b ? a : b));
}

// ── Filesystem walker (iterative, skips excluded dirs) ───────────────────────
function* walkDir(root) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // permission denied etc.
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(path.resolve(full))) {
          stack.push(full);
        }
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
    `SELECT id, filename, date_taken FROM photos WHERE is_deleted = 0`
  );

  // Build lookup: lowercase filename → array of {id, date_taken}
  const byFilename = new Map();
  for (const row of rows) {
    const key = row.filename.toLowerCase();
    if (!byFilename.has(key)) byFilename.set(key, []);
    byFilename.get(key).push({ id: row.id, dateTaken: row.date_taken });
  }

  console.log(`📂 Loaded ${rows.length} photos (${byFilename.size} unique filenames)`);
  console.log(`🔍 Scanning G:\\ (excluding G:\\Photos)...`);
  if (DRY_RUN) console.log(`⚠️  DRY RUN — no changes will be written`);
  console.log();

  // Collect: filename → earliest date found in backup
  const backupDates = new Map(); // filename.lower → Date
  let scanned = 0;
  let matched = 0;

  for (const filePath of walkDir(SCAN_ROOT)) {
    const filename = path.basename(filePath);
    const key = filename.toLowerCase();

    scanned++;
    if (scanned % 1000 === 0) {
      process.stdout.write(`\r  Scanned ${scanned.toLocaleString()} files, matched ${matched.toLocaleString()} ...`);
    }

    if (!byFilename.has(key)) continue;
    matched++;

    // Get the best date for this backup file
    const exifDate = await dateFromExif(filePath);
    const fnDate = dateFromFilename(filename);
    const folderDate = dateFromFolder(filePath);
    const candidate = bestDate(exifDate, fnDate, folderDate);

    if (!candidate) continue;

    // Track earliest date seen for this filename across all backup copies
    const existing = backupDates.get(key);
    if (!existing || candidate < existing) {
      backupDates.set(key, candidate);
    }

    if (LIMIT > 0 && matched >= LIMIT) {
      console.log(`\n  Reached --limit ${LIMIT}, stopping scan.`);
      break;
    }
  }

  console.log(`\n\n📊 Scan complete: ${scanned.toLocaleString()} files scanned, ${matched.toLocaleString()} matched filenames`);
  console.log(`📅 Found backup dates for ${backupDates.size} unique filenames\n`);

  // Now apply updates
  let updated = 0;
  let skipped = 0;
  let noDate = 0;

  for (const [key, backupDate] of backupDates) {
    const dbPhotos = byFilename.get(key);
    if (!dbPhotos) continue;

    for (const photo of dbPhotos) {
      const currentDate = photo.dateTaken ? new Date(photo.dateTaken) : null;

      // Update if: no current date, or backup date is earlier
      const shouldUpdate =
        !currentDate ||
        (backupDate < currentDate && backupDate >= new Date("1990-01-01"));

      if (shouldUpdate) {
        const isoDate = backupDate.toISOString();
        if (!DRY_RUN) {
          await dbRun(
            `UPDATE photos SET date_taken = ? WHERE id = ?`,
            [isoDate, photo.id]
          );
        }
        updated++;
        if (updated <= 20 || updated % 1000 === 0) {
          console.log(
            `  ✅ #${photo.id} ${key}: ${currentDate ? currentDate.toISOString().slice(0, 10) : "NULL"} → ${isoDate.slice(0, 10)}`
          );
        }
      } else {
        skipped++;
      }
    }
  }

  // Report photos that still have no date
  const nullCount = rows.filter((r) => !r.date_taken && !backupDates.has(r.filename.toLowerCase())).length;

  console.log(`\n✅ Done!`);
  console.log(`   Updated : ${updated.toLocaleString()} photos`);
  console.log(`   Skipped : ${skipped.toLocaleString()} (date already earlier or equal)`);
  console.log(`   No backup date found : ${(backupDates.size - updated - skipped < 0 ? 0 : backupDates.size - updated - skipped).toLocaleString()}`);
  console.log(`   Still no date in DB  : ${nullCount.toLocaleString()} photos`);

  if (DRY_RUN) console.log(`\n⚠️  DRY RUN — run without --dry-run to apply changes`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

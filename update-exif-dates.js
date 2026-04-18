#!/usr/bin/env node
/**
 * update-exif-dates.js
 *
 * Sets date_taken for every photo using the most reliable available source.
 *
 * Priority order:
 *   1. Filename  — dates embedded in the file name are very trustworthy
 *   2. EXIF DateTimeOriginal / CreateDate / DateTime
 *        but only if the date is NOT in the future relative to the
 *        file's mtime (catches photos whose EXIF was corrupted when
 *        the files were overwritten).
 *   3. Folder path year  — e.g. "Photos from 2008", "2015/Summer"
 *   4. File mtime        — last resort
 *
 * Usage:
 *   node update-exif-dates.js               # only photos with NULL date_taken
 *   node update-exif-dates.js --all         # re-process every photo
 *   node update-exif-dates.js --limit 100   # test on N photos
 *   node update-exif-dates.js --dry-run     # preview without writing
 */

import fs   from 'fs';
import path from 'path';
import exifr from 'exifr';
import { dbAll, dbRun } from './db.js';

const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const ALL        = args.includes('--all');
const limitIdx   = args.indexOf('--limit');
const LIMIT      = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;
const BATCH_SIZE = 500;
const TODAY      = new Date();

// ── Filename patterns (ordered most-specific → least-specific) ───────────────
// Each entry: [regex, (match) => Date]
const FILENAME_PATTERNS = [
  // "2012-12-10 17.06.04-1.jpg"  "2014-11-28_19-43-40.jpg"
  [/(\d{4})[-_](\d{2})[-_](\d{2})[ _T](\d{2})[.:_-](\d{2})[.:_-](\d{2})/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)],

  // IMG_20190810_165405.jpg  20150430_000434000_iOS.jpg
  [/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)],

  // 01-14-06_1951.jpg  →  MM-DD-YY_HHMM  (2-digit year: <30 → 20xx, else 19xx)
  [/^(\d{2})-(\d{2})-(\d{2})_(\d{2})(\d{2})/,
   (m) => {
     const yy = parseInt(m[3], 10);
     const yr = yy < 30 ? 2000 + yy : 1900 + yy;
     return new Date(`${yr}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}T${m[4]}:${m[5]}:00`);
   }],

  // Pure YYYYMMDD prefix  "20060114.jpg"
  [/^(\d{4})(\d{2})(\d{2})[^\d]/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}`)],

  // Date-only "2020-08-27" anywhere in name
  [/(\d{4})[-_](\d{2})[-_](\d{2})/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}`)],
];

function parseDateFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  for (const [re, build] of FILENAME_PATTERNS) {
    const m = base.match(re);
    if (!m) continue;
    const dt = build(m);
    if (isNaN(dt.getTime())) continue;
    const y = dt.getFullYear();
    if (y < 1990 || y > TODAY.getFullYear() + 1) continue;
    return dt;
  }
  return null;
}

// ── Extract a year from the folder path ─────────────────────────────────────
function yearFromPath(fullPath) {
  // "Photos from 2008", "Photos from 2019", etc.
  const m1 = fullPath.match(/Photos from (\d{4})/i);
  if (m1) return parseInt(m1[1], 10);

  // Any path component that is just a 4-digit year between 1990–today
  const parts = fullPath.split(/[\\/]/);
  for (const p of parts.reverse()) {   // prefer deepest match
    const m2 = p.match(/^(\d{4})$/);
    if (m2) {
      const y = parseInt(m2[1], 10);
      if (y >= 1990 && y <= TODAY.getFullYear() + 1) return y;
    }
    // e.g. "2008 Jan 13 011.JPG" or "Photos-2015"
    const m3 = p.match(/\b(19|20)\d{2}\b/);
    if (m3) {
      const y = parseInt(m3[0], 10);
      if (y >= 1990 && y <= TODAY.getFullYear() + 1) return y;
    }
  }
  return null;
}

// ── Read EXIF and validate against DB created_at and file mtime ─────────────
// We reject EXIF dates that are more than 30 days AFTER the earliest of
// (db_created_at, file_mtime).  This catches photos whose EXIF was corrupted
// when the file was overwritten after it was already indexed in the DB.
async function readExifDate(fullPath, fileMtime, dbCreatedAt) {
  try {
    const data = await exifr.parse(fullPath, {
      pick: ['DateTimeOriginal', 'CreateDate', 'DateTime'],
      tiff: true, exif: true,
    });
    if (!data) return null;
    const dt = data.DateTimeOriginal ?? data.CreateDate ?? data.DateTime;
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return null;
    const y = dt.getFullYear();
    if (y < 1990 || y > TODAY.getFullYear() + 1) return null;
    // Use the earlier of file mtime and DB import date as the upper bound
    const anchor = new Date(Math.min(fileMtime.getTime(), dbCreatedAt.getTime()));
    const cutoff  = new Date(anchor.getTime() + 30 * 86400_000); // +30 days buffer
    if (dt > cutoff) return null;   // EXIF is after the file was known to exist → corrupted
    return dt;
  } catch { return null; }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('📅  EXIF Date Update Script  (filename-first)');
  console.log('═'.repeat(60));
  console.log(`Mode   : ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Scope  : ${ALL ? 'all photos' : 'NULL date_taken only'}`);
  console.log(`Limit  : ${LIMIT || 'none'}`);
  console.log('═'.repeat(60));

  let query = `SELECT id, filename, full_path, date_taken, created_at
               FROM photos
               WHERE full_path IS NOT NULL AND is_deleted = 0`;
  if (!ALL) query += ` AND date_taken IS NULL`;
  if (LIMIT) query += ` LIMIT ${LIMIT}`;

  const rows = await dbAll(query);
  console.log(`\nPhotos to process: ${rows.length}\n`);

  const stats = { updated: 0, filename: 0, exif: 0, path: 0, mtime: 0, skipped: 0, errors: 0 };
  const pending = [];

  const flush = async () => {
    if (DRY_RUN || !pending.length) { pending.length = 0; return; }
    await dbRun('BEGIN');
    for (const { id, iso } of pending) {
      await dbRun('UPDATE photos SET date_taken = ? WHERE id = ?', [iso, id]);
    }
    await dbRun('COMMIT');
    pending.length = 0;
  };

  for (let i = 0; i < rows.length; i++) {
    const { id, filename, full_path, created_at } = rows[i];

    if ((i + 1) % 1000 === 0) {
      process.stdout.write(
        `\r  ${i + 1}/${rows.length}  updated=${stats.updated} (fn=${stats.filename} exif=${stats.exif} path=${stats.path} mtime=${stats.mtime}) skip=${stats.skipped} err=${stats.errors}   `
      );
    }

    try {
      let stat;
      try { stat = fs.statSync(full_path); }
      catch { stats.skipped++; continue; }

      const fileMtime = stat.mtime;
      let date = null, source = '';

      // 1. Filename
      date = parseDateFromFilename(filename);
      if (date) { source = 'filename'; }

      // 2. EXIF (validated against file mtime AND db created_at)
      if (!date) {
        const dbCreatedAt = new Date(created_at);
        date = await readExifDate(full_path, fileMtime, dbCreatedAt);
        if (date) source = 'exif';
      }

      // 3. Folder path year (make a Jan 1 date for that year)
      if (!date) {
        const yr = yearFromPath(full_path);
        if (yr) { date = new Date(`${yr}-01-01`); source = 'path'; }
      }

      // 4. File mtime (only if reasonable)
      if (!date) {
        const y = fileMtime.getFullYear();
        if (y >= 1990 && y <= TODAY.getFullYear() + 1) {
          date = fileMtime; source = 'mtime';
        }
      }

      if (!date) { stats.skipped++; continue; }

      const iso = date.toISOString();
      if (DRY_RUN && i < 30) console.log(`  [${source}] ${filename} → ${iso}`);

      pending.push({ id, iso });
      stats.updated++;
      stats[source]++;
      if (pending.length >= BATCH_SIZE) await flush();

    } catch (e) {
      stats.errors++;
      if (stats.errors <= 5) console.error(`\n  ✗ ${filename}: ${e.message}`);
    }
  }

  await flush();

  console.log(`\n\n${'═'.repeat(60)}`);
  console.log('Summary');
  console.log('═'.repeat(60));
  console.log(`Total    : ${rows.length}`);
  console.log(`Updated  : ${stats.updated}  (filename:${stats.filename}  exif:${stats.exif}  path:${stats.path}  mtime:${stats.mtime})`);
  console.log(`Skipped  : ${stats.skipped}`);
  console.log(`Errors   : ${stats.errors}`);
  if (DRY_RUN) console.log('\n⚠️  Dry run — no changes written.');
}

main()
  .then(() => { console.log('\nDone!'); process.exit(0); })
  .catch(e => { console.error('\nFatal:', e); process.exit(1); });

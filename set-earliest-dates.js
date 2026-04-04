#!/usr/bin/env node
/**
 * set-earliest-dates.js
 *
 * For every photo, collects all available dates (EXIF metadata + filename)
 * and sets date_taken to the OLDEST (earliest) valid date found.
 *
 * If no date can be determined from either source, date_taken is left unchanged.
 *
 * Usage:
 *   node set-earliest-dates.js              # all photos
 *   node set-earliest-dates.js --dry-run    # preview, no writes
 *   node set-earliest-dates.js --limit 100  # test on N photos
 */

import fs   from 'fs';
import path from 'path';
import exifr from 'exifr';
import { dbAll, dbRun } from './db.js';

const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const limitIdx   = args.indexOf('--limit');
const LIMIT      = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;
const BATCH_SIZE = 500;
const TODAY      = new Date();
const MIN_DATE   = new Date('1990-01-01');

// ── Filename date patterns ────────────────────────────────────────────────────
const FILENAME_PATTERNS = [
  // "2012-12-10 17.06.04-1.jpg"  "2014-11-28_19-43-40.jpg"
  [/(\d{4})[-_](\d{2})[-_](\d{2})[ _T](\d{2})[.:_-](\d{2})[.:_-](\d{2})/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)],
  // IMG_20190810_165405.jpg
  [/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/,
   (m) => new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)],
  // 01-14-06_1951.jpg  →  MM-DD-YY_HHMM
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

function filenameDate(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  for (const [re, build] of FILENAME_PATTERNS) {
    const m = base.match(re);
    if (!m) continue;
    const dt = build(m);
    if (!dt || isNaN(dt.getTime())) continue;
    if (dt >= MIN_DATE && dt <= TODAY) return dt;
  }
  return null;
}

async function exifDate(fullPath, fileMtime, dbCreatedAt) {
  try {
    const data = await exifr.parse(fullPath, {
      pick: ['DateTimeOriginal', 'CreateDate', 'DateTime'],
      tiff: true, exif: true,
    });
    if (!data) return null;
    const dt = data.DateTimeOriginal ?? data.CreateDate ?? data.DateTime;
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return null;
    if (dt < MIN_DATE || dt > TODAY) return null;
    // Reject EXIF dates more than 30 days after the file was first known to exist
    // (catches EXIF corruption from file overwrites)
    const anchor  = new Date(Math.min(fileMtime.getTime(), dbCreatedAt.getTime()));
    const cutoff  = new Date(anchor.getTime() + 30 * 86400_000);
    if (dt > cutoff) return null;
    return dt;
  } catch { return null; }
}

function earliest(...dates) {
  const valid = dates.filter(d => d && !isNaN(d.getTime()));
  if (!valid.length) return null;
  return valid.reduce((a, b) => (a < b ? a : b));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('📅  Set Earliest Date Script');
  console.log('    Source: EXIF metadata  +  filename');
  console.log('    Rule  : use oldest valid date from either source');
  console.log('═'.repeat(60));
  console.log(`Mode  : ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit : ${LIMIT || 'none'}`);
  console.log('═'.repeat(60));

  let query = `SELECT id, filename, full_path, date_taken, created_at
               FROM photos
               WHERE full_path IS NOT NULL AND is_deleted = 0`;
  if (LIMIT) query += ` LIMIT ${LIMIT}`;

  const rows = await dbAll(query);
  console.log(`\nPhotos to process: ${rows.length}\n`);

  const stats = { updated: 0, unchanged: 0, no_date: 0, missing_file: 0, errors: 0 };
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
    const { id, filename, full_path, date_taken, created_at } = rows[i];

    if ((i + 1) % 500 === 0 || i === rows.length - 1) {
      process.stdout.write(
        `\r  ${i + 1}/${rows.length}  updated=${stats.updated}  unchanged=${stats.unchanged}  no_date=${stats.no_date}  err=${stats.errors}   `
      );
    }

    try {
      let stat;
      try { stat = fs.statSync(full_path); }
      catch { stats.missing_file++; stats.unchanged++; continue; }

      const fnDate   = filenameDate(filename);
      const exDate   = await exifDate(full_path, stat.mtime, new Date(created_at));
      const best     = earliest(fnDate, exDate);

      if (!best) {
        stats.no_date++;
        continue;
      }

      const iso         = best.toISOString();
      const currentDate = date_taken ? new Date(date_taken) : null;

      // Only update if different from what's stored
      if (currentDate && Math.abs(currentDate.getTime() - best.getTime()) < 1000) {
        stats.unchanged++;
        continue;
      }

      if (DRY_RUN && stats.updated < 30) {
        const src = fnDate && exDate
          ? `min(fn=${fnDate.toISOString().slice(0,10)}, exif=${exDate.toISOString().slice(0,10)})`
          : fnDate ? `filename=${fnDate.toISOString().slice(0,10)}` : `exif=${exDate.toISOString().slice(0,10)}`;
        console.log(`  ${filename}: ${date_taken ? date_taken.slice(0,10) : 'NULL'} → ${iso.slice(0,10)}  [${src}]`);
      }

      pending.push({ id, iso });
      stats.updated++;
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
  console.log(`Total        : ${rows.length}`);
  console.log(`Updated      : ${stats.updated}`);
  console.log(`Unchanged    : ${stats.unchanged}`);
  console.log(`No date found: ${stats.no_date}`);
  console.log(`Missing file : ${stats.missing_file}`);
  console.log(`Errors       : ${stats.errors}`);
  if (DRY_RUN) console.log('\n⚠️  Dry run — no changes written. Remove --dry-run to apply.');
}

main()
  .then(() => { console.log('\nDone!'); process.exit(0); })
  .catch(e => { console.error('\nFatal:', e); process.exit(1); });

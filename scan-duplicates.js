#!/usr/bin/env node
// FILE: scan-duplicates.js
// Duplicate photo detection using perceptual hashing (pHash)
// Finds visually similar photos and moves duplicates to a separate folder

import { dbRun, dbGet, dbAll } from './db.js';
import imghash from 'imghash';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHOTO_ROOT = process.env.PHOTO_ROOT || 'G:/Photos';
const DUPLICATES_FOLDER = path.join(PHOTO_ROOT, '_duplicates');

// Hamming distance threshold for considering photos as duplicates
// Lower = stricter matching. 5-10 is typical for near-duplicates
const HASH_THRESHOLD = 8;

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  limit: 0,           // 0 = no limit
  offset: 0,
  rehash: false,      // Recalculate hashes for all photos
  dryRun: false,      // Don't move files, just report
  verbose: false,
  threshold: HASH_THRESHOLD,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--limit':
      options.limit = parseInt(args[++i], 10) || 0;
      break;
    case '--offset':
      options.offset = parseInt(args[++i], 10) || 0;
      break;
    case '--rehash':
      options.rehash = true;
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--threshold':
      options.threshold = parseInt(args[++i], 10) || HASH_THRESHOLD;
      break;
    case '--verbose':
    case '-v':
      options.verbose = true;
      break;
    case '--help':
    case '-h':
      console.log(`
Duplicate Photo Scanner - Find and move duplicate photos using perceptual hashing

Usage: node scan-duplicates.js [options]

Options:
  --limit N       Process only N photos (default: all)
  --offset N      Skip first N photos (default: 0)
  --rehash        Recalculate hashes even if already computed
  --dry-run       Report duplicates but don't move files
  --threshold N   Hamming distance threshold (default: ${HASH_THRESHOLD}, lower = stricter)
  --verbose       Show detailed progress
  --help          Show this help message

Examples:
  node scan-duplicates.js --dry-run          # Find duplicates without moving
  node scan-duplicates.js --verbose          # Process all with detailed output
  node scan-duplicates.js --threshold 5      # Stricter matching (fewer false positives)
  node scan-duplicates.js --limit 100        # Test with 100 photos

Duplicates will be moved to: ${DUPLICATES_FOLDER}
`);
      process.exit(0);
  }
}

// Stats tracking
const stats = {
  processed: 0,
  hashed: 0,
  duplicatesFound: 0,
  duplicatesMoved: 0,
  errors: 0,
  skipped: 0,
};

/**
 * Calculate hamming distance between two hex hashes
 */
function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return Infinity;
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const b1 = parseInt(hash1[i], 16);
    const b2 = parseInt(hash2[i], 16);
    // Count differing bits
    let xor = b1 ^ b2;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Calculate perceptual hash for an image
 */
async function calculateHash(imagePath) {
  try {
    // Use 16-bit hash (64 hex chars) for better precision
    const hash = await imghash.hash(imagePath, 16, 'hex');
    return hash;
  } catch (error) {
    if (options.verbose) {
      console.log(`    Hash error: ${error.message}`);
    }
    return null;
  }
}

/**
 * Find the actual file path for a photo
 */
function findPhotoPath(filename, fullPath) {
  // Try the stored full_path first
  if (fullPath && fs.existsSync(fullPath) && !fullPath.includes('.thumb.')) {
    return fullPath;
  }
  return null;
}

/**
 * Ensure duplicates folder exists
 */
function ensureDuplicatesFolder() {
  if (!fs.existsSync(DUPLICATES_FOLDER)) {
    fs.mkdirSync(DUPLICATES_FOLDER, { recursive: true });
    console.log(`Created duplicates folder: ${DUPLICATES_FOLDER}`);
  }
}

/**
 * Move a file to the duplicates folder
 */
async function moveToDuplicates(photo, originalPhoto) {
  const srcPath = photo.full_path;

  // Create subfolder structure based on original's location
  const relPath = path.relative(PHOTO_ROOT, path.dirname(srcPath));
  const destDir = path.join(DUPLICATES_FOLDER, relPath);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const destPath = path.join(destDir, photo.filename);

  // Handle filename conflicts
  let finalDestPath = destPath;
  let counter = 1;
  while (fs.existsSync(finalDestPath)) {
    const ext = path.extname(photo.filename);
    const base = path.basename(photo.filename, ext);
    finalDestPath = path.join(destDir, `${base}_${counter}${ext}`);
    counter++;
  }

  if (!options.dryRun) {
    fs.renameSync(srcPath, finalDestPath);

    // Update database
    await dbRun(
      `UPDATE photos SET is_duplicate = 1, duplicate_of = ?, full_path = ? WHERE id = ?`,
      [originalPhoto.id, finalDestPath, photo.id]
    );
  }

  return finalDestPath;
}

/**
 * Phase 1: Calculate hashes for all photos
 */
async function calculateHashes() {
  console.log('\n=== Phase 1: Calculating perceptual hashes ===\n');

  let query = `SELECT id, filename, full_path, phash FROM photos WHERE is_duplicate = 0`;
  const params = [];

  if (!options.rehash) {
    query += ` AND phash IS NULL`;
  }

  query += ` ORDER BY id`;

  if (options.limit > 0) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  if (options.offset > 0) {
    query += ` OFFSET ?`;
    params.push(options.offset);
  }

  const photos = await dbAll(query, params);
  console.log(`Found ${photos.length} photos to hash`);

  if (photos.length === 0) {
    console.log('No photos need hashing. Use --rehash to recalculate all hashes.');
    return;
  }

  const startTime = Date.now();
  let lastProgressUpdate = startTime;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];

    const filePath = findPhotoPath(photo.filename, photo.full_path);
    if (!filePath) {
      stats.skipped++;
      continue;
    }

    if (options.verbose) {
      console.log(`  Hashing ${photo.id}: ${photo.filename}`);
    }

    const hash = await calculateHash(filePath);

    if (hash) {
      await dbRun(`UPDATE photos SET phash = ? WHERE id = ?`, [hash, photo.id]);
      stats.hashed++;
    } else {
      stats.errors++;
    }

    stats.processed++;

    // Progress update every 5 seconds or every 50 photos
    const now = Date.now();
    if (now - lastProgressUpdate > 5000 || (i + 1) % 50 === 0) {
      const elapsed = (now - startTime) / 1000;
      const photosPerSecond = (i + 1) / elapsed;
      const remaining = photos.length - i - 1;
      const eta = remaining / photosPerSecond;

      console.log(
        `Progress: ${i + 1}/${photos.length} (${Math.round((i + 1) / photos.length * 100)}%) | ` +
        `${photosPerSecond.toFixed(1)} photos/sec | ` +
        `ETA: ${Math.round(eta)}s`
      );
      lastProgressUpdate = now;
    }
  }

  console.log(`\nHashing complete: ${stats.hashed} hashed, ${stats.errors} errors, ${stats.skipped} skipped`);
}

/**
 * Phase 2: Find and process duplicates
 */
async function findDuplicates() {
  console.log('\n=== Phase 2: Finding duplicates ===\n');

  // Get all photos with hashes, ordered by id (older photos are "originals")
  const photos = await dbAll(`
    SELECT id, filename, full_path, phash, created_at
    FROM photos
    WHERE phash IS NOT NULL AND is_duplicate = 0
    ORDER BY id ASC
  `);

  console.log(`Comparing ${photos.length} photos for duplicates (threshold: ${options.threshold})`);

  if (photos.length < 2) {
    console.log('Not enough photos with hashes to compare.');
    return;
  }

  ensureDuplicatesFolder();

  const duplicates = new Set(); // Track which photos are duplicates
  const duplicateGroups = []; // Groups of duplicate photos

  // Build a map for faster lookup
  const hashMap = new Map();
  for (const photo of photos) {
    hashMap.set(photo.id, photo);
  }

  const startTime = Date.now();
  let comparisons = 0;
  const totalComparisons = (photos.length * (photos.length - 1)) / 2;

  // Compare each photo with all subsequent photos
  for (let i = 0; i < photos.length; i++) {
    const photo1 = photos[i];

    if (duplicates.has(photo1.id)) continue; // Skip if already marked as duplicate

    const group = [photo1]; // Start a new group with this photo as the original

    for (let j = i + 1; j < photos.length; j++) {
      const photo2 = photos[j];

      if (duplicates.has(photo2.id)) continue; // Skip if already marked as duplicate

      const distance = hammingDistance(photo1.phash, photo2.phash);
      comparisons++;

      if (distance <= options.threshold) {
        group.push(photo2);
        duplicates.add(photo2.id);
        stats.duplicatesFound++;

        if (options.verbose) {
          console.log(`  Duplicate found: ${photo2.filename} matches ${photo1.filename} (distance: ${distance})`);
        }
      }
    }

    if (group.length > 1) {
      duplicateGroups.push(group);
    }

    // Progress update every 5 seconds
    const now = Date.now();
    if (now - startTime > 5000 && comparisons % 10000 === 0) {
      const progress = (comparisons / totalComparisons * 100).toFixed(1);
      console.log(`Comparison progress: ${progress}% (${comparisons.toLocaleString()} comparisons)`);
    }
  }

  console.log(`\nFound ${stats.duplicatesFound} duplicates in ${duplicateGroups.length} groups`);

  // Process duplicates
  if (stats.duplicatesFound > 0) {
    console.log('\n=== Processing duplicates ===\n');

    for (const group of duplicateGroups) {
      const original = group[0];
      const dupes = group.slice(1);

      console.log(`Original: ${original.filename} (id: ${original.id})`);

      for (const dupe of dupes) {
        if (options.dryRun) {
          console.log(`  [DRY RUN] Would move: ${dupe.filename}`);
        } else {
          try {
            const destPath = await moveToDuplicates(dupe, original);
            console.log(`  Moved: ${dupe.filename} -> ${destPath}`);
            stats.duplicatesMoved++;
          } catch (error) {
            console.error(`  Error moving ${dupe.filename}: ${error.message}`);
            stats.errors++;
          }
        }
      }
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Duplicate Photo Scanner starting...');
  console.log(`Photo root: ${PHOTO_ROOT}`);
  console.log(`Duplicates folder: ${DUPLICATES_FOLDER}`);
  console.log(`Options:`, options);

  const startTime = Date.now();

  // Phase 1: Calculate hashes
  await calculateHashes();

  // Phase 2: Find and move duplicates
  await findDuplicates();

  // Print summary
  const totalTime = (Date.now() - startTime) / 1000;
  console.log('\n' + '='.repeat(50));
  console.log('Scan Complete!');
  console.log('='.repeat(50));
  console.log(`Total time: ${totalTime.toFixed(1)}s`);
  console.log(`Photos processed: ${stats.processed}`);
  console.log(`Photos hashed: ${stats.hashed}`);
  console.log(`Duplicates found: ${stats.duplicatesFound}`);
  console.log(`Duplicates moved: ${stats.duplicatesMoved}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Skipped: ${stats.skipped}`);

  if (options.dryRun) {
    console.log('\n[DRY RUN] No files were actually moved.');
  }
}

// Run the scanner
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

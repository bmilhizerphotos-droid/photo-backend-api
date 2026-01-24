#!/usr/bin/env node
// FILE: scan-faces.js
// Batch face scanning script - scans photos for faces and stores embeddings

import { dbRun, dbGet, dbAll } from './db.js';
import {
  initializeFaceApi,
  detectFaces,
  embeddingToBuffer,
  bufferToEmbedding,
  findBestMatch,
} from './insightface-config.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHOTO_ROOT = process.env.PHOTO_ROOT || 'G:/Photos';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  limit: 0,        // 0 = no limit
  offset: 0,
  rescan: false,   // Rescan photos that already have face_scan_status
  verbose: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--limit':
      options.limit = parseInt(args[++i], 10) || 0;
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
    case '--help':
    case '-h':
      console.log(`
Face Scanner - Detect and index faces in photos

Usage: node scan-faces.js [options]

Options:
  --limit N     Process only N photos (default: all)
  --offset N    Skip first N photos (default: 0)
  --rescan      Rescan photos even if already scanned
  --verbose     Show detailed progress
  --help        Show this help message

Examples:
  node scan-faces.js --limit 10           # Test with 10 photos
  node scan-faces.js --verbose            # Scan all with detailed output
  node scan-faces.js --rescan --limit 5   # Rescan first 5 photos
`);
      process.exit(0);
  }
}

// Stats tracking
const stats = {
  processed: 0,
  facesFound: 0,
  facesMatched: 0,
  noFaces: 0,
  errors: 0,
  skipped: 0,
};

// Folders to exclude from search
const EXCLUDED_FOLDERS = ['_duplicates', '.thumb', '@eaDir'];

/**
 * Find the actual file path for a photo
 */
async function findPhotoPath(filename, fullPath) {
  // Try the stored full_path first (skip if in excluded folders)
  if (fullPath && fs.existsSync(fullPath) && !fullPath.includes('.thumb.') && !fullPath.includes('_duplicates')) {
    return fullPath;
  }

  // Search for the file
  const stack = [PHOTO_ROOT];
  const targetLower = filename.toLowerCase();

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip excluded folders
        if (EXCLUDED_FOLDERS.includes(entry.name)) continue;

        const fullEntryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullEntryPath);
        } else if (entry.name.toLowerCase() === targetLower) {
          return fullEntryPath;
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  return null;
}

/**
 * Get all reference embeddings for matching
 */
async function loadReferenceEmbeddings() {
  const refs = await dbAll(`
    SELECT person_id as personId, embedding
    FROM person_reference_embeddings
  `);

  return refs.map(ref => ({
    personId: ref.personId,
    embedding: bufferToEmbedding(ref.embedding),
  }));
}

/**
 * Process a single photo
 */
async function processPhoto(photo, referenceEmbeddings) {
  if (options.verbose) {
    console.log(`  Processing photo ${photo.id}: ${photo.filename}`);
  }

  // Find the actual file path
  const filePath = await findPhotoPath(photo.filename, photo.full_path);
  if (!filePath) {
    if (options.verbose) {
      console.log(`    File not found, skipping`);
    }
    stats.skipped++;
    return;
  }

  try {
    // Detect faces in the image
    const faces = await detectFaces(filePath);

    if (faces.length === 0) {
      // No faces found
      await dbRun(
        `UPDATE photos SET face_scan_status = 'no_faces' WHERE id = ?`,
        [photo.id]
      );
      stats.noFaces++;
      if (options.verbose) {
        console.log(`    No faces detected`);
      }
      return;
    }

    // Store each detected face
    for (const face of faces) {
      const embeddingBuffer = embeddingToBuffer(face.embedding);

      // Try to match against known people
      const match = findBestMatch(face.embedding, referenceEmbeddings);

      const personId = match ? match.personId : null;

      // Insert face embedding
      await dbRun(
        `INSERT INTO face_embeddings
         (photo_id, person_id, embedding, bbox_x, bbox_y, bbox_width, bbox_height, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          photo.id,
          personId,
          embeddingBuffer,
          face.bbox.x,
          face.bbox.y,
          face.bbox.width,
          face.bbox.height,
          face.confidence,
        ]
      );

      stats.facesFound++;
      if (match) {
        stats.facesMatched++;
        if (options.verbose) {
          console.log(`    Face matched to person ${personId} (distance: ${match.distance.toFixed(3)})`);
        }
      } else if (options.verbose) {
        console.log(`    Unidentified face detected (confidence: ${face.confidence.toFixed(2)})`);
      }
    }

    // Mark photo as scanned
    await dbRun(
      `UPDATE photos SET face_scan_status = 'scanned' WHERE id = ?`,
      [photo.id]
    );

    stats.processed++;
  } catch (error) {
    console.error(`    Error processing photo ${photo.id}:`, error.message);
    stats.errors++;
  }
}

/**
 * Main scanning function
 */
async function main() {
  console.log('Face Scanner starting...');
  console.log(`Photo root: ${PHOTO_ROOT}`);
  console.log(`Options:`, options);
  console.log('');

  // Initialize face-api
  console.log('Initializing face detection models...');
  try {
    await initializeFaceApi();
  } catch (error) {
    console.error('Failed to initialize face-api:', error.message);
    console.error('');
    console.error('Please ensure face-api models are downloaded to ./models/');
    console.error('Download from: https://github.com/vladmandic/face-api/tree/master/model');
    console.error('Required models: tiny_face_detector, face_landmark_68, face_recognition');
    process.exit(1);
  }
  console.log('');

  // Load reference embeddings for matching
  console.log('Loading reference embeddings...');
  const referenceEmbeddings = await loadReferenceEmbeddings();
  console.log(`Loaded ${referenceEmbeddings.length} reference embeddings`);
  console.log('');

  // Build query for photos to scan (exclude duplicates)
  let query = `SELECT id, filename, full_path FROM photos WHERE (is_duplicate IS NULL OR is_duplicate = 0)`;
  const params = [];

  if (!options.rescan) {
    query += ` AND face_scan_status IS NULL`;
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

  // Get photos to scan
  const photos = await dbAll(query, params);
  console.log(`Found ${photos.length} photos to scan`);
  console.log('');

  if (photos.length === 0) {
    console.log('No photos to scan. Use --rescan to scan already-scanned photos.');
    return;
  }

  // Process each photo
  const startTime = Date.now();
  let lastProgressUpdate = startTime;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];

    await processPhoto(photo, referenceEmbeddings);

    // Progress update every 5 seconds or every 10 photos
    const now = Date.now();
    if (now - lastProgressUpdate > 5000 || (i + 1) % 10 === 0) {
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

  // Print summary
  const totalTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('='.repeat(50));
  console.log('Scan Complete!');
  console.log('='.repeat(50));
  console.log(`Total time: ${totalTime.toFixed(1)}s`);
  console.log(`Photos processed: ${stats.processed}`);
  console.log(`Photos with no faces: ${stats.noFaces}`);
  console.log(`Photos skipped (not found): ${stats.skipped}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Faces detected: ${stats.facesFound}`);
  console.log(`Faces matched to known people: ${stats.facesMatched}`);
  console.log(`Unidentified faces: ${stats.facesFound - stats.facesMatched}`);
}

// Run the scanner
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

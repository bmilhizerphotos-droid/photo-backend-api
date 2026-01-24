#!/usr/bin/env node
/**
 * populate-photo-paths.js
 *
 * One-time migration script to populate full_path and thumbnail_path
 * for existing photos in the database.
 *
 * Usage:
 *   node populate-photo-paths.js [--dry-run] [--limit N] [--verbose]
 *
 * Options:
 *   --dry-run   Show what would be updated without making changes
 *   --limit N   Only process N photos (default: all)
 *   --verbose   Show detailed progress
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { dbGet, dbAll, dbRun } from "./db.js";

const PHOTO_ROOT = process.env.PHOTO_ROOT || "G:/Photos";

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : null;

// Folders to exclude from search
const EXCLUDED_FOLDERS = ['_duplicates', '.thumb', '@eaDir'];

/**
 * Security: Validate that a path is within the allowed PHOTO_ROOT directory
 */
function isPathWithinRoot(filePath) {
  if (!filePath) return false;
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(PHOTO_ROOT);
  return resolvedPath.startsWith(resolvedRoot + path.sep) || resolvedPath === resolvedRoot;
}

/**
 * Async file search - finds a file by name within the photo root
 */
async function findFileAsync(root, targetName) {
  const targetLower = String(targetName).toLowerCase();

  const resolvedRoot = path.resolve(root);
  if (!isPathWithinRoot(resolvedRoot)) {
    console.error(`Security: Attempted to search outside PHOTO_ROOT: ${root}`);
    return null;
  }

  const stack = [resolvedRoot];

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (EXCLUDED_FOLDERS.includes(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        if (!isPathWithinRoot(fullPath)) continue;

        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.name.toLowerCase() === targetLower) {
          return fullPath;
        }
      }
    } catch {
      // ignore permission errors
    }
  }
  return null;
}

/**
 * Main function to populate photo paths
 */
async function populatePhotoPaths() {
  console.log("=".repeat(60));
  console.log("Photo Path Population Script");
  console.log("=".repeat(60));
  console.log(`PHOTO_ROOT: ${PHOTO_ROOT}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Limit: ${limit || "none"}`);
  console.log(`Verbose: ${verbose}`);
  console.log("=".repeat(60));

  // Get photos with missing paths
  let query = `
    SELECT id, filename, full_path, thumbnail_path
    FROM photos
    WHERE full_path IS NULL OR thumbnail_path IS NULL
  `;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const photos = await dbAll(query);
  console.log(`Found ${photos.length} photos with missing paths\n`);

  if (photos.length === 0) {
    console.log("No photos need path updates. Exiting.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const progress = `[${i + 1}/${photos.length}]`;

    try {
      let fullPath = photo.full_path;
      let thumbnailPath = photo.thumbnail_path;
      let needsUpdate = false;

      // Find full image path if missing
      if (!fullPath || !fs.existsSync(fullPath)) {
        if (verbose) console.log(`${progress} Searching for: ${photo.filename}`);

        fullPath = await findFileAsync(PHOTO_ROOT, photo.filename);

        if (fullPath) {
          if (verbose) console.log(`${progress}   Found: ${fullPath}`);
          needsUpdate = true;
        } else {
          if (verbose) console.log(`${progress}   NOT FOUND: ${photo.filename}`);
          errors++;
          continue;
        }
      }

      // Find thumbnail path if missing
      if (!thumbnailPath || !fs.existsSync(thumbnailPath)) {
        const thumbName = `${photo.filename}.thumb.jpg`;
        if (verbose) console.log(`${progress} Searching for thumbnail: ${thumbName}`);

        thumbnailPath = await findFileAsync(PHOTO_ROOT, thumbName);

        if (thumbnailPath) {
          if (verbose) console.log(`${progress}   Found thumbnail: ${thumbnailPath}`);
          needsUpdate = true;
        } else {
          if (verbose) console.log(`${progress}   Thumbnail not found (optional)`);
          // Thumbnail not found is not an error - not all photos have thumbnails
        }
      }

      // Update database
      if (needsUpdate) {
        if (dryRun) {
          console.log(`${progress} Would update photo ${photo.id}:`);
          console.log(`        full_path: ${fullPath}`);
          console.log(`        thumbnail_path: ${thumbnailPath || "(none)"}`);
          updated++;
        } else {
          await dbRun(
            `UPDATE photos SET full_path = ?, thumbnail_path = ? WHERE id = ?`,
            [fullPath, thumbnailPath, photo.id]
          );
          if (verbose) console.log(`${progress} Updated photo ${photo.id}`);
          updated++;
        }
      } else {
        skipped++;
        if (verbose) console.log(`${progress} Skipped photo ${photo.id} (paths already valid)`);
      }

    } catch (err) {
      console.error(`${progress} Error processing photo ${photo.id}: ${err.message}`);
      errors++;
    }

    // Progress indicator every 100 photos
    if (!verbose && (i + 1) % 100 === 0) {
      console.log(`Processed ${i + 1}/${photos.length} photos...`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary:");
  console.log("=".repeat(60));
  console.log(`Total processed: ${photos.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

  if (dryRun) {
    console.log("\n(Dry run - no changes were made)");
  }
}

// Run the script
populatePhotoPaths()
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });

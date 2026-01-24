#!/usr/bin/env node
/**
 * Batch AI Tag Generator
 * Generates AI tags for photos using Ollama
 *
 * Usage:
 *   node generate-ai-tags.js [options]
 *
 * Options:
 *   --limit N       Process at most N photos (default: 0 = all)
 *   --offset N      Skip first N photos (default: 0)
 *   --untagged      Only process photos without AI tags
 *   --verbose       Show detailed output
 *   --dry-run       Show what would be done without making changes
 */

import { dbGet, dbAll, dbRun } from "./db.js";
import { generateTags, checkOllamaHealth } from "./ai-tag-generator.js";

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  limit: 0,
  offset: 0,
  untaggedOnly: args.includes('--untagged'),
  verbose: args.includes('--verbose'),
  dryRun: args.includes('--dry-run'),
};

// Parse numeric options
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[i + 1], 10);
  }
  if (args[i] === '--offset' && args[i + 1]) {
    options.offset = parseInt(args[i + 1], 10);
  }
}

console.log('AI Tag Generator starting...');
console.log('Options:', options);

// Check Ollama
const ollamaOk = await checkOllamaHealth();
if (!ollamaOk) {
  console.error('❌ Ollama is not available. Please ensure Ollama is running.');
  process.exit(1);
}
console.log('✅ Ollama is available\n');

// Build query
let query = `
  SELECT p.id, p.filename, p.created_at
  FROM photos p
  WHERE (p.is_duplicate IS NULL OR p.is_duplicate = 0)
`;

if (options.untaggedOnly) {
  query += `
    AND NOT EXISTS (
      SELECT 1 FROM photo_tags pt
      JOIN tags t ON t.id = pt.tag_id
      WHERE pt.photo_id = p.id AND t.type = 'ai'
    )
  `;
}

query += ' ORDER BY p.id';

if (options.limit > 0) {
  query += ` LIMIT ${options.limit}`;
}

if (options.offset > 0) {
  query += ` OFFSET ${options.offset}`;
}

// Get photos to process
const photos = await dbAll(query);
console.log(`Found ${photos.length} photos to process\n`);

if (photos.length === 0) {
  console.log('No photos to process.');
  process.exit(0);
}

// Stats
let processed = 0;
let tagged = 0;
let totalTagsAdded = 0;
let errors = 0;
const startTime = Date.now();

// Process photos
for (const photo of photos) {
  try {
    processed++;

    // Get existing tags
    const existingTags = await dbAll(
      `SELECT t.name FROM tags t
       JOIN photo_tags pt ON pt.tag_id = t.id
       WHERE pt.photo_id = ?`,
      [photo.id]
    );

    // Get people tagged in photo
    const people = await dbAll(
      `SELECT p.name FROM people p
       JOIN photo_people pp ON pp.person_id = p.id
       WHERE pp.photo_id = ?`,
      [photo.id]
    );

    // Build metadata for AI
    const photoData = {
      filename: photo.filename,
      existingTags: existingTags.map(t => t.name),
      people: people.map(p => p.name),
      dateTaken: photo.created_at,
      exif: {},
    };

    if (options.verbose) {
      console.log(`  Processing photo ${photo.id}: ${photo.filename}`);
      console.log(`    Existing tags: ${photoData.existingTags.join(', ') || 'none'}`);
      console.log(`    People: ${photoData.people.join(', ') || 'none'}`);
    }

    // Generate tags
    const generatedTags = await generateTags(photoData);

    if (generatedTags.length === 0) {
      if (options.verbose) {
        console.log('    No new tags generated');
      }
      continue;
    }

    if (options.verbose || options.dryRun) {
      console.log(`    Generated tags: ${generatedTags.join(', ')}`);
    }

    if (options.dryRun) {
      tagged++;
      totalTagsAdded += generatedTags.length;
      continue;
    }

    // Add tags to database
    let addedCount = 0;
    for (const tagName of generatedTags) {
      // Create or get the tag
      let tag = await dbGet(
        "SELECT * FROM tags WHERE name = ? AND type = 'ai'",
        [tagName]
      );

      if (!tag) {
        const result = await dbRun(
          "INSERT INTO tags (name, type) VALUES (?, 'ai')",
          [tagName]
        );
        tag = { id: result.lastID, name: tagName, type: 'ai' };
      }

      // Check if already linked to photo
      const existing = await dbGet(
        "SELECT 1 FROM photo_tags WHERE photo_id = ? AND tag_id = ?",
        [photo.id, tag.id]
      );

      if (!existing) {
        await dbRun(
          "INSERT INTO photo_tags (photo_id, tag_id, added_by) VALUES (?, ?, 'ai')",
          [photo.id, tag.id]
        );
        addedCount++;
      }
    }

    if (addedCount > 0) {
      tagged++;
      totalTagsAdded += addedCount;
      if (options.verbose) {
        console.log(`    Added ${addedCount} tags`);
      }
    }

    // Progress update every 10 photos
    if (processed % 10 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = photos.length - processed;
      const eta = remaining / rate;
      console.log(
        `Progress: ${processed}/${photos.length} (${Math.round(processed / photos.length * 100)}%) | ` +
        `${rate.toFixed(1)} photos/sec | ETA: ${Math.round(eta)}s`
      );
    }

  } catch (err) {
    errors++;
    console.error(`  ❌ Error processing photo ${photo.id}: ${err.message}`);
  }
}

// Final stats
const elapsed = (Date.now() - startTime) / 1000;
console.log('\n========================================');
console.log('AI Tag Generation Complete');
console.log('========================================');
console.log(`Processed: ${processed} photos`);
console.log(`Tagged: ${tagged} photos`);
console.log(`Total tags added: ${totalTagsAdded}`);
console.log(`Errors: ${errors}`);
console.log(`Time: ${elapsed.toFixed(1)}s (${(processed / elapsed).toFixed(1)} photos/sec)`);

if (options.dryRun) {
  console.log('\n(Dry run - no changes were made)');
}

process.exit(0);

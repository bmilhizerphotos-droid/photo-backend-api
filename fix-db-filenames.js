import db from "./db.js";
import fs from "fs";
import path from "path";

// Configuration
const BASE_PHOTO_DIR = "G:/Photos";

// Utility function to find file recursively (same as in server.js)
function findFileRecursive(root, targetName) {
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.name === targetName) {
          return fullPath;
        }
      }
    } catch {
      // ignore permission errors
    }
  }
  return null;
}

// Function to find file with case-insensitive search
function findFileCaseInsensitive(root, targetName) {
  const stack = [root];
  const targetLower = targetName.toLowerCase();
  let foundPaths = [];

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.name.toLowerCase() === targetLower) {
          foundPaths.push(fullPath);
        }
      }
    } catch {
      // ignore permission errors
    }
  }

  // Return the first found path (there might be duplicates)
  return foundPaths.length > 0 ? foundPaths[0] : null;
}

async function fixFilenames() {
  console.log("🔍 Starting filename fix process...");

  // Get total count first
  const countResult = await db.get("SELECT COUNT(*) as total FROM photos");
  const totalPhotos = countResult.total;
  console.log(`📊 Found ${totalPhotos} photos in database`);

  const batchSize = 1000;
  let fixed = 0;
  let notFound = 0;
  let processed = 0;

  for (let offset = 0; offset < totalPhotos; offset += batchSize) {
    const rows = await db.all("SELECT id, filename FROM photos LIMIT ? OFFSET ?", [batchSize, offset]);

    for (const row of rows) {
      const { id, filename } = row;
      let correctedFilename = filename;

      // Remove leading ". " if present
      if (filename.startsWith(". ")) {
        correctedFilename = filename.substring(2);
      }

      // Try to find the file with corrected filename (case-insensitive)
      const filePath = findFileCaseInsensitive(BASE_PHOTO_DIR, correctedFilename);

      if (filePath) {
        // File found - update database if filename was corrected
        if (correctedFilename !== filename) {
          await db.run("UPDATE photos SET filename = ? WHERE id = ?", [correctedFilename, id]);
          fixed++;
        }
      } else {
        notFound++;
      }

      processed++;
    }

    // Progress update every batch
    console.log(`📈 Progress: ${processed}/${totalPhotos} (${Math.round(processed/totalPhotos*100)}%) - Fixed: ${fixed}, Not found: ${notFound}`);
  }

  console.log(`\n📈 Final Summary:`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Not found: ${notFound}`);
  console.log(`   Total processed: ${processed}`);

  // Close database connection
  await db.close();
}

fixFilenames().catch(console.error);
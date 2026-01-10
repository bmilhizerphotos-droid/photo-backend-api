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

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
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

async function fixFilenames() {
  console.log("🔍 Starting filename fix process...");

  // Get all photos from database
  const rows = await db.all("SELECT id, filename FROM photos");

  console.log(`📊 Found ${rows.length} photos in database`);

  let fixed = 0;
  let notFound = 0;

  for (const row of rows) {
    const { id, filename } = row;
    let correctedFilename = filename;

    // Remove leading ". " if present
    if (filename.startsWith(". ")) {
      correctedFilename = filename.substring(2);
    }

    // Try to find the file with corrected filename
    let filePath = findFileRecursive(BASE_PHOTO_DIR, correctedFilename);

    // If not found, try case-insensitive search
    if (!filePath) {
      filePath = findFileCaseInsensitive(BASE_PHOTO_DIR, correctedFilename);
    }

    if (filePath) {
      // File found - update database if filename was corrected
      if (correctedFilename !== filename) {
        console.log(`✅ Fixed ID ${id}: "${filename}" -> "${correctedFilename}"`);
        await db.run("UPDATE photos SET filename = ? WHERE id = ?", [correctedFilename, id]);
        fixed++;
      }
    } else {
      console.log(`❌ Not found: ID ${id}, filename: "${correctedFilename}"`);
      notFound++;
    }
  }

  console.log(`\n📈 Summary:`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Not found: ${notFound}`);
  console.log(`   Total processed: ${rows.length}`);

  // Close database connection
  await db.close();
}

fixFilenames().catch(console.error);
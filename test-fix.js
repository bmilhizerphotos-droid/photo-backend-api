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

async function testFix() {
  console.log("🧪 Testing filename fix on first 10 records...");

  // Get first 10 photos
  const rows = await db.all("SELECT id, filename FROM photos LIMIT 10");

  for (const row of rows) {
    const { id, filename } = row;
    console.log(`\nID ${id}: "${filename}"`);

    let correctedFilename = filename;

    // Remove leading ". " if present
    if (filename.startsWith(". ")) {
      correctedFilename = filename.substring(2);
      console.log(`  -> Corrected: "${correctedFilename}"`);
    }

    // Try to find the file
    const filePath = findFileRecursive(BASE_PHOTO_DIR, correctedFilename);
    if (filePath) {
      console.log(`  ✅ Found at: ${filePath.replace(BASE_PHOTO_DIR, 'G:/Photos')}`);
    } else {
      console.log(`  ❌ Not found`);
    }
  }

  await db.close();
}

testFix().catch(console.error);
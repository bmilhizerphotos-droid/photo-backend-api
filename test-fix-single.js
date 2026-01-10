import db from "./db.js";
import fs from "fs";
import path from "path";

// Configuration
const BASE_PHOTO_DIR = "G:/Photos";

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

async function testSingle() {
  console.log("🧪 Testing filename fix on ID 1...");

  const row = await db.get("SELECT id, filename FROM photos WHERE id = 1");
  const { id, filename } = row;
  console.log(`ID ${id}: "${filename}"`);

  let correctedFilename = filename;

  // Remove leading ". " if present
  if (filename.startsWith(". ")) {
    correctedFilename = filename.substring(2);
    console.log(`  -> Corrected: "${correctedFilename}"`);
  }

  // Try to find the file
  const filePath = findFileCaseInsensitive(BASE_PHOTO_DIR, correctedFilename);
  if (filePath) {
    console.log(`  ✅ Found at: ${filePath}`);
    console.log(`  📁 Relative: ${filePath.replace(BASE_PHOTO_DIR, 'G:/Photos')}`);
  } else {
    console.log(`  ❌ Not found`);
  }

  await db.close();
}

testSingle().catch(console.error);
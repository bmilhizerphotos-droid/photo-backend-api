import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// 🔹 CHANGE THIS ONLY IF YOUR PHOTOS LIVE ELSEWHERE
const BASE_PHOTO_DIR = "G:/Photos";
const DB_PATH = "./photo-db.sqlite";

// ---------------- UTIL ----------------
function walkDir(root, fileMap) {
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    let entries;

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // skip unreadable dirs
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else {
        // first match wins (intentional)
        if (!fileMap.has(e.name)) {
          fileMap.set(e.name, full);
        }
      }
    }
  }
}

// ---------------- MAIN ----------------
(async () => {
  console.log("=================================");
  console.log("📸 Starting one-time photo index");
  console.log("=================================");

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // Add column if missing
  const columns = await db.all(`PRAGMA table_info(photos)`);
  const hasFullPath = columns.some(c => c.name === "full_path");

  if (!hasFullPath) {
    console.log("➕ Adding full_path column");
    await db.exec(`ALTER TABLE photos ADD COLUMN full_path TEXT`);
  } else {
    console.log("ℹ️ full_path column already exists");
  }

  console.log("🔍 Scanning photo directories...");
  const fileMap = new Map();
  walkDir(BASE_PHOTO_DIR, fileMap);
  console.log(`✅ Indexed ${fileMap.size} unique filenames`);

  const rows = await db.all(`SELECT id, filename FROM photos`);
  let updated = 0;
  let missing = 0;

  console.log("🧠 Resolving DB filenames...");

  for (const row of rows) {
    const fullPath = fileMap.get(row.filename);
    if (fullPath) {
      await db.run(
        `UPDATE photos SET full_path = ? WHERE id = ?`,
        [fullPath, row.id]
      );
      updated++;
    } else {
      missing++;
    }

    if (updated % 1000 === 0 && updated > 0) {
      console.log(`… ${updated} paths resolved`);
    }
  }

  console.log("=================================");
  console.log("📊 Indexing complete");
  console.log(`✅ Paths resolved: ${updated}`);
  console.log(`⚠️ Missing files: ${missing}`);
  console.log("=================================");

  await db.close();
  process.exit(0);
})();

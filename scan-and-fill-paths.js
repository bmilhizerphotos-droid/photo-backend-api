import fs from "fs";
import path from "path";
import db from "./db.js";

const PHOTO_ROOT = process.env.PHOTO_ROOT || "G:/Photos";

function findFile(root, targetName) {
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    let entries;

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === targetName) return full;
    }
  }
  return null;
}

(async () => {
  const rows = await db.all("SELECT id, filename FROM photos");

  console.log(`🔍 Scanning ${rows.length} photos...`);

  for (const row of rows) {
    const fullPath = findFile(PHOTO_ROOT, row.filename);
    const thumbPath = fullPath
      ? findFile(PHOTO_ROOT, row.filename + ".thumb.jpg")
      : null;

    if (!fullPath) {
      console.warn(`❌ Missing full photo: ${row.filename}`);
      continue;
    }

    if (!thumbPath) {
      console.warn(`⚠️ Missing thumbnail: ${row.filename}`);
    }

    await db.run(
      `UPDATE photos
       SET full_path = ?, thumbnail_path = ?
       WHERE id = ?`,
      [fullPath, thumbPath, row.id]
    );

    console.log(`✅ Updated ID ${row.id}`);
  }

  console.log("🎉 Scan complete");
  process.exit(0);
})();
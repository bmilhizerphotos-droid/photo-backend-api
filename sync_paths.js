import db from './db.js';
import fs from 'fs/promises';
import path from 'path';

const PHOTO_DIR = "g:\\photos";

async function getFilesRecursive(dir) {
  let results = [];
  try {
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const file of list) {
      const res = path.resolve(dir, file.name);
      if (file.isDirectory()) {
        results = results.concat(await getFilesRecursive(res));
      } else {
        results.push(res);
      }
    }
  } catch (e) { console.error(`Error reading ${dir}:`, e.message); }
  return results;
}

async function sync() {
  console.log("=========================================");
  console.log("🚀 Starting Case-Insensitive Sync...");
  console.log("=========================================");

  try {
    const allFilePaths = await getFilesRecursive(PHOTO_DIR);
    
    // Maps use lowercase keys to ensure JPG matches jpg
    const fileMap = new Map();
    const thumbMap = new Map();

    for (const fPath of allFilePaths) {
      const fileName = path.basename(fPath);
      const lowerName = fileName.toLowerCase();
      
      if (lowerName.endsWith('.thumb.jpg')) {
        // "image.jpg.thumb.jpg" -> "image.jpg"
        const originalName = lowerName.replace('.thumb.jpg', '');
        thumbMap.set(originalName, fPath);
      } else if (/\.(png|jpg|jpeg|webp)$/i.test(fileName)) {
        fileMap.set(lowerName, fPath);
      }
    }

    console.log(`[Disk] Scanned ${fileMap.size} images and ${thumbMap.size} thumbnails.`);

    const dbPhotos = await db.all("SELECT id, filename FROM photos");
    console.log(`[DB] Syncing ${dbPhotos.length} records...`);

    await db.run("BEGIN TRANSACTION");
    let updated = 0;

    for (const photo of dbPhotos) {
      const lowerFilename = photo.filename.toLowerCase();
      const fullPath = fileMap.get(lowerFilename);
      
      if (fullPath) {
        // Match thumbnail using the lowercase filename
        const thumbPath = thumbMap.get(lowerFilename) || fullPath;
        
        await db.run(
          "UPDATE photos SET full_path = ?, thumbnail_path = ? WHERE id = ?",
          [fullPath, thumbPath, photo.id]
        );
        updated++;
      }
      
      if (updated % 5000 === 0 && updated !== 0) console.log(`...Processed ${updated}...`);
    }

    await db.run("COMMIT");
    console.log(`✅ Sync Complete. Updated ${updated} paths.`);
    
  } catch (error) {
    try { await db.run("ROLLBACK"); } catch(e) {}
    console.error("❌ Sync Failed:", error);
  } finally {
    process.exit(0);
  }
}

sync();
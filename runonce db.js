// migrate.js
import db from './db.js';

async function migrate() {
  console.log("Adding columns to existing database...");
  try {
    await db.exec(`ALTER TABLE photos ADD COLUMN full_path TEXT;`);
    await db.exec(`ALTER TABLE photos ADD COLUMN thumbnail_path TEXT;`);
    console.log("✅ Columns added successfully.");
  } catch (err) {
    console.log("⚠️ Columns might already exist, skipping...");
  }
  process.exit();
}

migrate();
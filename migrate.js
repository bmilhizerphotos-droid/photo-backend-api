import db from './db.js';

async function migrate() {
  console.log("=========================================");
  console.log("🛠️ Starting Database Migration...");
  console.log("=========================================");

  try {
    // 1. Check current columns
    const tableInfo = await db.all("PRAGMA table_info(photos)");
    const columns = tableInfo.map(c => c.name);

    console.log(`[Info] Current columns: ${columns.join(", ")}`);

    // 2. Add full_path if missing
    if (!columns.includes('full_path')) {
      console.log("[Action] Adding 'full_path' column...");
      await db.run("ALTER TABLE photos ADD COLUMN full_path TEXT DEFAULT ''");
    }

    // 3. Add thumbnail_path if missing
    if (!columns.includes('thumbnail_path')) {
      console.log("[Action] Adding 'thumbnail_path' column...");
      await db.run("ALTER TABLE photos ADD COLUMN thumbnail_path TEXT DEFAULT ''");
    }

    console.log("\n✅ Migration Successful!");
    console.log("Your database now has the correct structure for the sync script.");
    
  } catch (error) {
    console.error("❌ Migration Failed:", error);
  } finally {
    console.log("=========================================");
    process.exit(0);
  }
}

migrate();
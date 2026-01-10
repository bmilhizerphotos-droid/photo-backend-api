import db from "./db.js";

// Quick fix for the first few problematic records
async function quickFix() {
  console.log("🔧 Quick fix for first 5 records...");

  // Get first 5 records
  const rows = await db.all("SELECT id, filename FROM photos LIMIT 5");

  for (const row of rows) {
    const { id, filename } = row;

    if (filename.startsWith(". ")) {
      const correctedFilename = filename.substring(2);
      console.log(`Fixing ID ${id}: "${filename}" -> "${correctedFilename}"`);
      await db.run("UPDATE photos SET filename = ? WHERE id = ?", [correctedFilename, id]);
    }
  }

  console.log("✅ Quick fix complete");
  await db.close();
}

quickFix().catch(console.error);
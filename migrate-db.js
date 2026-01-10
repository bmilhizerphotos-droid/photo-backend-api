import db from "./db.js";

await db.exec(`
  ALTER TABLE photos ADD COLUMN full_path TEXT;
`);

await db.exec(`
  ALTER TABLE photos ADD COLUMN thumbnail_path TEXT;
`);

console.log("✅ Database schema updated (paths added)");
process.exit(0);

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

(async () => {
  const mainDb = await open({
    filename: './photo-db.sqlite',
    driver: sqlite3.Database
  });

  const searchDb = await open({
    filename: './photo-search.sqlite',
    driver: sqlite3.Database
  });

  // Clear and repopulate search index (derived data only)
  await searchDb.exec(`DELETE FROM photo_search_fts;`);

  const rows = await mainDb.all(`
    SELECT photo_id, caption, keywords
    FROM photo_captions
  `);

  const stmt = await searchDb.prepare(`
    INSERT INTO photo_search_fts (photo_id, caption, keywords)
    VALUES (?, ?, ?)
  `);

  for (const r of rows) {
    await stmt.run(r.photo_id, r.caption, r.keywords);
  }

  await stmt.finalize();

  console.log(`Synced ${rows.length} records to photo-search.sqlite`);

  await mainDb.close();
  await searchDb.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});

// sync-photo-search-fts.cjs
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

(async () => {
  const db = await open({
    filename: './photo-db.sqlite',
    driver: sqlite3.Database
  });

  // Rebuild FTS from photo_captions (safe, idempotent)
  await db.exec(`
    DELETE FROM photo_search_fts;
    INSERT INTO photo_search_fts (rowid, caption, keywords)
    SELECT photo_id, caption, keywords FROM photo_captions;
  `);

  console.log('FTS index synced from photo_captions');
  await db.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});

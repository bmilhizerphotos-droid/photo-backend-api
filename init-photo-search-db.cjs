const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

(async () => {
  const db = await open({
    filename: './photo-search.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS photo_search_fts
    USING fts5(
      photo_id UNINDEXED,
      caption,
      keywords
    );
  `);

  console.log('photo-search.sqlite initialized');
  await db.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});

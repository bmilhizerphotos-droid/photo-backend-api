const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

(async () => {
  const db = await open({
    filename: './photo-db.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`DROP TABLE IF EXISTS photo_search_fts;`);

  await db.exec(`
    CREATE VIRTUAL TABLE photo_search_fts
    USING fts5(
      caption,
      keywords,
      content='photo_captions',
      content_rowid='photo_id'
    );
  `);

  console.log('FTS table rebuilt');
  await db.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

(async () => {
  const db = await open({
    filename: './photo-search.sqlite',
    driver: sqlite3.Database
  });

  const tables = await db.all(`
    SELECT name, type
    FROM sqlite_master
    WHERE type IN ('table', 'index')
    ORDER BY name
  `);

  console.log('Tables / indexes:');
  console.log(tables);

  const count = await db.get(`SELECT COUNT(*) AS c FROM photo_search_fts`);
  console.log('FTS rows:', count.c);

  await db.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

(async () => {
  const db = await open({
    filename: './photo-db.sqlite',
    driver: sqlite3.Database
  });

  const rows = await db.all(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `);

  for (const r of rows) {
    console.log(`-- ${r.type}: ${r.name}`);
    console.log(r.sql + ';\n');
  }

  await db.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});

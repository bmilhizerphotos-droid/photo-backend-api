// generate-photo-captions.cjs
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// TEMP: simple placeholder captions (safe baseline)
// We will swap in real AI later.
function generateCaption(photo) {
  const name = photo.filename || 'photo';
  return {
    caption: `Photo named ${name}`,
    keywords: name.replace(/\W+/g, ' ').toLowerCase()
  };
}

(async () => {
  const db = await open({
    filename: './photo-db.sqlite',
    driver: sqlite3.Database
  });

  const photos = await db.all(`
    SELECT id, filename
    FROM photos
    WHERE id NOT IN (SELECT photo_id FROM photo_captions)
    LIMIT 50
  `);

  let count = 0;

  for (const photo of photos) {
    const { caption, keywords } = generateCaption(photo);

    await db.run(
      `INSERT OR REPLACE INTO photo_captions
       (photo_id, caption, keywords, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      photo.id,
      caption,
      keywords
    );

    count++;
  }

  console.log(`Generated captions for ${count} photos`);
  await db.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});

import { db } from './db.js';

const suspiciousNames = [
  'ashcan',
  'closet',
  'garbage can',
  'handbasin',
  'lavabo',
  'press',
  'trash can',
  'wardrobe',
  'washbasin',
  'washbowl'
];

console.log('\n--- STARTING MIGRATION ---\n');

for (const name of suspiciousNames) {

  console.log(`Processing: ${name}`);

  // Find the person row
  const person = await db.get(
    `SELECT id FROM people WHERE LOWER(name) = LOWER(?)`,
    [name]
  );

  if (!person) {
    console.log(`  -> Not found, skipping`);
    continue;
  }

  const personId = person.id;

  // Get associated photos
  const photoLinks = await db.all(
    `SELECT photo_id FROM photo_people WHERE person_id = ?`,
    [personId]
  );

  if (photoLinks.length === 0) {
    console.log(`  -> No photo links found`);
    continue;
  }

  // Ensure tag exists
  let tag = await db.get(
    `SELECT id FROM tags WHERE LOWER(name) = LOWER(?)`,
    [name]
  );

  if (!tag) {
    const result = await db.run(
      `INSERT INTO tags (name) VALUES (?)`,
      [name]
    );
    tag = { id: result.lastID };
    console.log(`  -> Created tag`);
  }

  const tagId = tag.id;

  // Insert into photo_tags
  for (const row of photoLinks) {
    await db.run(
      `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)`,
      [row.photo_id, tagId]
    );
  }

  console.log(`  -> Linked ${photoLinks.length} photos to tag`);

  // Remove from photo_people
  await db.run(
    `DELETE FROM photo_people WHERE person_id = ?`,
    [personId]
  );

  console.log(`  -> Removed photo_people links`);

  // Delete from people
  await db.run(
    `DELETE FROM people WHERE id = ?`,
    [personId]
  );

  console.log(`  -> Removed from people table`);
}

console.log('\n--- MIGRATION COMPLETE ---\n');

process.exit(0);

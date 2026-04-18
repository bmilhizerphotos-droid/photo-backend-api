import { db } from './db.js';

console.log('\n--- STRICT HUMAN CLEANUP START ---\n');

// Regex: First Last (capitalized), optional hyphen in last name
const humanNameRegex = /^[A-Z][a-z]+(?:-[A-Z][a-z]+)?\s[A-Z][a-z]+(?:-[A-Z][a-z]+)?$/;

// Get all people
const people = await db.all(`SELECT id, name FROM people`);

for (const person of people) {

  if (humanNameRegex.test(person.name)) {
    continue; // Valid human name
  }

  console.log(`Converting to tag: ${person.name}`);

  // Get linked photos
  const photoLinks = await db.all(
    `SELECT photo_id FROM photo_people WHERE person_id = ?`,
    [person.id]
  );

  if (photoLinks.length === 0) {
    // No links, just delete
    await db.run(`DELETE FROM people WHERE id = ?`, [person.id]);
    console.log(`  -> Deleted unused entry`);
    continue;
  }

  // Ensure tag exists
  let tag = await db.get(
    `SELECT id FROM tags WHERE LOWER(name) = LOWER(?)`,
    [person.name]
  );

  if (!tag) {
    const result = await db.run(
      `INSERT INTO tags (name) VALUES (?)`,
      [person.name]
    );
    tag = { id: result.lastID };
    console.log(`  -> Created tag`);
  }

  const tagId = tag.id;

  // Insert tag links
  for (const row of photoLinks) {
    await db.run(
      `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)`,
      [row.photo_id, tagId]
    );
  }

  console.log(`  -> Linked ${photoLinks.length} photos`);

  // Remove person links
  await db.run(
    `DELETE FROM photo_people WHERE person_id = ?`,
    [person.id]
  );

  // Delete person
  await db.run(
    `DELETE FROM people WHERE id = ?`,
    [person.id]
  );

  console.log(`  -> Removed from people`);
}

console.log('\n--- CLEANUP COMPLETE ---\n');

process.exit(0);

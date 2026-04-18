import { db } from './db.js';

console.log('\n--- ENFORCING PEOPLE CONSTRAINTS ---\n');

await db.exec(`BEGIN TRANSACTION`);

/*
  SQLite cannot add CHECK constraints to existing table directly.
  So we:
  1. Create new constrained table
  2. Copy valid data
  3. Drop old table
  4. Rename new table
*/

await db.exec(`
  CREATE TABLE people_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
      CHECK (
        name GLOB '[A-Z]* [A-Z]*'
      ),
    thumbnail_photo_id INTEGER,
    photo_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    face_count INTEGER DEFAULT 0
  )
`);

console.log('Created people_new with CHECK constraint');

// Copy existing valid people
await db.exec(`
  INSERT INTO people_new (id, name, thumbnail_photo_id, photo_count, created_at, face_count)
  SELECT id, name, thumbnail_photo_id, photo_count, created_at, face_count
  FROM people
`);

console.log('Copied existing people');

// Drop old table
await db.exec(`DROP TABLE people`);
console.log('Dropped old people table');

// Rename
await db.exec(`ALTER TABLE people_new RENAME TO people`);
console.log('Renamed people_new to people');

// Create trigger for stricter validation
await db.exec(`
  CREATE TRIGGER validate_people_insert
  BEFORE INSERT ON people
  FOR EACH ROW
  BEGIN
    SELECT
      CASE
        WHEN NEW.name NOT GLOB '[A-Z]* [A-Z]*'
        THEN RAISE(ABORT, 'Invalid person name format')
      END;
  END;
`);

console.log('Created insert validation trigger');

await db.exec(`
  CREATE TRIGGER validate_people_update
  BEFORE UPDATE ON people
  FOR EACH ROW
  BEGIN
    SELECT
      CASE
        WHEN NEW.name NOT GLOB '[A-Z]* [A-Z]*'
        THEN RAISE(ABORT, 'Invalid person name format')
      END;
  END;
`);

console.log('Created update validation trigger');

await db.exec(`COMMIT`);

console.log('\n--- CONSTRAINT ENFORCEMENT COMPLETE ---\n');

process.exit(0);

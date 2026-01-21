import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create database connection
const db = new sqlite3.Database(path.join(__dirname, "photo-db.sqlite"));

// Promisify database operations
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize database schema
await dbRun(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    full_path TEXT,
    thumbnail_path TEXT,
    is_favorite BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

await dbRun(`
  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

await dbRun(`
  CREATE TABLE IF NOT EXISTS photo_albums (
    photo_id INTEGER,
    album_id INTEGER,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id, album_id),
    FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
    FOREIGN KEY (album_id) REFERENCES albums (id) ON DELETE CASCADE
  )
`);

// People table - stores unique people identified in photos
await dbRun(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    thumbnail_photo_id INTEGER,
    photo_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thumbnail_photo_id) REFERENCES photos (id) ON DELETE SET NULL
  )
`);

// Photo-people relationship table
await dbRun(`
  CREATE TABLE IF NOT EXISTS photo_people (
    photo_id INTEGER,
    person_id INTEGER,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id, person_id),
    FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE
  )
`);

// Create indexes for performance
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photos_favorite ON photos(is_favorite)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photos_filename ON photos(filename)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photo_albums_photo ON photo_albums(photo_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photo_albums_album ON photo_albums(album_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_people_name ON people(name)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photo_people_photo ON photo_people(photo_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photo_people_person ON photo_people(person_id)`);

console.log("✅ SQLite DB opened:", path.join(__dirname, "photo-db.sqlite"));

// Graceful shutdown handler
function closeDb() {
  return new Promise((resolve) => {
    db.close((err) => {
      if (err) console.error("Error closing database:", err);
      else console.log("✅ Database connection closed");
      resolve();
    });
  });
}

process.on('SIGTERM', async () => {
  await closeDb();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await closeDb();
  process.exit(0);
});

export { dbRun, dbGet, dbAll, closeDb };
export default { run: dbRun, get: dbGet, all: dbAll, close: closeDb };
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create database connection
const db = new sqlite3.Database(path.join(__dirname, "photo-db.sqlite"));
db.run("PRAGMA busy_timeout = 5000"); // Set busy timeout to 5 seconds

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

const dbBegin = () => {
  return dbRun("BEGIN TRANSACTION");
};

const dbCommit = () => {
  return dbRun("COMMIT TRANSACTION");
};

const dbRollback = () => {
  return dbRun("ROLLBACK TRANSACTION");
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
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    cover_photo_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cover_photo_id) REFERENCES photos (id) ON DELETE SET NULL
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

// Face embeddings table - stores detected faces
await dbRun(`
  CREATE TABLE IF NOT EXISTS face_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL,
    person_id INTEGER,
    embedding BLOB NOT NULL,
    bbox_x REAL,
    bbox_y REAL,
    bbox_width REAL,
    bbox_height REAL,
    confidence REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
  )
`);

// Person reference embeddings - known face templates for matching
await dbRun(`
  CREATE TABLE IF NOT EXISTS person_reference_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    source_face_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
    FOREIGN KEY (source_face_id) REFERENCES face_embeddings(id) ON DELETE SET NULL
  )
`);

// Tags table - stores tag definitions
// Types: 'user' (manual), 'ai' (auto-generated), 'person' (linked to people)
await dbRun(`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'user',
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, type)
  )
`);

// Photo-tags relationship table (many-to-many)
await dbRun(`
  CREATE TABLE IF NOT EXISTS photo_tags (
    photo_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    added_by TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id, tag_id),
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  )
`);

// Add face_scan_status column to photos if not exists
try {
  await dbRun(`ALTER TABLE photos ADD COLUMN face_scan_status TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// Add face_count column to people if not exists
try {
  await dbRun(`ALTER TABLE people ADD COLUMN face_count INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

// Add phash column to photos for duplicate detection
try {
  await dbRun(`ALTER TABLE photos ADD COLUMN phash TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// Add is_duplicate column to photos
try {
  await dbRun(`ALTER TABLE photos ADD COLUMN is_duplicate BOOLEAN DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

// Add duplicate_of column to photos (references the original photo)
try {
  await dbRun(`ALTER TABLE photos ADD COLUMN duplicate_of INTEGER REFERENCES photos(id)`);
} catch (e) {
  // Column already exists, ignore
}

// Add user_id column to albums for user-specific albums
try {
  await dbRun(`ALTER TABLE albums ADD COLUMN user_id TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// Add description column to albums
try {
  await dbRun(`ALTER TABLE albums ADD COLUMN description TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// Add cover_photo_id column to albums
try {
  await dbRun(`ALTER TABLE albums ADD COLUMN cover_photo_id INTEGER REFERENCES photos(id)`);
} catch (e) {
  // Column already exists, ignore
}

// Add updated_at column to albums
try {
  await dbRun(`ALTER TABLE albums ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
} catch (e) {
  // Column already exists, ignore
}

// Memories table - stores AI-generated event memories
await dbRun(`
  CREATE TABLE IF NOT EXISTS memories (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT,
    narrative     TEXT,
    cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
    event_date_start TEXT,
    event_date_end   TEXT,
    location_label   TEXT,
    center_lat       REAL,
    center_lng       REAL,
    photo_count      INTEGER DEFAULT 0,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Memory-photos junction table
await dbRun(`
  CREATE TABLE IF NOT EXISTS memory_photos (
    memory_id INTEGER NOT NULL,
    photo_id  INTEGER NOT NULL,
    PRIMARY KEY (memory_id, photo_id),
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
    FOREIGN KEY (photo_id)  REFERENCES photos(id)  ON DELETE CASCADE
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
await dbRun(`CREATE INDEX IF NOT EXISTS idx_face_embeddings_photo ON face_embeddings(photo_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_face_embeddings_person ON face_embeddings(person_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photos_face_scan_status ON photos(face_scan_status)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photos_phash ON photos(phash)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photos_is_duplicate ON photos(is_duplicate)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(type)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photo_tags_photo ON photo_tags(photo_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photos_created ON photos(created_at DESC)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_memories_dates ON memories(event_date_start)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_memory_photos_memory ON memory_photos(memory_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_memory_photos_photo ON memory_photos(photo_id)`);

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

export { dbRun, dbGet, dbAll, dbBegin, dbCommit, dbRollback, closeDb };
export default { run: dbRun, get: dbGet, all: dbAll, begin: dbBegin, commit: dbCommit, rollback: dbRollback, close: closeDb };
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export const db = await open({
  filename: "photo-db.sqlite",
  driver: sqlite3.Database,
});

export async function dbRun(sql, params = []) {
  return db.run(sql, params);
}

export async function dbGet(sql, params = []) {
  return db.get(sql, params);
}

export async function dbAll(sql, params = []) {
  return db.all(sql, params);
}

/* ================================
   FACE DETECTION TABLES (FOUNDATION)
   ================================ */

await dbRun(`
  CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    box_x REAL NOT NULL,
    box_y REAL NOT NULL,
    box_width REAL NOT NULL,
    box_height REAL NOT NULL,
    confidence REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
  )
`);

await dbRun(`
  CREATE TABLE IF NOT EXISTS face_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    started_at DATETIME,
    finished_at DATETIME,
    photos_processed INTEGER DEFAULT 0,
    faces_detected INTEGER DEFAULT 0
  )
`);

await dbRun(`CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_face_jobs_status ON face_jobs(status)`);

/* ================================
   AI SEARCH INDEX TABLES
   ================================ */

await dbRun(`
  CREATE TABLE IF NOT EXISTS photo_ai_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    confidence REAL,
    model TEXT,
    source TEXT DEFAULT 'vision',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(photo_id, label),
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
  )
`);

await dbRun(`CREATE INDEX IF NOT EXISTS idx_photo_ai_labels_photo ON photo_ai_labels(photo_id)`);
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photo_ai_labels_label ON photo_ai_labels(label)`);

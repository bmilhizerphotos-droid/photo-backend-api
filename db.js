import sqlite3 from "sqlite3";
import { open } from "sqlite";

export const db = await open({
  filename: "photo-db.sqlite",
  driver: sqlite3.Database,
});

// Enable WAL mode for better concurrency (readers don't block writers)
await db.run("PRAGMA journal_mode=WAL");
await db.run("PRAGMA busy_timeout=5000");
await db.run("PRAGMA synchronous=NORMAL");

export async function dbRun(sql, params = []) {
  return db.run(sql, params);
}

export async function dbGet(sql, params = []) {
  return db.get(sql, params);
}

export async function dbAll(sql, params = []) {
  return db.all(sql, params);
}

export async function dbBegin() {
  return db.run("BEGIN");
}

export async function dbCommit() {
  return db.run("COMMIT");
}

export async function dbRollback() {
  return db.run("ROLLBACK");
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
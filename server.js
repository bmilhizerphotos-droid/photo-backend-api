// FILE: server.js
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { Worker } from "worker_threads";
import { dbGet, dbAll, dbRun } from "./db.js";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import WordPOS from "wordpos";
import { scanAll, getScanStats } from "./duplicate-detector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "firebase-service-account.json"), "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const ADMIN_EMAIL = "bmilhizerphotos@gmail.com";

const app = express();
const PORT = process.env.PORT || 3001;
const PHOTO_ROOT = process.env.PHOTO_ROOT || "G:/Photos";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
let duplicateScanRunning = false;

const allowedOrigins = [
  "https://photos.milhizerfamilyphotos.org",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];
const wordpos = new WordPOS();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(cors({ origin: allowedOrigins, credentials: true, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));
app.use(express.json());

async function runMigrations() {
  try {
    await dbRun("ALTER TABLE photos ADD COLUMN is_deleted INTEGER DEFAULT 0");
  } catch (err) {
    if (!/duplicate column/i.test(err?.message || "")) {
      console.error("Failed to add is_deleted column:", err);
    }
  }

  // Document detection columns
  for (const sql of [
    "ALTER TABLE photos ADD COLUMN is_document INTEGER DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN document_scanned INTEGER DEFAULT 0",
  ]) {
    try { await dbRun(sql); } catch (err) {
      if (!/duplicate column/i.test(err?.message || "")) console.error(sql, err);
    }
  }
  await dbRun("CREATE INDEX IF NOT EXISTS idx_photos_is_document ON photos(is_document)");

  // Screenshot detection columns
  for (const sql of [
    "ALTER TABLE photos ADD COLUMN is_screenshot INTEGER DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN screenshot_scanned INTEGER DEFAULT 0",
  ]) {
    try { await dbRun(sql); } catch (err) {
      if (!/duplicate column/i.test(err?.message || "")) console.error(sql, err);
    }
  }
  await dbRun("CREATE INDEX IF NOT EXISTS idx_photos_is_screenshot ON photos(is_screenshot)");

  // Video column
  for (const sql of [
    "ALTER TABLE photos ADD COLUMN is_video INTEGER DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN video_duration INTEGER",  // seconds
  ]) {
    try { await dbRun(sql); } catch (err) {
      if (!/duplicate column/i.test(err?.message || "")) console.error(sql, err);
    }
  }
  await dbRun("CREATE INDEX IF NOT EXISTS idx_photos_is_video ON photos(is_video)");

  // Phase 1 migrations
  for (const sql of [
    "ALTER TABLE photos ADD COLUMN deleted_at DATETIME",
    "ALTER TABLE people ADD COLUMN birthday DATE",
  ]) {
    try { await dbRun(sql); } catch (err) {
      if (!/duplicate column/i.test(err?.message || "")) console.error(sql, err);
    }
  }
  await dbRun("CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos(deleted_at)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_photos_is_deleted ON photos(is_deleted, deleted_at DESC)");

  // Auto-purge trash older than retention days on startup
  const TRASH_RETENTION_DAYS = parseInt(process.env.TRASH_RETENTION_DAYS || "30", 10);
  try {
    const purged = await dbRun(
      `DELETE FROM photos WHERE is_deleted = 1 AND deleted_at IS NOT NULL AND deleted_at < datetime('now', '-${TRASH_RETENTION_DAYS} days')`
    );
    if (purged?.changes > 0) console.log(`Auto-purged ${purged.changes} photos from trash (>${TRASH_RETENTION_DAYS} days old)`);
  } catch (err) { console.error("Trash auto-purge failed:", err); }

  // App users table for approval tracking
  await dbRun(`CREATE TABLE IF NOT EXISTS app_users (
    uid TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT,
    is_approved INTEGER NOT NULL DEFAULT 0,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Albums schema
  await dbRun(`CREATE TABLE IF NOT EXISTS albums (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS album_photos (
    album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    photo_id  INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    added_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (album_id, photo_id)
  )`);
}

// ---------------- AUTHENTICATION MIDDLEWARE ----------------
async function authenticateToken(req, res, next) {
  // Check for token in Authorization header first
  let token = null;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.query.token) {
    // For image requests, accept token as query parameter
    token = req.query.token;
  }
  
  if (!token) {
    console.log(`ΓÜá∩╕Å  No token provided for ${req.method} ${req.path}`);
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }
  
  // Log authentication attempt (no token details in production)
  if (process.env.NODE_ENV === 'development') {
    console.log(`≡ƒöÉ Authenticating ${req.method} ${req.path}`);
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;

    await dbRun(
      `INSERT INTO app_users (uid, email, display_name, last_seen)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(uid) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         last_seen = datetime('now')`,
      [decodedToken.uid, decodedToken.email || '', decodedToken.name || null]
    );

    if (decodedToken.email !== ADMIN_EMAIL) {
      const userRow = await dbGet('SELECT is_approved FROM app_users WHERE uid = ?', [decodedToken.uid]);
      if (!userRow?.is_approved) {
        return res.status(403).json({ error: "Your request is pending approval." });
      }
    }

    next();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(403).json({ error: "Forbidden: Invalid token" });
    }
  }
}

// verifyTokenOnly: verifies token + upserts user but does NOT enforce approval gate
async function verifyTokenOnly(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) token = authHeader.substring(7);
  else if (req.query.token) token = req.query.token;
  if (!token) return res.status(401).json({ error: "Unauthorized: No token provided" });
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    await dbRun(
      `INSERT INTO app_users (uid, email, display_name, last_seen)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(uid) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         last_seen = datetime('now')`,
      [decodedToken.uid, decodedToken.email || '', decodedToken.name || null]
    );
    next();
  } catch {
    return res.status(403).json({ error: "Forbidden: Invalid token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.email === ADMIN_EMAIL) return next();
  return res.status(403).json({ error: "Forbidden" });
}

// ---------------- CURRENT USER STATUS (NO APPROVAL GATE) ----------------
app.get("/api/me", verifyTokenOnly, async (req, res) => {
  try {
    const rawEmail = req.user.email || '';
    const email = rawEmail.toLowerCase().trim();
    const isAdmin = email === ADMIN_EMAIL.toLowerCase().trim();
    const userRow = await dbGet('SELECT is_approved FROM app_users WHERE uid = ?', [req.user.uid]);
    const isApproved = isAdmin || Boolean(userRow?.is_approved);
    console.log(`[/api/me] uid=${req.user.uid} rawEmail="${rawEmail}" isAdmin=${isAdmin} isApproved=${isApproved}`);
    // Explicitly return isAdmin as a boolean so the client can rely on it
    return res.json({
      isApproved: isApproved,
      isAdmin: isAdmin,
      email: rawEmail,
      uid: req.user.uid,
    });
  } catch (err) {
    console.error('[/api/me] error:', err);
    return res.status(500).json({ error: "Failed to fetch user status" });
  }
});

// ---------------- HEALTH CHECK (NO AUTH REQUIRED) ----------------
app.get("/health", async (req, res) => {
  try {
    await dbGet("SELECT 1");
    res.json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Γ¥î Health check failed:", err);
    res.status(500).json({ status: "error", message: "Database unreachable" });
  }
});

// ---------------- UTIL ----------------
function validatePhotoId(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return null;
  }
  return numId;
}

// Security: Validate that a path is within the allowed PHOTO_ROOT directory
function isPathWithinRoot(filePath) {
  if (!filePath) return false;
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(PHOTO_ROOT);
  return resolvedPath.startsWith(resolvedRoot + path.sep) || resolvedPath === resolvedRoot;
}

function findFileRecursive(root, targetName) {
  // Security: Ensure we only search within PHOTO_ROOT
  const resolvedRoot = path.resolve(root);
  if (!isPathWithinRoot(resolvedRoot)) {
    console.error(`Γ¥î Security: Attempted to search outside PHOTO_ROOT: ${root}`);
    return null;
  }

  const stack = [resolvedRoot];
  const targetLower = String(targetName).toLowerCase();

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        // Security: Double-check each path stays within bounds
        if (!isPathWithinRoot(fullPath)) continue;

        if (entry.isDirectory()) stack.push(fullPath);
        else if (entry.name.toLowerCase() === targetLower) return fullPath;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function getPhotoPathOr404(res, filename) {
  const filePath = findFileRecursive(PHOTO_ROOT, filename);
  if (!filePath) {
    res.sendStatus(404);
    return null;
  }
  const resolved = path.resolve(filePath);
  // Security: Final validation before returning
  if (!isPathWithinRoot(resolved)) {
    console.error(`Γ¥î Security: Path traversal blocked: ${resolved}`);
    res.sendStatus(404);
    return null;
  }
  return resolved;
}

// ── HEIC → JPEG conversion helper ────────────────────────────────────────────
// Sharp on Windows cannot decode HEVC-compressed HEIC files (iPhone photos).
// heic-convert uses libheif WASM which runs synchronously — it BLOCKS the
// Node.js event loop if called on the main thread.  We offload it to a
// worker_thread so the event loop stays free for all other requests.
const HEIC_EXTS = new Set([".heic", ".heif"]);
const HEIC_WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "heic-worker.js");

// Limit concurrent HEIC conversions to avoid spawning hundreds of threads.
let activeHeicWorkers = 0;
const MAX_HEIC_WORKERS = 6;
const heicQueue = [];

function runHeicWorker(filePath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(HEIC_WORKER_PATH, { workerData: { filePath } });
    worker.once("message", (msg) => {
      if (msg.ok) resolve(Buffer.from(msg.jpeg));
      else reject(new Error(msg.error));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`HEIC worker exited with code ${code}`));
    });
  });
}

function heicConvertWorker(filePath) {
  return new Promise((resolve, reject) => {
    const task = { filePath, resolve, reject };

    const runNext = () => {
      if (activeHeicWorkers >= MAX_HEIC_WORKERS) {
        heicQueue.push(task);
        return;
      }
      activeHeicWorkers++;
      runHeicWorker(task.filePath)
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          activeHeicWorkers--;
          if (heicQueue.length > 0) {
            const next = heicQueue.shift();
            activeHeicWorkers++;
            runHeicWorker(next.filePath)
              .then(next.resolve)
              .catch(next.reject)
              .finally(() => {
                activeHeicWorkers--;
              });
          }
        });
    };

    runNext();
  });
}

async function toSharpInput(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!HEIC_EXTS.has(ext)) {
    // Not HEIC — return the path directly; Sharp reads it natively
    return filePath;
  }
  // HEIC/HEIF — convert in a worker thread so event loop stays free.
  try {
    return await heicConvertWorker(filePath);
  } catch (err) {
    console.warn(`HEIC worker failed for ${filePath}: ${err.message} — falling back to Sharp native`);
    return filePath; // Sharp may still handle JPEG-disguised-as-HEIC
  }
}

// ---------------- LIST PHOTOS (PROTECTED) ----------------
// Important change: fullUrl now points at /display/:id (always JPEG)
app.get("/api/photos", authenticateToken, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);

    const rows = await dbAll(
      `
      SELECT
        p.id,
        p.filename,
        p.is_favorite,
        p.created_at,
        p.date_taken,
        GROUP_CONCAT(pa.album_id) as album_ids
      FROM photos p
      LEFT JOIN photo_albums pa ON p.id = pa.photo_id
      WHERE p.is_deleted = 0
      GROUP BY p.id
      ORDER BY COALESCE(p.date_taken, p.created_at) DESC, p.id DESC
      LIMIT ? OFFSET ?
    `,
      [limit, offset]
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        thumbnailUrl: `/thumbnails/${r.id}`,
        fullUrl: `/thumbnails/${r.id}?full=true`,
        isFavorite: Boolean(r.is_favorite),
        albumIds: r.album_ids ? r.album_ids.split(",").filter(Boolean).map(Number) : [],
        createdAt: r.created_at,
        dateTaken: r.date_taken ?? null,
      }))
    );
  } catch (err) {
    console.error("Γ¥î /api/photos error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ── On-disk thumbnail cache ───────────────────────────────────────────────────
// Generated thumbnails are saved to thumb-cache/{id}.jpg so repeat requests
// are served from disk without re-running Sharp or heic-convert.
const THUMB_CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "thumb-cache");
if (!fs.existsSync(THUMB_CACHE_DIR)) {
  fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
}

function thumbCachePath(id) {
  return path.join(THUMB_CACHE_DIR, `${id}.jpg`);
}

// ---------------- THUMBNAILS (PROTECTED) ----------------
app.get("/thumbnails/:id", authenticateToken, async (req, res) => {
  try {
    const id = validatePhotoId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }

    const row = await dbGet("SELECT filename, full_path, thumbnail_path FROM photos WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "Photo not found" });

    const serveFull = req.query.full === "true";

    // ── Full-size branch ──────────────────────────────────────────────────────
    if (serveFull) {
      let filePath = row.full_path;
      if (filePath && !isPathWithinRoot(filePath)) filePath = null;
      if (!filePath || filePath.includes(".thumb.") || !fs.existsSync(filePath)) {
        filePath = findFileRecursive(PHOTO_ROOT, row.filename);
      }
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Image not found" });
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

      const maxW = Number(req.query.w || 2400);
      const sharpInput = await toSharpInput(filePath);
      sharp(sharpInput)
        .rotate()
        .resize({ width: maxW, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .on("error", (e) => {
          if (!res.headersSent) res.status(500).json({ error: "Failed to process image" });
        })
        .pipe(res);
      return;
    }

    // ── Thumbnail branch ──────────────────────────────────────────────────────
    // 1. Check on-disk thumb cache (fastest)
    const cached = thumbCachePath(id);
    if (fs.existsSync(cached)) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      fs.createReadStream(cached).pipe(res);
      return;
    }

    // 2. Check DB-stored thumbnail_path (pre-generated .thumb.jpg alongside originals)
    let existingThumb = row.thumbnail_path;
    if (existingThumb && !isPathWithinRoot(existingThumb)) existingThumb = null;
    if (existingThumb && fs.existsSync(existingThumb)) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      fs.createReadStream(existingThumb).pipe(res);
      return;
    }

    // 3. Generate thumbnail from the original file.
    //    Prefer full_path from DB — avoids expensive findFileRecursive scan.
    let originalPath = row.full_path;
    if (originalPath && !isPathWithinRoot(originalPath)) originalPath = null;
    if (!originalPath || !fs.existsSync(originalPath)) {
      // full_path missing or stale — last resort: search the drive
      originalPath = findFileRecursive(PHOTO_ROOT, row.filename);
    }
    if (!originalPath || !fs.existsSync(originalPath)) {
      return res.status(404).json({ error: "Thumbnail not found" });
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");

    const thumbInput = await toSharpInput(originalPath);

    // Generate to buffer so we can cache AND send in one pass
    const thumbBuf = await sharp(thumbInput)
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();

    // Write to cache (non-blocking)
    fs.promises.writeFile(cached, thumbBuf).catch((e) =>
      console.warn(`thumb-cache write failed for ${id}:`, e.message)
    );

    res.send(thumbBuf);

  } catch (err) {
    console.error("Thumbnail/Image error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to load image" });
  }
});

// ---------------- DISPLAY JPEG (NEW, PROTECTED) ----------------
// Always returns a browser-friendly JPEG for modal viewing.
// Added /image route as alias to bypass Cloudflare cache issues
app.get(["/display/:id", "/image/:id"], authenticateToken, async (req, res) => {
  try {
    const id = validatePhotoId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }
    
    const row = await dbGet("SELECT filename, full_path, thumbnail_path FROM photos WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "Photo not found" });

    // CRITICAL: Use full_path, NOT thumbnail_path!
    let filePath = row.full_path;

    // Security: Validate database path is within PHOTO_ROOT
    if (filePath && !isPathWithinRoot(filePath)) {
      console.error(`Γ¥î Security: Invalid full_path in database for ID ${id}`);
      filePath = null;
    }

    // Verify it's the FULL image, not thumbnail
    if (!filePath || filePath.includes('.thumb.')) {
      console.warn(`ΓÜá∩╕Å  ID ${id}: Database has thumbnail path in full_path! Fixing...`);
      filePath = null; // Force search
    }

    if (!filePath || !fs.existsSync(filePath)) {
      console.log(`ΓÜá∩╕Å  Path not in DB or doesn't exist for ID ${id}, searching for ORIGINAL file...`);
      // Search for ORIGINAL file, not thumbnail
      filePath = findFileRecursive(PHOTO_ROOT, row.filename);
    }
    
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Γ¥î File not found for ID ${id}: ${row.filename}`);
      return res.status(404).json({ error: "Image not found" });
    }
    
    // Double-check we're NOT serving the thumbnail
    if (filePath.includes('.thumb.')) {
      console.error(`Γ¥î ERROR: Almost served thumbnail for ID ${id}! Path: ${filePath}`);
      return res.status(500).json({ error: "Internal error: thumbnail path detected" });
    }

    filePath = path.resolve(filePath);

    // Security: Final validation before serving
    if (!isPathWithinRoot(filePath)) {
      console.error(`Γ¥î Security: Path traversal blocked for ID ${id}: ${filePath}`);
      return res.status(404).json({ error: "Image not found" });
    }

    console.log(`Γ£à Serving FULL image ID ${id}: ${filePath}`);
    console.log(`   File size: ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB`);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate"); // Prevent Cloudflare caching
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // Resize to a sane max width to avoid massive files.
    const maxW = Number(req.query.w || 2400);
    
    console.log(`   Processing with Sharp (max width: ${maxW}px)...`);

    const displayInput = await toSharpInput(filePath);
    sharp(displayInput)
      .rotate() // respects EXIF orientation
      .resize({ width: maxW, withoutEnlargement: true })
      .jpeg({ quality: 85, progressive: true })
      .on("error", (e) => {
        console.error(`Γ¥î Sharp error for ID ${id}:`, e.message);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to process image" });
        }
      })
      .on("info", (info) => {
        console.log(`   Sharp output: ${info.width}x${info.height}, ${info.format}`);
      })
      .pipe(res)
      .on("error", (e) => {
        console.error(`Γ¥î Pipe error for ID ${id}:`, e.message);
      })
      .on("finish", () => {
        console.log(`Γ£à Successfully sent image ID ${id}`);
      });
  } catch (err) {
    console.error("Γ¥î /display error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to load image" });
    }
  }
});

// ---------------- ORIGINAL FILE (OPTIONAL DOWNLOAD, PROTECTED) ----------------
// Keeps your original behavior available.
app.get("/photos/:id", authenticateToken, async (req, res) => {
  try {
    const id = validatePhotoId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }
    
    const row = await dbGet("SELECT filename, full_path FROM photos WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "Photo not found" });

    // Use full_path directly; fall back to recursive search only if needed
    let filePath = (row.full_path && isPathWithinRoot(row.full_path) && fs.existsSync(row.full_path))
      ? path.resolve(row.full_path)
      : getPhotoPathOr404(res, row.filename);
    if (!filePath) return;

    res.sendFile(filePath);
  } catch (err) {
    console.error("Γ¥î Photo error:", err);
    res.status(500).json({ error: "Failed to load photo" });
  }
});

// ---------------- BULK (PROTECTED) ----------------
app.post("/api/photos/bulk", authenticateToken, async (req, res) => {
  try {
    const { action, photoIds, albumName } = req.body;

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: "photoIds must be a non-empty array" });
    }

    let updated = 0;
    let skipped = 0;
    const errors = [];

    switch (action) {
      case "favorite":
        for (const photoId of photoIds) {
          try {
            const result = await dbRun("UPDATE photos SET is_favorite = 1 WHERE id = ?", [photoId]);
            result.changes > 0 ? updated++ : skipped++;
          } catch (e) {
            errors.push(`Failed to favorite photo ${photoId}: ${e.message}`);
          }
        }
        break;

      case "unfavorite":
        for (const photoId of photoIds) {
          try {
            const result = await dbRun("UPDATE photos SET is_favorite = 0 WHERE id = ?", [photoId]);
            result.changes > 0 ? updated++ : skipped++;
          } catch (e) {
            errors.push(`Failed to unfavorite photo ${photoId}: ${e.message}`);
          }
        }
        break;

      case "add_to_album": {
        if (!albumName || typeof albumName !== "string") {
          return res.status(400).json({ error: "albumName is required" });
        }

        let albumId;
        const existing = await dbGet("SELECT id FROM albums WHERE name = ?", [albumName.trim()]);
        if (existing) albumId = existing.id;
        else {
          const result = await dbRun("INSERT INTO albums (name) VALUES (?)", [albumName.trim()]);
          albumId = result.lastID;
        }

        for (const photoId of photoIds) {
          try {
            await dbRun(
              "INSERT OR IGNORE INTO photo_albums (photo_id, album_id) VALUES (?, ?)",
              [photoId, albumId]
            );
            updated++;
          } catch (e) {
            errors.push(`Failed to add ${photoId} to album: ${e.message}`);
          }
        }
        break;
      }

      case "delete":
        for (const photoId of photoIds) {
          try {
            await dbRun("DELETE FROM photo_albums WHERE photo_id = ?", [photoId]);
            const result = await dbRun("DELETE FROM photos WHERE id = ?", [photoId]);
            result.changes > 0 ? updated++ : skipped++;
          } catch (e) {
            errors.push(`Failed to delete ${photoId}: ${e.message}`);
          }
        }
        break;

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    res.json({ action, updated, skipped, errors, total: photoIds.length });
  } catch (err) {
    console.error("Γ¥î Bulk operation error:", err);
    res.status(500).json({ error: "Bulk operation failed" });
  }
});

// ---------------- SEARCH ----------------
const SEMANTIC_URL = process.env.SEMANTIC_URL || 'http://127.0.0.1:8000';

function parseIntOrDefault(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

// ---- Gemini query expansion ----
async function expandQueryWithGemini(query) {
  if (!GEMINI_API_KEY) return null;
  const prompt = [
    'You are a search assistant for a family photo library. Analyze this search query and return useful search signals as JSON.',
    '',
    'Query: "' + query + '"',
    '',
    'Return ONLY valid JSON (no markdown) with:',
    '- "concepts": 4-10 individual words/short phrases describing photo content (objects, scenes, activities, people types). Include synonyms and related words.',
    '- "personName": a specific persons first or full name if the query is searching for someone (null otherwise)',
    '- "dateRange": if a specific time period is implied, { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } (null otherwise)',
    '- "tagTerms": 3-6 exact words likely to appear as object-detection tags (single nouns)',
    '',
    'Examples:',
    '- "birthday party" -> {"concepts":["birthday","party","cake","candles","celebration","balloons","gifts"],"personName":null,"dateRange":null,"tagTerms":["birthday","cake","baby","child"]}',
    '- "Christmas 2019" -> {"concepts":["christmas","tree","gifts","holiday","decorations","santa"],"personName":null,"dateRange":{"start":"2019-12-01","end":"2019-12-31"},"tagTerms":["christmas","tree"]}',
    '- "photos of Haley" -> {"concepts":["person","portrait","family"],"personName":"Haley","dateRange":null,"tagTerms":["woman","girl"]}',
    '- "haley beach" -> {"concepts":["beach","ocean","sand","water","waves","vacation","swimming","summer"],"personName":"Haley","dateRange":null,"tagTerms":["beach","water","swimsuit","woman"]}',
    '- "beach vacation" -> {"concepts":["beach","ocean","sand","water","waves","vacation","swimming","summer"],"personName":null,"dateRange":null,"tagTerms":["beach","water"]}',
  ].join('\n');

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
        }),
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn('Gemini query expansion failed:', e.message);
    return null;
  }
}

// ---- Parse date from raw query text ----
function parseDateFromQuery(query) {
  const q = query.toLowerCase();
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const monthShort  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  for (let i = 0; i < monthNames.length; i++) {
    const re = new RegExp('\\b(' + monthNames[i] + '|' + monthShort[i] + ')\\s+(\\d{4})\\b');
    const m = q.match(re);
    if (m) {
      const year = parseInt(m[2], 10);
      const month = i + 1;
      const days = new Date(year, month, 0).getDate();
      return { start: year + '-' + String(month).padStart(2,'0') + '-01', end: year + '-' + String(month).padStart(2,'0') + '-' + days };
    }
  }
  const yearMatch = q.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    const y = yearMatch[0];
    return { start: y + '-01-01', end: y + '-12-31' };
  }
  return null;
}

// ---- Local person-name lookup (no Gemini needed) ----
// Returns the best-matching person name from the DB for the given raw query,
// or null if nothing matches.
async function lookupPersonInDb(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;
  try {
    const people = await dbAll('SELECT name FROM people');
    // Score each person: count how many query words appear in their name
    let best = null, bestScore = 0;
    for (const { name } of people) {
      const lname = name.toLowerCase();
      let score = 0;
      for (const w of words) if (lname.includes(w)) score++;
      if (score > bestScore) { bestScore = score; best = name; }
    }
    // Require at least one matching word
    return bestScore > 0 ? best : null;
  } catch { return null; }
}

// ---- Search sources ----
async function searchFTS(terms, limit) {
  if (!terms || terms.length === 0) return [];
  const sanitized = [...new Set(terms.map(t => t.replace(/["*]/g, '').trim()).filter(t => t.length > 1))];
  if (!sanitized.length) return [];
  const ftsQuery = sanitized.map(t => '"' + t + '"').join(' AND ');
  try {
    // Note: SQLite FTS5 requires the real table name in MATCH, not an alias
    return await dbAll(
      `SELECT p.id, p.filename, p.created_at, p.date_taken, p.thumbnail_path, p.full_path
       FROM photo_search_fts
       JOIN photos p ON p.id = photo_search_fts.rowid
       WHERE photo_search_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [ftsQuery, limit]
    );
  } catch (e) {
    console.warn('FTS error:', e.message);
    return [];
  }
}

async function searchByPerson(nameTerm, limit) {
  if (!nameTerm) return [];
  return dbAll(
    `SELECT DISTINCT p.id, p.filename, p.created_at, p.date_taken, p.thumbnail_path, p.full_path
     FROM photo_people pp
     JOIN people pe ON pe.id = pp.person_id
     JOIN photos p ON p.id = pp.photo_id
     WHERE pe.name LIKE ? AND p.is_deleted = 0
     ORDER BY COALESCE(p.date_taken, p.created_at) DESC
     LIMIT ?`,
    ['%' + nameTerm + '%', limit]
  );
}

async function searchByTags(terms, limit) {
  if (!terms || terms.length === 0) return [];
  const placeholders = terms.map(() => '?').join(',');
  return dbAll(
    `SELECT DISTINCT p.id, p.filename, p.created_at, p.date_taken, p.thumbnail_path, p.full_path
     FROM photo_tags pt
     JOIN tags t ON t.id = pt.tag_id
     JOIN photos p ON p.id = pt.photo_id
     WHERE t.name IN (${placeholders}) AND p.is_deleted = 0
     ORDER BY COALESCE(p.date_taken, p.created_at) DESC
     LIMIT ?`,
    [...terms, limit]
  );
}

// Intersection: photos where a specific person appears AND one of the tag terms is present.
// Used when both a personName and tag/concept terms are detected — gives true AND results.
async function searchPersonWithTags(personName, tagTerms, limit) {
  if (!personName || !tagTerms || tagTerms.length === 0) return [];
  const placeholders = tagTerms.map(() => '?').join(',');
  try {
    return await dbAll(
      `SELECT DISTINCT p.id, p.filename, p.created_at, p.date_taken, p.thumbnail_path, p.full_path
       FROM photos p
       JOIN photo_people pp ON pp.photo_id = p.id
       JOIN people pe ON pe.id = pp.person_id
       JOIN photo_tags pt ON pt.photo_id = p.id
       JOIN tags t ON t.id = pt.tag_id
       WHERE pe.name LIKE ? AND t.name IN (${placeholders}) AND p.is_deleted = 0
       ORDER BY COALESCE(p.date_taken, p.created_at) DESC
       LIMIT ?`,
      ['%' + personName + '%', ...tagTerms, limit]
    );
  } catch (e) {
    console.warn('searchPersonWithTags error:', e.message);
    return [];
  }
}

async function searchByDateRange(dateRange, limit) {
  if (!dateRange) return [];
  return dbAll(
    `SELECT id, filename, created_at, date_taken, thumbnail_path, full_path
     FROM photos
     WHERE date_taken BETWEEN ? AND ? AND is_deleted = 0
     ORDER BY date_taken DESC
     LIMIT ?`,
    [dateRange.start, dateRange.end, limit]
  );
}

async function runSemanticSearch(query, limit) {
  const url = new URL(`${SEMANTIC_URL}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('k', String(limit));
  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) throw new Error('Semantic ' + resp.status);
  return resp.json();
}

async function fetchPeopleForPhotoIds(photoIds) {
  if (!photoIds || photoIds.length === 0) return [];
  const placeholders = photoIds.map(() => '?').join(',');
  return dbAll(
    `SELECT pp.photo_id, pe.name AS person_name
     FROM photo_people pp
     JOIN people pe ON pe.id = pp.person_id
     WHERE pp.photo_id IN (${placeholders})`,
    photoIds
  );
}

function buildPhotoResponse(rows, peopleRows, base) {
  const peopleMap = new Map();
  for (const r of peopleRows) {
    if (!peopleMap.has(r.photo_id)) peopleMap.set(r.photo_id, []);
    if (r.person_name) peopleMap.get(r.photo_id).push(r.person_name);
  }
  return rows.map(p => ({
    id: p.id,
    filename: p.filename,
    created_at: p.created_at,
    dateTaken: p.date_taken ?? null,
    thumbnail_url: `${base}/thumbnails/${p.id}`,
    image_url: `${base}/display/${p.id}`,
    people: peopleMap.get(p.id) || []
  }));
}

function mergeResults(sources, limit) {
  const seen = new Set();
  const out = [];
  for (const rows of sources) {
    for (const row of (rows || [])) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        out.push(row);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

app.get("/api/search", authenticateToken, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const limit  = Math.min(100, parseIntOrDefault(req.query.limit, 50));
    const offset = Math.max(0,   parseIntOrDefault(req.query.offset, 0));
    // Fetch enough rows from each source to cover the requested page + 1 (to detect hasMore)
    const innerLimit = offset + limit + 1;

    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const base = `${protocol}://${host}`;

    if (!q) return res.json({ query: q, mode: 'empty', photos: [], count: 0, offset, limit, hasMore: false, meta: {} });

    // Gemini expansion, local date parsing, and DB person lookup in parallel
    const [gemini, localDateRange, dbPerson] = await Promise.all([
      expandQueryWithGemini(q),
      Promise.resolve(parseDateFromQuery(q)),
      lookupPersonInDb(q)
    ]);

    const concepts   = gemini?.concepts?.length ? gemini.concepts  : [q];
    const tagTerms   = gemini?.tagTerms?.length ? gemini.tagTerms  : concepts.slice(0, 4);
    const personName = gemini?.personName        || dbPerson || null;
    const dateRange  = gemini?.dateRange         || localDateRange;
    // Split the raw query into individual words for FTS AND logic.
    // Do NOT include Gemini concepts — they would over-restrict results.
    const ftsTerms   = [...new Set(q.toLowerCase().split(/\s+/).filter(t => t.length > 1))];
    console.log(`🔍 Search "${q}" offset=${offset} → person:${personName} date:${JSON.stringify(dateRange)} concepts:${concepts.slice(0,3).join(',')} ftsTerms:${ftsTerms.join(',')}`);

    // All sources in parallel — fetch innerLimit so pagination works
    const [ftsRows, personRows, tagRows, dateRows, intersectionRows] = await Promise.all([
      searchFTS(ftsTerms, innerLimit),
      personName ? searchByPerson(personName, innerLimit) : Promise.resolve([]),
      searchByTags(tagTerms, innerLimit),
      dateRange  ? searchByDateRange(dateRange, innerLimit) : Promise.resolve([]),
      // Intersection query: only runs when both a person name AND tag terms exist.
      // Returns photos where that person appears AND one of the tag terms is present.
      personName && tagTerms.length > 0
        ? searchPersonWithTags(personName, tagTerms, innerLimit)
        : Promise.resolve([])
    ]);

    // Semantic search — optional
    let semanticRows = [];
    try {
      const payload = await runSemanticSearch(q, innerLimit);
      const ids = (payload.results || []).map(r => r.photo_id);
      if (ids.length > 0) {
        const ph = ids.map(() => '?').join(',');
        const rows = await dbAll(`SELECT id, filename, created_at, date_taken FROM photos WHERE id IN (${ph}) AND is_deleted = 0`, ids);
        const byId = new Map(rows.map(r => [r.id, r]));
        semanticRows = ids.map(id => byId.get(id)).filter(Boolean);
      }
    } catch { /* optional */ }

    // Merge: intersection first (true AND: person + tag), then person, date, fts, tags, semantic
    // intersectionRows will be non-empty only when a personName + tagTerms both matched,
    // so queries like "haley beach" return photos of Haley at the beach before anything else.
    const combined = mergeResults([intersectionRows, personRows, dateRows, ftsRows, tagRows, semanticRows], innerLimit);
    const hasMore   = combined.length > offset + limit;
    const page      = combined.slice(offset, offset + limit);

    const peopleRows = await fetchPeopleForPhotoIds(page.map(r => r.id));
    const photos = buildPhotoResponse(page, peopleRows, base);

    const sources = [];
    if (personRows.length > 0)    sources.push('person');
    if (dateRows.length > 0)      sources.push('date');
    if (ftsRows.length > 0)       sources.push('fts');
    if (tagRows.length > 0)       sources.push('tags');
    if (semanticRows.length > 0)  sources.push('semantic');

    res.json({
      query: q,
      mode: sources.join('+') || 'no-results',
      count: photos.length,
      offset,
      limit,
      hasMore,
      photos,
      meta: { personName, dateRange, concepts, sources: { intersection: intersectionRows.length, person: personRows.length, date: dateRows.length, fts: ftsRows.length, tags: tagRows.length, semantic: semanticRows.length } }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ALBUMS
// Helper: build base URL from request
function baseUrl(req) {
  const protocol = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${protocol}://${host}`;
}

app.get("/api/albums", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT a.id, a.name, a.description, a.created_at,
             COUNT(ap.photo_id) AS photoCount,
             (SELECT ap2.photo_id FROM album_photos ap2
              WHERE ap2.album_id = a.id
              ORDER BY ap2.added_at ASC LIMIT 1) AS coverPhotoId
      FROM albums a
      LEFT JOIN album_photos ap ON ap.album_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);
    const base = baseUrl(req);
    res.json((rows || []).map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      photoCount: r.photoCount ?? 0,
      coverPhotoId: r.coverPhotoId ?? null,
      coverPhotoUrl: r.coverPhotoId ? `${base}/thumbnails/${r.coverPhotoId}` : null,
    })));
  } catch (err) {
    console.error("GET /api/albums error:", err);
    res.status(500).json({ error: "Failed to load albums" });
  }
});

app.post("/api/albums", authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const result = await dbRun(
      "INSERT INTO albums (name, description) VALUES (?, ?)",
      [name.trim(), description?.trim() || null]
    );
    const album = await dbGet("SELECT * FROM albums WHERE id = ?", [result.lastID]);
    res.json({ id: album.id, name: album.name, description: album.description, photoCount: 0, coverPhotoUrl: null });
  } catch (err) {
    console.error("POST /api/albums error:", err);
    res.status(500).json({ error: "Failed to create album" });
  }
});

app.put("/api/albums/:id", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, description } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    await dbRun(
      "UPDATE albums SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?",
      [name.trim(), description?.trim() || null, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/albums/:id error:", err);
    res.status(500).json({ error: "Failed to update album" });
  }
});

app.delete("/api/albums/:id", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await dbRun("DELETE FROM album_photos WHERE album_id = ?", [id]);
    await dbRun("DELETE FROM albums WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/albums/:id error:", err);
    res.status(500).json({ error: "Failed to delete album" });
  }
});

app.get("/api/albums/:id/photos", authenticateToken, async (req, res) => {
  try {
    const albumId = Number(req.params.id);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit  = Math.min(200, parseInt(req.query.limit)  || 50);
    const album  = await dbGet("SELECT * FROM albums WHERE id = ?", [albumId]);
    if (!album) return res.status(404).json({ error: "Album not found" });

    const total = (await dbGet("SELECT COUNT(*) AS c FROM album_photos WHERE album_id = ?", [albumId]))?.c ?? 0;
    const cols  = await dbAll("PRAGMA table_info(photos)");
    const colNames = cols.map(c => c.name);
    const optional = ["width","height","date_taken","is_favorite","is_deleted"]
      .filter(c => colNames.includes(c))
      .map(c => `p.${c}`).join(", ");
    const base = baseUrl(req);
    const token = req.query.token || "";
    const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : "";

    const rows = await dbAll(`
      SELECT p.id, p.filename, p.full_path, p.thumbnail_path${optional ? ", " + optional : ""}
      FROM photos p
      JOIN album_photos ap ON ap.photo_id = p.id
      WHERE ap.album_id = ? AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
      ORDER BY ap.added_at ASC
      LIMIT ? OFFSET ?
    `, [albumId, limit + 1, offset]);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(p => ({
      id: p.id,
      filename: p.filename,
      thumbnailUrl: `${base}/thumbnails/${p.id}${tokenSuffix}`,
      image_url: `${base}/display/${p.id}${tokenSuffix}`,
      width: p.width || null,
      height: p.height || null,
      dateTaken: p.date_taken || null,
      isFavorite: Boolean(p.is_favorite),
      isDeleted: Boolean(p.is_deleted),
    }));

    res.json({ album: { id: album.id, name: album.name, description: album.description }, total, offset, limit, hasMore, photos: page });
  } catch (err) {
    console.error("GET /api/albums/:id/photos error:", err);
    res.status(500).json({ error: "Failed to load album photos" });
  }
});

app.post("/api/albums/:id/photos", authenticateToken, async (req, res) => {
  try {
    const albumId = Number(req.params.id);
    const { photoIds } = req.body ?? {};
    if (!Array.isArray(photoIds) || photoIds.length === 0)
      return res.status(400).json({ error: "photoIds must be a non-empty array" });
    let added = 0;
    for (const pid of photoIds) {
      try {
        await dbRun("INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?, ?)", [albumId, Number(pid)]);
        added++;
      } catch {}
    }
    res.json({ added });
  } catch (err) {
    console.error("POST /api/albums/:id/photos error:", err);
    res.status(500).json({ error: "Failed to add photos to album" });
  }
});

app.delete("/api/albums/:id/photos", authenticateToken, async (req, res) => {
  try {
    const albumId = Number(req.params.id);
    const { photoIds } = req.body ?? {};
    if (!Array.isArray(photoIds) || photoIds.length === 0)
      return res.status(400).json({ error: "photoIds must be a non-empty array" });
    const placeholders = photoIds.map(() => "?").join(",");
    const result = await dbRun(
      `DELETE FROM album_photos WHERE album_id = ? AND photo_id IN (${placeholders})`,
      [albumId, ...photoIds.map(Number)]
    );
    res.json({ removed: result?.changes ?? 0 });
  } catch (err) {
    console.error("DELETE /api/albums/:id/photos error:", err);
    res.status(500).json({ error: "Failed to remove photos from album" });
  }
});

// PEOPLE
app.get("/api/people", authenticateToken, async (req, res) => {
  try {
    const tableCheck = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='people'");
    if (!tableCheck) return res.json([]);
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const base = `${protocol}://${host}`;
    const rows = await dbAll(`SELECT id, name, thumbnail_photo_id, photo_count FROM people ORDER BY photo_count DESC`);
    res.json((rows || []).map((p) => ({
      id: p.id, name: p.name, photoCount: p.photo_count,
      thumbnailUrl: p.thumbnail_photo_id ? `${base}/thumbnails/${p.thumbnail_photo_id}` : null,
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to load people" });
  }
});

app.get("/api/people/unidentified", authenticateToken, async (_req, res) => {
  try {
    const tableCheck = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='faces'");
    if (!tableCheck) return res.json({ photoCount: 0, faceCount: 0 });
    const row = await dbGet(`
      SELECT COUNT(DISTINCT f.photo_id) AS photoCount, COUNT(*) AS faceCount
      FROM faces f LEFT JOIN photo_people pp ON pp.photo_id = f.photo_id WHERE pp.photo_id IS NULL
    `);
    res.json({ photoCount: row?.photoCount ?? 0, faceCount: row?.faceCount ?? 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to load unidentified stats" });
  }
});

app.get("/api/people/unidentified/photos", authenticateToken, async (req, res) => {
  try {
    const tableCheck = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='faces'");
    if (!tableCheck) return res.json({ photos: [], total: 0 });

    const offset = Math.max(0, Number(req.query.offset || 0));
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const base = `${protocol}://${host}`;

    const totalRow = await dbGet(`
      SELECT COUNT(DISTINCT f.photo_id) AS total
      FROM faces f
      LEFT JOIN photo_people pp ON pp.photo_id = f.photo_id
      WHERE pp.photo_id IS NULL
    `);

    const rows = await dbAll(
      `
      SELECT
        p.id,
        p.filename,
        COUNT(*) AS unidentifiedCount
      FROM faces f
      JOIN photos p ON p.id = f.photo_id
      LEFT JOIN photo_people pp ON pp.photo_id = f.photo_id
      WHERE pp.photo_id IS NULL
      GROUP BY p.id, p.filename
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );

    res.json({
      total: totalRow?.total ?? 0,
      photos: (rows || []).map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        thumbnailUrl: `${base}/display/${photo.id}?w=512`,
        fullUrl: `${base}/display/${photo.id}`,
        unidentifiedCount: photo.unidentifiedCount,
      })),
    });
  } catch (err) {
    console.error("Failed to load unidentified photos:", err);
    res.status(500).json({ error: "Failed to load unidentified photos" });
  }
});

app.get("/api/photos/duplicates/stats", authenticateToken, async (_req, res) => {
  try {
    const stats = await getScanStats();
    res.json({
      ...stats,
      scanning: duplicateScanRunning,
    });
  } catch (err) {
    console.error("GET /api/photos/duplicates/stats error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

async function loadGroupPhotos(column, limitCount = 25, offset = 0) {
  // Only include groups that still have >= 2 non-deleted photos
  const groups = await dbAll(
    `
    SELECT ${column} as groupId, COUNT(*) as count
    FROM photos
    WHERE ${column} IS NOT NULL AND is_deleted = 0
    GROUP BY ${column}
    HAVING COUNT(*) >= 2
    ORDER BY count DESC
    LIMIT ? OFFSET ?
  `,
    [limitCount + 1, offset]
  );

  const hasMore = groups.length > limitCount;
  const page = groups.slice(0, limitCount);

  if (!page.length) return { groups: [], hasMore: false };

  const placeholders = page.map(() => "?").join(",");
  const rows = await dbAll(
    `
    SELECT id, filename, date_taken, width, height, is_deleted, ${column} as groupId
    FROM photos
    WHERE ${column} IN (${placeholders}) AND is_deleted = 0
    ORDER BY ${column}, date_taken ASC, id ASC
  `,
    page.map((g) => g.groupId)
  );

  const groupedRows = rows.reduce((acc, row) => {
    acc[row.groupId] = acc[row.groupId] || [];
    acc[row.groupId].push(row);
    return acc;
  }, {});

  return {
    hasMore,
    groups: page.map((group) => ({
      groupId: group.groupId,
      count: group.count,
      photos: (groupedRows[group.groupId] || []).map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        dateTaken: photo.date_taken ?? null,
        width: photo.width ?? null,
        height: photo.height ?? null,
        isDeleted: Boolean(photo.is_deleted),
        thumbnailUrl: `/display/${photo.id}?w=256`,
        fullUrl: `/display/${photo.id}`,
      })),
    })),
  };
}

app.get("/api/photos/duplicates", authenticateToken, async (req, res) => {
  try {
    const limit  = Math.min(100, Math.max(1, Number(req.query.limit)  || 25));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const result = await loadGroupPhotos("duplicate_group_id", limit, offset);
    res.json(result);
  } catch (err) {
    console.error("GET /api/photos/duplicates error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/photos/bursts", authenticateToken, async (req, res) => {
  try {
    const limit  = Math.min(100, Math.max(1, Number(req.query.limit)  || 25));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const result = await loadGroupPhotos("burst_id", limit, offset);
    res.json(result);
  } catch (err) {
    console.error("GET /api/photos/bursts error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/photos/scan-duplicates", authenticateToken, async (_req, res) => {
  if (duplicateScanRunning) {
    return res.status(409).json({ error: "Scan already in progress" });
  }

  duplicateScanRunning = true;
  res.json({ started: true, message: "Duplicate scan started in background" });

  try {
    const result = await scanAll((done, total, hashed, failed) => {
      console.log(`Duplicate scan progress: ${done}/${total} (${hashed} ok, ${failed} failed)`);
    });
    console.log("Duplicate scan complete:", result);
  } catch (err) {
    console.error("Duplicate scan failed:", err);
  } finally {
    duplicateScanRunning = false;
  }
});

async function updateDeletedState(photoIds, isDeleted) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    return 0;
  }

  let updated = 0;
  for (const rawId of photoIds) {
    const photoId = Number(rawId);
    if (!Number.isInteger(photoId) || photoId <= 0) {
      continue;
    }

    const result = await dbRun(
      isDeleted
        ? "UPDATE photos SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?"
        : "UPDATE photos SET is_deleted = 0, deleted_at = NULL WHERE id = ?",
      [photoId]
    );
    updated += Number(result?.changes || 0);
  }

  return updated;
}

// Keep the single best photo per duplicate group; soft-delete the rest.
// "Best" = highest resolution (width*height); ties broken by oldest date_taken, then lowest id.
app.post("/api/photos/duplicates/keep-best", authenticateToken, async (req, res) => {
  try {
    // Fetch every duplicate group with its photos in one query
    const rows = await dbAll(`
      SELECT id, duplicate_group_id, width, height, date_taken, is_deleted
      FROM photos
      WHERE duplicate_group_id IS NOT NULL AND is_deleted = 0
      ORDER BY duplicate_group_id, id ASC
    `);

    // Group by duplicate_group_id
    const groups = {};
    for (const row of rows) {
      const g = row.duplicate_group_id;
      if (!groups[g]) groups[g] = [];
      groups[g].push(row);
    }

    // Pick the keeper in each group, collect the rest as toDelete
    const toDelete = [];
    for (const photos of Object.values(groups)) {
      if (photos.length < 2) continue;
      let best = photos[0];
      let bestScore = (best.width || 0) * (best.height || 0);
      for (const p of photos) {
        const score = (p.width || 0) * (p.height || 0);
        if (score > bestScore) { best = p; bestScore = score; continue; }
        if (score === bestScore) {
          // prefer older date
          const bd = best.date_taken ? new Date(best.date_taken).getTime() : Infinity;
          const pd = p.date_taken   ? new Date(p.date_taken).getTime()   : Infinity;
          if (pd < bd) { best = p; }
        }
      }
      for (const p of photos) {
        if (p.id !== best.id) toDelete.push(p.id);
      }
    }

    if (toDelete.length === 0) {
      return res.json({ deleted: 0, message: "Nothing to delete" });
    }

    // Batch soft-delete in chunks of 500
    const CHUNK = 500;
    let deleted = 0;
    await dbRun("BEGIN");
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const chunk = toDelete.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const result = await dbRun(
        `UPDATE photos SET is_deleted = 1 WHERE id IN (${placeholders})`,
        chunk
      );
      deleted += Number(result?.changes || 0);
    }
    await dbRun("COMMIT");

    res.json({ deleted, total: toDelete.length });
  } catch (err) {
    console.error("POST /api/photos/duplicates/keep-best error:", err);
    try { await dbRun("ROLLBACK"); } catch {}
    res.status(500).json({ error: "Failed to apply keep-best" });
  }
});

app.post("/api/photos/soft-delete", authenticateToken, async (req, res) => {
  try {
    const { photoIds } = req.body ?? {};
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: "photoIds must be a non-empty array" });
    }

    const updated = await updateDeletedState(photoIds, true);
    res.json({ updated });
  } catch (err) {
    console.error("POST /api/photos/soft-delete error:", err);
    res.status(500).json({ error: "Failed to soft-delete photos" });
  }
});

app.post("/api/photos/restore", authenticateToken, async (req, res) => {
  try {
    const { photoIds } = req.body ?? {};
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: "photoIds must be a non-empty array" });
    }

    const updated = await updateDeletedState(photoIds, false);
    res.json({ updated });
  } catch (err) {
    console.error("POST /api/photos/restore error:", err);
    res.status(500).json({ error: "Failed to restore photos" });
  }
});

// ---------------- FAVORITES ----------------
app.get("/api/photos/favorites", authenticateToken, async (req, res) => {
  try {
    const limit  = Math.min(200, Math.max(1, Number(req.query.limit  || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const [rows, countRow] = await Promise.all([
      dbAll(
        `SELECT id, filename, date_taken, created_at
         FROM photos
         WHERE is_favorite = 1 AND is_deleted = 0
         ORDER BY COALESCE(date_taken, created_at) DESC, id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      dbGet("SELECT COUNT(*) as total FROM photos WHERE is_favorite = 1 AND is_deleted = 0"),
    ]);

    const total = countRow?.total ?? 0;
    const photos = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      thumbnailUrl: `/thumbnails/${r.id}`,
      dateTaken: r.date_taken ?? null,
      createdAt: r.created_at,
      isFavorite: true,
    }));

    res.json({ photos, total, offset, limit, hasMore: offset + rows.length < total });
  } catch (err) {
    console.error("GET /api/photos/favorites error:", err);
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
});

// ---------------- TRASH (soft-deleted photos) ----------------
app.get("/api/photos/trash", authenticateToken, async (req, res) => {
  const t0 = Date.now();
  try {
    const limit  = Math.min(200, Math.max(1, Number(req.query.limit  || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    console.log(`GET /api/photos/trash offset=${offset} limit=${limit}`);
    const RETENTION = parseInt(process.env.TRASH_RETENTION_DAYS || "30", 10);

    const [rows, countRow] = await Promise.all([
      dbAll(
        `SELECT id, filename, date_taken, created_at, deleted_at
         FROM photos
         WHERE is_deleted = 1
         ORDER BY deleted_at DESC, COALESCE(date_taken, created_at) DESC, id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      dbGet("SELECT COUNT(*) as total FROM photos WHERE is_deleted = 1"),
    ]);

    const total = countRow?.total ?? 0;
    const photos = rows.map((r) => {
      let daysLeft = null;
      if (r.deleted_at) {
        const deletedMs = new Date(r.deleted_at).getTime();
        const expiresMs = deletedMs + RETENTION * 86400000;
        daysLeft = Math.max(0, Math.ceil((expiresMs - Date.now()) / 86400000));
      }
      return {
        id: r.id,
        filename: r.filename,
        thumbnailUrl: `/thumbnails/${r.id}`,
        dateTaken: r.date_taken ?? null,
        createdAt: r.created_at,
        deletedAt: r.deleted_at ?? null,
        daysLeft,
      };
    });

    console.log(`GET /api/photos/trash → ${total} total, ${rows.length} rows, took ${Date.now()-t0}ms`);
    res.json({ photos, total, offset, limit, hasMore: offset + rows.length < total, retentionDays: RETENTION });
  } catch (err) {
    console.error("GET /api/photos/trash error:", err);
    res.status(500).json({ error: "Failed to fetch trash" });
  }
});

// Permanently delete (remove DB row + optionally file) — does NOT touch filesystem for now
app.delete("/api/photos/trash", authenticateToken, async (req, res) => {
  try {
    const { photoIds } = req.body ?? {};
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: "photoIds must be a non-empty array" });
    }
    const ids = photoIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.status(400).json({ error: "No valid photoIds" });

    const placeholders = ids.map(() => "?").join(",");
    const result = await dbRun(
      `DELETE FROM photos WHERE id IN (${placeholders}) AND is_deleted = 1`,
      ids
    );
    res.json({ deleted: Number(result?.changes || 0) });
  } catch (err) {
    console.error("DELETE /api/photos/trash error:", err);
    res.status(500).json({ error: "Failed to permanently delete" });
  }
});

// Empty entire trash
app.post("/api/photos/trash/empty", authenticateToken, async (req, res) => {
  try {
    const result = await dbRun("DELETE FROM photos WHERE is_deleted = 1");
    res.json({ deleted: Number(result?.changes || 0) });
  } catch (err) {
    console.error("POST /api/photos/trash/empty error:", err);
    res.status(500).json({ error: "Failed to empty trash" });
  }
});

// ---------------- DOCUMENTS ----------------
app.get("/api/photos/documents", authenticateToken, async (req, res) => {
  try {
    const limit  = Math.min(200, Math.max(1, Number(req.query.limit  || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const [rows, countRow, scannedRow] = await Promise.all([
      dbAll(
        `SELECT id, filename, date_taken, created_at
         FROM photos
         WHERE is_document = 1 AND is_deleted = 0
         ORDER BY COALESCE(date_taken, created_at) DESC, id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      dbGet("SELECT COUNT(*) as total FROM photos WHERE is_document = 1 AND is_deleted = 0"),
      dbGet("SELECT COUNT(*) as scanned FROM photos WHERE document_scanned = 1 AND is_deleted = 0"),
    ]);

    const total   = countRow?.total   ?? 0;
    const scanned = scannedRow?.scanned ?? 0;
    const photos = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      thumbnailUrl: `/thumbnails/${r.id}`,
      dateTaken: r.date_taken ?? null,
      createdAt: r.created_at,
    }));

    res.json({ photos, total, offset, limit, hasMore: offset + rows.length < total, scanned });
  } catch (err) {
    console.error("GET /api/photos/documents error:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

let documentScanRunning = false;
app.post("/api/photos/scan-documents", authenticateToken, async (req, res) => {
  if (documentScanRunning) {
    return res.json({ started: false, message: "Scan already in progress" });
  }
  documentScanRunning = true;
  res.json({ started: true, message: "Document scan started" });

  // Run in background as a child process so it doesn't block the server
  const { spawn } = await import("child_process");
  const { fileURLToPath } = await import("url");
  const __scanDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.join(__scanDir, "scan-documents.js");
  const child = spawn(process.execPath, [scriptPath], {
    stdio: "pipe",
    cwd: __scanDir,
    env: { ...process.env },
  });
  child.stdout?.on("data", (d) => process.stdout.write("[doc-scan] " + d));
  child.stderr?.on("data", (d) => process.stderr.write("[doc-scan] " + d));
  child.on("close", (code) => {
    console.log(`Document scan finished with code ${code}`);
    documentScanRunning = false;
  });
  child.on("error", (err) => {
    console.error("Document scan process error:", err);
    documentScanRunning = false;
  });
});

app.get("/api/photos/documents/status", authenticateToken, async (req, res) => {
  try {
    const [totalRow, scannedRow, docRow] = await Promise.all([
      dbGet("SELECT COUNT(*) as total FROM photos WHERE is_deleted = 0"),
      dbGet("SELECT COUNT(*) as scanned FROM photos WHERE document_scanned = 1 AND is_deleted = 0"),
      dbGet("SELECT COUNT(*) as docs FROM photos WHERE is_document = 1 AND is_deleted = 0"),
    ]);
    res.json({
      running: documentScanRunning,
      total: totalRow?.total ?? 0,
      scanned: scannedRow?.scanned ?? 0,
      documents: docRow?.docs ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get document scan status" });
  }
});

// ---------------- SCREENSHOTS ----------------
app.get("/api/photos/screenshots", authenticateToken, async (req, res) => {
  try {
    const limit  = Math.min(200, Math.max(1, Number(req.query.limit  || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const [rows, countRow, scannedRow] = await Promise.all([
      dbAll(
        `SELECT id, filename, date_taken, created_at
         FROM photos
         WHERE is_screenshot = 1 AND is_deleted = 0
         ORDER BY COALESCE(date_taken, created_at) DESC, id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      dbGet("SELECT COUNT(*) as total FROM photos WHERE is_screenshot = 1 AND is_deleted = 0"),
      dbGet("SELECT COUNT(*) as scanned FROM photos WHERE screenshot_scanned = 1 AND is_deleted = 0"),
    ]);

    const total   = countRow?.total   ?? 0;
    const scanned = scannedRow?.scanned ?? 0;
    const photos = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      thumbnailUrl: `/thumbnails/${r.id}`,
      dateTaken: r.date_taken ?? null,
      createdAt: r.created_at,
    }));

    res.json({ photos, total, offset, limit, hasMore: offset + rows.length < total, scanned });
  } catch (err) {
    console.error("GET /api/photos/screenshots error:", err);
    res.status(500).json({ error: "Failed to fetch screenshots" });
  }
});

let screenshotScanRunning = false;
app.post("/api/photos/scan-screenshots", authenticateToken, async (req, res) => {
  if (screenshotScanRunning) {
    return res.json({ started: false, message: "Scan already in progress" });
  }
  screenshotScanRunning = true;
  res.json({ started: true, message: "Screenshot scan started" });

  const { spawn } = await import("child_process");
  const { fileURLToPath } = await import("url");
  const __scanDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.join(__scanDir, "scan-screenshots.js");
  const child = spawn(process.execPath, [scriptPath], {
    stdio: "pipe",
    cwd: __scanDir,
    env: { ...process.env },
  });
  child.stdout?.on("data", (d) => process.stdout.write("[ss-scan] " + d));
  child.stderr?.on("data", (d) => process.stderr.write("[ss-scan] " + d));
  child.on("close", (code) => {
    console.log(`Screenshot scan finished with code ${code}`);
    screenshotScanRunning = false;
  });
  child.on("error", (err) => {
    console.error("Screenshot scan process error:", err);
    screenshotScanRunning = false;
  });
});

app.get("/api/photos/screenshots/status", authenticateToken, async (req, res) => {
  try {
    const [totalRow, scannedRow, ssRow] = await Promise.all([
      dbGet("SELECT COUNT(*) as total FROM photos WHERE is_deleted = 0"),
      dbGet("SELECT COUNT(*) as scanned FROM photos WHERE screenshot_scanned = 1 AND is_deleted = 0"),
      dbGet("SELECT COUNT(*) as ss FROM photos WHERE is_screenshot = 1 AND is_deleted = 0"),
    ]);
    res.json({
      running: screenshotScanRunning,
      total: totalRow?.total ?? 0,
      scanned: scannedRow?.scanned ?? 0,
      screenshots: ssRow?.ss ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get screenshot scan status" });
  }
});

app.get("/api/people/:id/photos", authenticateToken, async (req, res) => {
  try {
    const personId = Number(req.params.id);
    if (!Number.isFinite(personId)) return res.json([]);
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const base = `${protocol}://${host}`;
    const rows = await dbAll(
      `SELECT ph.* FROM photos ph JOIN photo_people pp ON pp.photo_id = ph.id WHERE pp.person_id = ? ORDER BY ph.id DESC`,
      [personId]
    );
    res.json((rows || []).map((p) => ({
      ...p,
      image_url: `${base}/display/${p.id}`,
      thumbnail_url: `${base}/thumbnails/${p.id}`,
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to load people photos" });
  }
});

// ── /api/photos/:id and /api/photos/:id/file ─────────────────────────────────
// Alias for older frontend builds that generate these URL patterns.
// Constrained to numeric IDs only so named routes below (/videos, /map, etc.) still match.
app.get(["/api/photos/:id(\\d+)/file", "/api/photos/:id(\\d+)"], authenticateToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tokenPart = req.query.token ? `?token=${req.query.token}` : '';
  res.redirect(307, `/display/${id}${tokenPart}`);
});

app.get("/api/photos/:id/faces", authenticateToken, async (req, res) => {
  try {
    const photoId = validatePhotoId(req.params.id);
    if (photoId === null) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }

    const tableCheck = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='faces'");
    if (!tableCheck) return res.json([]);

    const rows = await dbAll(
      `SELECT id, box_x, box_y, box_width, box_height, confidence
       FROM faces
       WHERE photo_id = ?
       ORDER BY id`,
      [photoId]
    );

    res.json(
      (rows || []).map((face) => ({
        id: face.id,
        personId: null,
        personName: null,
        bbox: {
          x: face.box_x,
          y: face.box_y,
          width: face.box_width,
          height: face.box_height,
        },
        confidence: face.confidence,
      }))
    );
  } catch (err) {
    console.error("Failed to load photo faces:", err);
    res.status(500).json({ error: "Failed to load photo faces" });
  }
});

app.get("/api/photos/:id/people", authenticateToken, async (req, res) => {
  try {
    const photoId = validatePhotoId(req.params.id);
    if (photoId === null) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }

    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const base = `${protocol}://${host}`;

    const rows = await dbAll(
      `SELECT p.id, p.name, p.photo_count, p.thumbnail_photo_id
       FROM people p
       JOIN photo_people pp ON pp.person_id = p.id
       WHERE pp.photo_id = ?
       ORDER BY p.name`,
      [photoId]
    );

    res.json(
      (rows || []).map((person) => ({
        id: person.id,
        name: person.name,
        photoCount: person.photo_count || 0,
        thumbnailUrl: person.thumbnail_photo_id ? `${base}/thumbnails/${person.thumbnail_photo_id}` : null,
      }))
    );
  } catch (err) {
    console.error("Failed to load photo people:", err);
    res.status(500).json({ error: "Failed to load photo people" });
  }
});

app.post("/api/photos/:photoId/people", authenticateToken, async (req, res) => {
  try {
    const photoId = validatePhotoId(req.params.photoId);
    const personId = Number(req.body?.personId);
    if (photoId === null || !Number.isInteger(personId) || personId <= 0) {
      return res.status(400).json({ error: "Valid photoId and personId are required" });
    }

    await dbRun(
      "INSERT OR IGNORE INTO photo_people (photo_id, person_id) VALUES (?, ?)",
      [photoId, personId]
    );

    const photoCount = await dbGet(
      "SELECT COUNT(*) AS count FROM photo_people WHERE person_id = ?",
      [personId]
    );
    await dbRun("UPDATE people SET photo_count = ? WHERE id = ?", [photoCount?.count || 0, personId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to tag person in photo:", err);
    res.status(500).json({ error: "Failed to tag person in photo" });
  }
});

app.delete("/api/photos/:photoId/people/:personId", authenticateToken, async (req, res) => {
  try {
    const photoId = validatePhotoId(req.params.photoId);
    const personId = Number(req.params.personId);
    if (photoId === null || !Number.isInteger(personId) || personId <= 0) {
      return res.status(400).json({ error: "Valid photoId and personId are required" });
    }

    await dbRun(
      "DELETE FROM photo_people WHERE photo_id = ? AND person_id = ?",
      [photoId, personId]
    );

    const photoCount = await dbGet(
      "SELECT COUNT(*) AS count FROM photo_people WHERE person_id = ?",
      [personId]
    );
    await dbRun("UPDATE people SET photo_count = ? WHERE id = ?", [photoCount?.count || 0, personId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to remove person tag from photo:", err);
    res.status(500).json({ error: "Failed to remove person tag from photo" });
  }
});

// ── Videos ───────────────────────────────────────
app.get("/api/photos/videos", authenticateToken, async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit  = Math.min(200, parseInt(req.query.limit) || 50);
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const base = `${protocol}://${host}`;
    const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
    const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : "";

    const total = (await dbGet("SELECT COUNT(*) as c FROM photos WHERE is_video=1 AND is_deleted=0")).c;
    const rows  = await dbAll(
      `SELECT id, filename, date_taken, full_path, video_duration
       FROM photos WHERE is_video=1 AND is_deleted=0
       ORDER BY date_taken DESC NULLS LAST
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const videos = rows.map(r => ({
      id: r.id,
      filename: r.filename,
      dateTaken: r.date_taken,
      duration: r.video_duration,
      thumbnailUrl: `${base}/thumbnails/${r.id}${tokenSuffix}`,
      streamUrl: `${base}/api/photos/${r.id}/stream${tokenSuffix}`,
    }));
    res.json({ total, offset, limit, hasMore: offset + rows.length < total, videos });
  } catch (err) {
    console.error("GET /api/photos/videos error:", err);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

// Video scan status
const videoScanState = { running: false, progress: 0, total: 0, found: 0, error: null };

app.get("/api/photos/videos/status", authenticateToken, (_req, res) => {
  res.json({ ...videoScanState });
});

app.post("/api/photos/scan-videos", authenticateToken, async (_req, res) => {
  if (videoScanState.running) return res.json({ started: false, message: "Already running" });
  res.json({ started: true });
  const { default: { spawn } } = await import("child_process");
  const { fileURLToPath } = await import("url");
  const { dirname: _dirname, join: _join } = await import("path");
  const __scanDir = _dirname(fileURLToPath(import.meta.url));
  const child = spawn(process.execPath, [_join(__scanDir, "scan-videos.js")], {
    stdio: "inherit", env: { ...process.env }
  });
  videoScanState.running = true;
  child.on("close", (code) => {
    videoScanState.running = false;
    if (code !== 0) videoScanState.error = `exited with code ${code}`;
  });
});

// Stream a video file
app.get("/api/photos/:id/stream", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet("SELECT full_path, filename, is_video FROM photos WHERE id=?", [id]);
    if (!row || !row.is_video) return res.status(404).json({ error: "Video not found" });

    const filePath = row.full_path || findFileRecursive(PHOTO_ROOT, row.filename);
    if (!filePath || !isPathWithinRoot(filePath)) return res.status(404).json({ error: "File not found" });

    const ext = path.extname(row.filename).toLowerCase();
    const mimeMap = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/mp4", ".avi": "video/x-msvideo", ".3gp": "video/3gpp", ".mkv": "video/x-matroska", ".webm": "video/webm" };
    const contentType = mimeMap[ext] || "video/mp4";

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end   = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error("GET /api/photos/:id/stream error:", err);
    res.status(500).json({ error: "Failed to stream video" });
  }
});

// ── Places (paginated geotagged photos) ──────────
app.get("/api/photos/places", authenticateToken, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const [{ total }] = await dbAll(
      `SELECT COUNT(*) as total FROM photos WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL AND is_deleted = 0`
    );
    const rows = await dbAll(
      `SELECT id, filename, date_taken, gps_lat, gps_lng
       FROM photos
       WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL AND is_deleted = 0
       ORDER BY date_taken DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json({
      photos: rows.map(r => ({
        id: r.id,
        filename: r.filename,
        date_taken: r.date_taken,
        thumbnail_url: `/thumbnails/${r.id}`,
        lat: r.gps_lat,
        lng: r.gps_lng,
      })),
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (err) {
    console.error("GET /api/photos/places error:", err);
    res.status(500).json({ error: "Failed to fetch places photos" });
  }
});

// ── Map View ─────────────────────────────────────
app.get("/api/photos/map", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, filename, date_taken, gps_lat, gps_lng
       FROM photos
       WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL
         AND is_deleted = 0
       ORDER BY date_taken DESC`
    );
    res.json({ photos: rows.map(r => ({
      id: r.id,
      filename: r.filename,
      dateTaken: r.date_taken,
      lat: r.gps_lat,
      lng: r.gps_lng,
    }))});
  } catch (err) {
    console.error("GET /api/photos/map error:", err);
    res.status(500).json({ error: "Failed to fetch map photos" });
  }
});

// ════════════════════════════════════════════════
// PHASE 1 FEATURES
// ════════════════════════════════════════════════

// ── On This Day ──────────────────────────────────
app.get("/api/on-this-day", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, filename, date_taken, created_at
       FROM photos
       WHERE strftime('%m-%d', date_taken) = strftime('%m-%d', 'now')
         AND date_taken IS NOT NULL
         AND is_deleted = 0
       ORDER BY date_taken DESC
       LIMIT 500`
    );
    // Group by year
    const byYear = {};
    for (const r of rows) {
      const year = new Date(r.date_taken).getFullYear();
      if (!byYear[year]) byYear[year] = [];
      byYear[year].push({ id: r.id, filename: r.filename, thumbnailUrl: `/thumbnails/${r.id}`, dateTaken: r.date_taken });
    }
    const groups = Object.entries(byYear)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([year, photos]) => ({ year: Number(year), photos }));
    res.json({ groups, total: rows.length });
  } catch (err) {
    console.error("GET /api/on-this-day error:", err);
    res.status(500).json({ error: "Failed to fetch On This Day" });
  }
});

// ── Birthday Reminders ───────────────────────────
app.get("/api/birthdays/today", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT p.id, p.name, p.birthday,
              ph.id as photo_id, ph.filename
       FROM people p
       LEFT JOIN (
         SELECT pp.person_id, MIN(ph.id) as id, MIN(ph.filename) as filename
         FROM photo_people pp
         JOIN photos ph ON ph.id = pp.photo_id
         WHERE ph.is_deleted = 0
         GROUP BY pp.person_id
       ) ph ON ph.person_id = p.id
       WHERE p.birthday IS NOT NULL
         AND strftime('%m-%d', p.birthday) = strftime('%m-%d', 'now')`
    );
    const birthdays = rows.map((r) => ({
      personId: r.id,
      name: r.name,
      birthday: r.birthday,
      age: r.birthday ? new Date().getFullYear() - new Date(r.birthday).getFullYear() : null,
      thumbnailUrl: r.photo_id ? `/thumbnails/${r.photo_id}` : null,
    }));
    res.json({ birthdays });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch birthdays" });
  }
});

app.get("/api/birthdays/upcoming", authenticateToken, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days || 30)));
    const rows = await dbAll(
      `SELECT p.id, p.name, p.birthday,
              ph.id as photo_id
       FROM people p
       LEFT JOIN (
         SELECT pp.person_id, MIN(ph.id) as id
         FROM photo_people pp
         JOIN photos ph ON ph.id = pp.photo_id
         WHERE ph.is_deleted = 0
         GROUP BY pp.person_id
       ) ph ON ph.person_id = p.id
       WHERE p.birthday IS NOT NULL`
    );
    const today = new Date();
    const upcoming = rows
      .map((r) => {
        const bday = new Date(r.birthday);
        const thisYear = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
        if (thisYear < today) thisYear.setFullYear(today.getFullYear() + 1);
        const daysUntil = Math.ceil((thisYear - today) / 86400000);
        return { personId: r.id, name: r.name, birthday: r.birthday, daysUntil, thumbnailUrl: r.photo_id ? `/thumbnails/${r.photo_id}` : null };
      })
      .filter((r) => r.daysUntil <= days && r.daysUntil >= 0)
      .sort((a, b) => a.daysUntil - b.daysUntil);
    res.json({ birthdays: upcoming });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch upcoming birthdays" });
  }
});

app.patch("/api/people/:id/birthday", authenticateToken, async (req, res) => {
  try {
    const personId = Number(req.params.id);
    if (!Number.isFinite(personId)) return res.status(400).json({ error: "Invalid person ID" });
    const { birthday } = req.body ?? {};
    // Validate date format YYYY-MM-DD
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      return res.status(400).json({ error: "birthday must be YYYY-MM-DD" });
    }
    await dbRun("UPDATE people SET birthday = ? WHERE id = ?", [birthday ?? null, personId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update birthday" });
  }
});

// ── Memories API ─────────────────────────────────
app.get("/api/memories", authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, title, narrative, location_label, event_date_start, event_date_end,
              cover_photo_id, photo_count, confidence, created_at, updated_at
       FROM memories
       ORDER BY event_date_start DESC`
    );
    const token = await (async () => {
      try {
        const auth = req.headers.authorization;
        return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      } catch { return null; }
    })();
    const memories = rows.map((r) => ({
      id: r.id,
      title: r.title ?? null,
      narrative: r.narrative ?? null,
      locationLabel: r.location_label ?? null,
      eventDateStart: r.event_date_start,
      eventDateEnd: r.event_date_end,
      coverPhotoId: r.cover_photo_id,
      coverPhotoUrl: r.cover_photo_id ? `/thumbnails/${r.cover_photo_id}` : null,
      photoCount: r.photo_count ?? 0,
      confidence: r.confidence ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    res.json({ memories });
  } catch (err) {
    console.error("GET /api/memories error:", err);
    res.status(500).json({ error: "Failed to fetch memories" });
  }
});

// ── Search Memories (must be before /:id) ────────
app.get("/api/memories/search", authenticateToken, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ memories: [] });
    const like = `%${q}%`;
    const rows = await dbAll(
      `SELECT id, title, narrative, location_label, event_date_start, event_date_end,
              cover_photo_id, photo_count, confidence
       FROM memories
       WHERE title LIKE ? OR narrative LIKE ? OR location_label LIKE ?
       ORDER BY event_date_start DESC LIMIT 50`,
      [like, like, like]
    );
    const memories = rows.map((r) => ({
      id: r.id, title: r.title, narrative: r.narrative,
      locationLabel: r.location_label, eventDateStart: r.event_date_start,
      eventDateEnd: r.event_date_end,
      coverPhotoUrl: r.cover_photo_id ? `/thumbnails/${r.cover_photo_id}` : null,
      photoCount: r.photo_count, confidence: r.confidence,
    }));
    res.json({ memories });
  } catch (err) {
    res.status(500).json({ error: "Failed to search memories" });
  }
});

// ── Regenerate Memories (must be before /:id) ────
app.post("/api/memories/regenerate", authenticateToken, async (req, res) => {
  res.json({ started: true, message: "Run 'node memory-generator.js' on the server to regenerate memories." });
});

app.get("/api/memories/:id", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet(
      `SELECT id, title, narrative, location_label, event_date_start, event_date_end,
              cover_photo_id, photo_count, confidence, created_at, updated_at
       FROM memories WHERE id = ?`, [id]
    );
    if (!row) return res.status(404).json({ error: "Memory not found" });
    res.json({
      id: row.id, title: row.title, narrative: row.narrative,
      locationLabel: row.location_label, eventDateStart: row.event_date_start,
      eventDateEnd: row.event_date_end, coverPhotoId: row.cover_photo_id,
      coverPhotoUrl: row.cover_photo_id ? `/thumbnails/${row.cover_photo_id}` : null,
      photoCount: row.photo_count, confidence: row.confidence,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch memory" });
  }
});

app.get("/api/memories/:id/photos", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await dbAll(
      `SELECT p.id, p.filename, p.date_taken, p.full_path
       FROM photos p
       JOIN memory_photos mp ON mp.photo_id = p.id
       WHERE mp.memory_id = ? AND p.is_deleted = 0
       ORDER BY COALESCE(p.date_taken, p.created_at) ASC`, [id]
    );
    const photos = rows.map((r) => ({
      id: r.id, filename: r.filename, dateTaken: r.date_taken,
      thumbnailUrl: `/thumbnails/${r.id}`,
      imageUrl: `/display/${r.id}`,
    }));
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch memory photos" });
  }
});

app.delete("/api/memories/:id", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await dbRun("DELETE FROM memory_photos WHERE memory_id = ?", [id]);
    await dbRun("DELETE FROM memories WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

app.put("/api/memories/:id", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { title, narrative, locationLabel } = req.body ?? {};
    await dbRun(
      `UPDATE memories SET title = ?, narrative = ?, location_label = ?, updated_at = datetime('now') WHERE id = ?`,
      [title ?? null, narrative ?? null, locationLabel ?? null, id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update memory" });
  }
});

// ── Bulk Download ZIP ─────────────────────────────
app.post("/api/photos/download-zip", authenticateToken, async (req, res) => {
  try {
    const { photoIds } = req.body ?? {};
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: "photoIds required" });
    }
    const ids = photoIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.status(400).json({ error: "No valid photoIds" });
    if (ids.length > 500) return res.status(400).json({ error: "Max 500 photos per download" });

    const placeholders = ids.map(() => "?").join(",");
    const rows = await dbAll(
      `SELECT id, filename, full_path FROM photos WHERE id IN (${placeholders}) AND is_deleted = 0`,
      ids
    );

    const archiver = (await import("archiver")).default;
    const archive = archiver("zip", { zlib: { level: 0 } }); // level 0 = store, fastest

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="photos.zip"`);
    archive.pipe(res);

    const photoRoot = path.resolve(PHOTO_ROOT);
    for (const row of rows) {
      const filePath = path.resolve(row.full_path || "");
      // Security: must be within PHOTO_ROOT
      if (!filePath.startsWith(photoRoot)) continue;
      if (!fs.existsSync(filePath)) continue;
      archive.file(filePath, { name: row.filename });
    }

    await archive.finalize();
  } catch (err) {
    console.error("POST /api/photos/download-zip error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to create ZIP" });
  }
});

// ---------------- ADMIN ROUTES ----------------
app.get("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await dbAll(
      `SELECT uid, email, display_name, is_approved, last_seen, created_at
       FROM app_users
       ORDER BY created_at DESC`
    );
    res.json(users.map(u => ({
      uid: u.uid,
      email: u.email,
      displayName: u.display_name,
      isApproved: Boolean(u.is_approved),
      lastSeen: u.last_seen,
      createdAt: u.created_at,
    })));
  } catch (err) {
    console.error("GET /api/admin/users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.patch("/api/admin/users/:uid/approval", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { isApproved } = req.body;
    if (typeof isApproved !== 'boolean') {
      return res.status(400).json({ error: "isApproved must be a boolean" });
    }
    await dbRun(
      `UPDATE app_users SET is_approved = ? WHERE uid = ?`,
      [isApproved ? 1 : 0, uid]
    );
    res.json({ uid, isApproved });
  } catch (err) {
    console.error("PATCH /api/admin/users/:uid/approval error:", err);
    res.status(500).json({ error: "Failed to update approval" });
  }
});

// ---------------- START ----------------
async function start() {
  try {
    await runMigrations();
    console.log("[startup] Migrations complete");
  } catch (err) {
    console.error("[startup] Migration failed, aborting:", err);
    process.exit(1);
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[startup] Backend listening on http://127.0.0.1:${PORT}`);
  });
}

start();

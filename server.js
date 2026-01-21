// FILE: server.js
import express from "express";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import cors from "cors";
import sharp from "sharp";
import { dbGet, dbAll, dbRun } from "./db.js";
import admin from "firebase-admin";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "firebase-service-account.json"), "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const PORT = process.env.PORT || 3001;
const PHOTO_ROOT = process.env.PHOTO_ROOT || "G:/Photos";

const allowedOrigins = [
  "https://photos.milhizerfamilyphotos.org",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Cache-Control'],
}));
app.use(express.json());

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
    console.log(`⚠️  No token provided for ${req.method} ${req.path}`);
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }
  
  // Log authentication attempt (no token details in production)
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔐 Authenticating ${req.method} ${req.path}`);
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // Attach user info to request
    console.log(`✅ Auth success: ${decodedToken.email}`);
    next();
  } catch (error) {
    console.error("❌ Token verification failed:", error.code || error.message);
    return res.status(403).json({ error: "Forbidden: Invalid token" });
  }
}

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
    console.error("❌ Health check failed:", err);
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

// ---------------- FILE PATH CACHE ----------------
// Cache file paths to avoid repeated directory traversals
const filePathCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10000;

function getCachedPath(filename) {
  const entry = filePathCache.get(filename.toLowerCase());
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    filePathCache.delete(filename.toLowerCase());
    return null;
  }
  return entry.path;
}

function setCachedPath(filename, filePath) {
  // Evict oldest entries if cache is full
  if (filePathCache.size >= MAX_CACHE_SIZE) {
    const firstKey = filePathCache.keys().next().value;
    filePathCache.delete(firstKey);
  }
  filePathCache.set(filename.toLowerCase(), { path: filePath, timestamp: Date.now() });
}

// Async file search with caching
async function findFileAsync(root, targetName) {
  const targetLower = String(targetName).toLowerCase();

  // Check cache first
  const cached = getCachedPath(targetLower);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }

  // Security: Ensure we only search within PHOTO_ROOT
  const resolvedRoot = path.resolve(root);
  if (!isPathWithinRoot(resolvedRoot)) {
    console.error(`❌ Security: Attempted to search outside PHOTO_ROOT: ${root}`);
    return null;
  }

  const stack = [resolvedRoot];

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        // Security: Double-check each path stays within bounds
        if (!isPathWithinRoot(fullPath)) continue;

        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.name.toLowerCase() === targetLower) {
          // Cache the found path
          setCachedPath(targetLower, fullPath);
          return fullPath;
        }
      }
    } catch {
      // ignore permission errors
    }
  }
  return null;
}

async function getPhotoPathOr404Async(res, filename) {
  const filePath = await findFileAsync(PHOTO_ROOT, filename);
  if (!filePath) {
    res.sendStatus(404);
    return null;
  }
  const resolved = path.resolve(filePath);
  // Security: Final validation before returning
  if (!isPathWithinRoot(resolved)) {
    console.error(`❌ Security: Path traversal blocked: ${resolved}`);
    res.sendStatus(404);
    return null;
  }
  return resolved;
}

// ---------------- LIST PHOTOS (PROTECTED) ----------------
// Important change: fullUrl now points at /display/:id (always JPEG)
app.get("/api/photos", authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const rows = await dbAll(
      `
      SELECT
        p.id,
        p.filename,
        p.is_favorite,
        p.created_at,
        GROUP_CONCAT(pa.album_id) as album_ids
      FROM photos p
      LEFT JOIN photo_albums pa ON p.id = pa.photo_id
      GROUP BY p.id
      ORDER BY p.id
      LIMIT ? OFFSET ?
    `,
      [limit, offset]
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        thumbnailUrl: `/thumbnails/${r.id}`,
        fullUrl: `/thumbnails/${r.id}?full=true`, // Use thumbnails endpoint with full=true
        isFavorite: Boolean(r.is_favorite),
        albumIds: r.album_ids ? r.album_ids.split(",").filter(Boolean).map(Number) : [],
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    console.error("❌ /api/photos error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------------- THUMBNAILS (PROTECTED) ----------------
app.get("/thumbnails/:id", authenticateToken, async (req, res) => {
  try {
    const id = validatePhotoId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }
    
    const row = await dbGet("SELECT filename, full_path, thumbnail_path FROM photos WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "Photo not found" });

    // Check if full-size image is requested via query parameter
    const serveFull = req.query.full === 'true';

    let filePath;
    if (serveFull) {
      // Serve full-size image
      filePath = row.full_path;

      // Security: Validate database path is within PHOTO_ROOT
      if (filePath && !isPathWithinRoot(filePath)) {
        console.error(`❌ Security: Invalid full_path in database for ID ${id}`);
        filePath = null;
      }

      if (!filePath || filePath.includes('.thumb.') || !fs.existsSync(filePath)) {
        console.log(`⚠️  Searching for FULL image ID ${id}...`);
        filePath = await findFileAsync(PHOTO_ROOT, row.filename);
      }

      if (!filePath || !fs.existsSync(filePath)) {
        console.error(`❌ Full image not found for ID ${id}`);
        return res.status(404).json({ error: "Image not found" });
      }
      
      console.log(`✅ Serving FULL image ID ${id}: ${filePath}`);
      
      // Use Sharp to process full image
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
      
      const maxW = Number(req.query.w || 2400);
      
      sharp(filePath)
        .rotate()
        .resize({ width: maxW, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .on("error", (e) => {
          console.error(`❌ Sharp error for ID ${id}:`, e.message);
          if (!res.headersSent) res.status(500).json({ error: "Failed to process image" });
        })
        .pipe(res);
    } else {
      // Serve thumbnail (original behavior)
      filePath = row.thumbnail_path;

      // Security: Validate database path is within PHOTO_ROOT
      if (filePath && !isPathWithinRoot(filePath)) {
        console.error(`❌ Security: Invalid thumbnail_path in database for ID ${id}`);
        filePath = null;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        const thumbName = `${row.filename}.thumb.jpg`;
        filePath = await findFileAsync(PHOTO_ROOT, thumbName);
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Thumbnail not found" });
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      
      const stream = fs.createReadStream(filePath);
      stream.on("error", (err) => {
        console.error(`❌ Stream error for thumbnail ID ${id}:`, err.message);
        if (!res.headersSent) res.status(500).json({ error: "Failed to load thumbnail" });
      });
      stream.pipe(res);
    }
  } catch (err) {
    console.error("❌ Thumbnail/Image error:", err);
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
      console.error(`❌ Security: Invalid full_path in database for ID ${id}`);
      filePath = null;
    }

    // Verify it's the FULL image, not thumbnail
    if (!filePath || filePath.includes('.thumb.')) {
      console.warn(`⚠️  ID ${id}: Database has thumbnail path in full_path! Fixing...`);
      filePath = null; // Force search
    }

    if (!filePath || !fs.existsSync(filePath)) {
      console.log(`⚠️  Path not in DB or doesn't exist for ID ${id}, searching for ORIGINAL file...`);
      // Search for ORIGINAL file, not thumbnail
      filePath = await findFileAsync(PHOTO_ROOT, row.filename);
    }
    
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`❌ File not found for ID ${id}: ${row.filename}`);
      return res.status(404).json({ error: "Image not found" });
    }
    
    // Double-check we're NOT serving the thumbnail
    if (filePath.includes('.thumb.')) {
      console.error(`❌ ERROR: Almost served thumbnail for ID ${id}! Path: ${filePath}`);
      return res.status(500).json({ error: "Internal error: thumbnail path detected" });
    }

    filePath = path.resolve(filePath);

    // Security: Final validation before serving
    if (!isPathWithinRoot(filePath)) {
      console.error(`❌ Security: Path traversal blocked for ID ${id}: ${filePath}`);
      return res.status(404).json({ error: "Image not found" });
    }

    console.log(`✅ Serving FULL image ID ${id}: ${filePath}`);
    console.log(`   File size: ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB`);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate"); // Prevent Cloudflare caching
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // Resize to a sane max width to avoid massive files.
    const maxW = Number(req.query.w || 2400);
    
    console.log(`   Processing with Sharp (max width: ${maxW}px)...`);

    sharp(filePath)
      .rotate() // respects EXIF orientation
      .resize({ width: maxW, withoutEnlargement: true })
      .jpeg({ quality: 85, progressive: true })
      .on("error", (e) => {
        console.error(`❌ Sharp error for ID ${id}:`, e.message);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to process image" });
        }
      })
      .on("info", (info) => {
        console.log(`   Sharp output: ${info.width}x${info.height}, ${info.format}`);
      })
      .pipe(res)
      .on("error", (e) => {
        console.error(`❌ Pipe error for ID ${id}:`, e.message);
      })
      .on("finish", () => {
        console.log(`✅ Successfully sent image ID ${id}`);
      });
  } catch (err) {
    console.error("❌ /display error:", err);
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
    
    const row = await dbGet("SELECT filename FROM photos WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "Photo not found" });

    const filePath = await getPhotoPathOr404Async(res, row.filename);
    if (!filePath) return;

    res.sendFile(filePath);
  } catch (err) {
    console.error("❌ Photo error:", err);
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
            const result = await dbRun(
              "INSERT OR IGNORE INTO photo_albums (photo_id, album_id) VALUES (?, ?)",
              [photoId, albumId]
            );
            result.changes > 0 ? updated++ : skipped++;
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
    console.error("❌ Bulk operation error:", err);
    res.status(500).json({ error: "Bulk operation failed" });
  }
});

// ---------------- PEOPLE (PROTECTED) ----------------
// Get all people with photo counts
app.get("/api/people", authenticateToken, async (req, res) => {
  try {
    const people = await dbAll(`
      SELECT
        p.id,
        p.name,
        p.photo_count,
        p.thumbnail_photo_id,
        ph.filename as thumbnail_filename
      FROM people p
      LEFT JOIN photos ph ON p.thumbnail_photo_id = ph.id
      WHERE p.photo_count > 0
      ORDER BY p.photo_count DESC
    `);

    res.json(
      people.map((person) => ({
        id: person.id,
        name: person.name,
        photoCount: person.photo_count,
        thumbnailUrl: person.thumbnail_photo_id
          ? `/thumbnails/${person.thumbnail_photo_id}`
          : null,
      }))
    );
  } catch (err) {
    console.error("❌ /api/people error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get a single person with their photos
app.get("/api/people/:id", authenticateToken, async (req, res) => {
  try {
    const id = validatePhotoId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid person ID" });
    }

    const person = await dbGet("SELECT * FROM people WHERE id = ?", [id]);
    if (!person) {
      return res.status(404).json({ error: "Person not found" });
    }

    // Get pagination params
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    // Get photos for this person
    const photos = await dbAll(
      `
      SELECT
        p.id,
        p.filename,
        p.is_favorite,
        p.created_at
      FROM photos p
      JOIN photo_people pp ON p.id = pp.photo_id
      WHERE pp.person_id = ?
      ORDER BY p.id
      LIMIT ? OFFSET ?
    `,
      [id, limit, offset]
    );

    res.json({
      id: person.id,
      name: person.name,
      photoCount: person.photo_count,
      photos: photos.map((p) => ({
        id: p.id,
        filename: p.filename,
        thumbnailUrl: `/thumbnails/${p.id}`,
        fullUrl: `/thumbnails/${p.id}?full=true`,
        isFavorite: Boolean(p.is_favorite),
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    console.error("❌ /api/people/:id error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get photos for a person (paginated)
app.get("/api/people/:id/photos", authenticateToken, async (req, res) => {
  try {
    const id = validatePhotoId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: "Invalid person ID" });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const photos = await dbAll(
      `
      SELECT
        p.id,
        p.filename,
        p.is_favorite,
        p.created_at
      FROM photos p
      JOIN photo_people pp ON p.id = pp.photo_id
      WHERE pp.person_id = ?
      ORDER BY p.id
      LIMIT ? OFFSET ?
    `,
      [id, limit, offset]
    );

    res.json(
      photos.map((p) => ({
        id: p.id,
        filename: p.filename,
        thumbnailUrl: `/thumbnails/${p.id}`,
        fullUrl: `/thumbnails/${p.id}?full=true`,
        isFavorite: Boolean(p.is_favorite),
        createdAt: p.created_at,
      }))
    );
  } catch (err) {
    console.error("❌ /api/people/:id/photos error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://127.0.0.1:${PORT}`);
});
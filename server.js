// FILE: server.js
import express from "express";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import cors from "cors";
import sharp from "sharp";
import { dbGet, dbAll, dbRun, dbBegin, dbCommit, dbRollback, rebuildMemoriesFts, upsertMemoryFts, deleteMemoryFts } from "./db.js";
import admin from "firebase-admin";
import { generateTags, checkOllamaHealth } from "./ai-tag-generator.js";
import { generateMemories, generateNarratives, regenerateAllMemories } from "./memory-generator.js";
import { scanAll, getDuplicateGroups, getBurstGroups, getScanStats } from "./duplicate-detector.js";
import { generateNarrative } from "./gemini-narrative.js";
import { fileURLToPath } from "url";
import { ApiError, errorHandler } from "./utils/errors.js";
import { param, body } from "express-validator";
import {
  photoIdParam,
  albumIdParam,
  personIdParam,
  faceIdParam,
  tagIdParam,
  paginationQuery,
  photoIdsBody,
  albumNameBody,
  personNameBody,
  personIdBody,
  photoIdBody,
  validate
} from "./utils/validators.js";

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

/**
 * Get photo path from database, with fallback to search
 * Updates database with found path to avoid future searches
 */
async function getPhotoPathFromDb(photoId) {
  const row = await dbGet(
    "SELECT full_path, filename FROM photos WHERE id = ?",
    [photoId]
  );

  if (!row) return null;

  // Security: Validate database path is within PHOTO_ROOT
  if (row.full_path && isPathWithinRoot(row.full_path) && fs.existsSync(row.full_path)) {
    return row.full_path;
  }

  // Fallback to search, then update DB with found path
  const found = await findFileAsync(PHOTO_ROOT, row.filename);
  if (found) {
    await dbRun("UPDATE photos SET full_path = ? WHERE id = ?", [found, photoId]);
  }
  return found;
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

  // Folders to exclude from search
  const excludedFolders = ['_duplicates', '.thumb', '@eaDir'];
  const stack = [resolvedRoot];

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip excluded folders
        if (excludedFolders.includes(entry.name)) continue;

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
app.get("/thumbnails/:id", authenticateToken, photoIdParam, validate, async (req, res) => {
  try {
    const id = req.params.id;

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
app.get(["/display/:id", "/image/:id"], authenticateToken, photoIdParam, validate, async (req, res) => {
  try {
    const id = req.params.id;

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
app.get("/photos/:id", authenticateToken, photoIdParam, validate, async (req, res) => {
  try {
    const id = req.params.id;

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
  const { action, photoIds, albumName } = req.body;

  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    return res.status(400).json({ error: "photoIds must be a non-empty array" });
  }

  let updated = 0;
  let skipped = 0;
  const errors = [];

  try {
    await dbBegin(); // Start transaction

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
          await dbRollback();
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
        await dbRollback();
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    await dbCommit(); // Commit transaction
    res.json({ action, updated, skipped, errors, total: photoIds.length });
  } catch (err) {
    await dbRollback(); // Rollback on error
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
app.get("/api/people/:id", authenticateToken, personIdParam, validate, async (req, res) => {
  try {
    const id = req.params.id;

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
app.get("/api/people/:id/photos", authenticateToken, personIdParam, paginationQuery, validate, async (req, res) => {
  try {
    const id = req.params.id;
    const limit = req.query.limit || 50;
    const offset = req.query.offset || 0;

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

// ---------------- FACE DETECTION & TAGGING API ----------------

// Get photos with unidentified faces
app.get("/api/faces/unidentified", authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    // Get photos that have faces where person_id IS NULL (unidentified)
    const photos = await dbAll(`
      SELECT DISTINCT
        p.id,
        p.filename,
        p.is_favorite,
        p.created_at,
        (SELECT COUNT(*) FROM face_embeddings fe WHERE fe.photo_id = p.id AND fe.person_id IS NULL) as unidentified_count,
        (SELECT COUNT(*) FROM face_embeddings fe WHERE fe.photo_id = p.id) as total_faces
      FROM photos p
      INNER JOIN face_embeddings fe ON p.id = fe.photo_id
      WHERE fe.person_id IS NULL
      GROUP BY p.id
      ORDER BY unidentified_count DESC, p.id
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Get total count for pagination
    const countResult = await dbGet(`
      SELECT COUNT(DISTINCT p.id) as count
      FROM photos p
      INNER JOIN face_embeddings fe ON p.id = fe.photo_id
      WHERE fe.person_id IS NULL
    `);

    res.json({
      photos: photos.map((p) => ({
        id: p.id,
        filename: p.filename,
        thumbnailUrl: `/thumbnails/${p.id}`,
        fullUrl: `/thumbnails/${p.id}?full=true`,
        isFavorite: Boolean(p.is_favorite),
        createdAt: p.created_at,
        unidentifiedCount: p.unidentified_count,
        totalFaces: p.total_faces,
      })),
      total: countResult?.count || 0,
    });
  } catch (err) {
    console.error("❌ /api/faces/unidentified error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get detected faces for a specific photo
app.get("/api/photos/:id/faces", authenticateToken, photoIdParam, validate, async (req, res) => {
  try {
    const photoId = req.params.id;

    const faces = await dbAll(`
      SELECT
        fe.id,
        fe.person_id,
        fe.bbox_x,
        fe.bbox_y,
        fe.bbox_width,
        fe.bbox_height,
        fe.confidence,
        p.name as person_name
      FROM face_embeddings fe
      LEFT JOIN people p ON fe.person_id = p.id
      WHERE fe.photo_id = ?
      ORDER BY fe.id
    `, [photoId]);

    res.json(faces.map(f => ({
      id: f.id,
      personId: f.person_id,
      personName: f.person_name,
      bbox: {
        x: f.bbox_x,
        y: f.bbox_y,
        width: f.bbox_width,
        height: f.bbox_height,
      },
      confidence: f.confidence,
    })));
  } catch (err) {
    console.error("❌ /api/photos/:id/faces error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Assign a face to a person
app.post("/api/faces/:faceId/identify", authenticateToken, faceIdParam, personIdBody, validate, async (req, res) => {
  const faceId = req.params.faceId;
  const { personId } = req.body;

  try {
    await dbBegin(); // Start transaction

    // Verify the face exists
    const face = await dbGet("SELECT * FROM face_embeddings WHERE id = ?", [faceId]);
    if (!face) {
      await dbRollback();
      return res.status(404).json({ error: "Face not found" });
    }

    // Verify the person exists
    const person = await dbGet("SELECT * FROM people WHERE id = ?", [personId]);
    if (!person) {
      await dbRollback();
      return res.status(404).json({ error: "Person not found" });
    }

    // Update the face with the person ID
    await dbRun(
      "UPDATE face_embeddings SET person_id = ? WHERE id = ?",
      [personId, faceId]
    );

    // Add to photo_people junction table if not already there
    await dbRun(
      "INSERT OR IGNORE INTO photo_people (photo_id, person_id) VALUES (?, ?)",
      [face.photo_id, personId]
    );

    // Update person's photo count
    const photoCount = await dbGet(
      "SELECT COUNT(DISTINCT photo_id) as count FROM photo_people WHERE person_id = ?",
      [personId]
    );
    await dbRun(
      "UPDATE people SET photo_count = ? WHERE id = ?",
      [photoCount.count, personId]
    );

    // Update person's face count
    const faceCount = await dbGet(
      "SELECT COUNT(*) as count FROM face_embeddings WHERE person_id = ?",
      [personId]
    );
    await dbRun(
      "UPDATE people SET face_count = ? WHERE id = ?",
      [faceCount.count, personId]
    );

    // Add this face as a reference embedding for future matching
    await dbRun(
      `INSERT INTO person_reference_embeddings (person_id, embedding, source_face_id)
       VALUES (?, ?, ?)`,
      [personId, face.embedding, faceId]
    );

    await dbCommit(); // Commit transaction
    res.json({ success: true, faceId, personId });
  } catch (err) {
    await dbRollback(); // Rollback on error
    console.error("❌ /api/faces/:faceId/identify error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Create a new person from a face
app.post("/api/faces/:faceId/create-person", authenticateToken, faceIdParam, personNameBody, validate, async (req, res) => {
  const faceId = req.params.faceId;
  const { name } = req.body;

  try {
    await dbBegin(); // Start transaction

    // Verify the face exists
    const face = await dbGet("SELECT * FROM face_embeddings WHERE id = ?", [faceId]);
    if (!face) {
      await dbRollback();
      return res.status(404).json({ error: "Face not found" });
    }

    // Create the person
    const result = await dbRun(
      "INSERT INTO people (name, thumbnail_photo_id, photo_count, face_count) VALUES (?, ?, 1, 1)",
      [name.trim(), face.photo_id]
    );
    const personId = result.lastID;

    // Update the face with the person ID
    await dbRun(
      "UPDATE face_embeddings SET person_id = ? WHERE id = ?",
      [personId, faceId]
    );

    // Add to photo_people junction table
    await dbRun(
      "INSERT OR IGNORE INTO photo_people (photo_id, person_id) VALUES (?, ?)",
      [face.photo_id, personId]
    );

    // Add this face as a reference embedding for future matching
    await dbRun(
      `INSERT INTO person_reference_embeddings (person_id, embedding, source_face_id)
       VALUES (?, ?, ?)`,
      [personId, face.embedding, faceId]
    );

    await dbCommit(); // Commit transaction

    res.json({
      success: true,
      person: {
        id: personId,
        name: name.trim(),
        photoCount: 1,
        thumbnailUrl: `/thumbnails/${face.photo_id}`,
      },
    });
  } catch (err) {
    await dbRollback(); // Rollback on error
    if (err.message?.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "A person with this name already exists" });
    }
    console.error("❌ /api/faces/:faceId/create-person error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Manual tag - add a person to a photo without face detection
app.post("/api/photos/:id/tag", authenticateToken, photoIdParam, personIdBody, validate, async (req, res) => {
  try {
    const photoId = req.params.id;
    const { personId } = req.body;

    // Verify the photo exists
    const photo = await dbGet("SELECT id FROM photos WHERE id = ?", [photoId]);
    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    // Verify the person exists
    const person = await dbGet("SELECT * FROM people WHERE id = ?", [personId]);
    if (!person) {
      return res.status(404).json({ error: "Person not found" });
    }

    // Add to photo_people junction table
    const result = await dbRun(
      "INSERT OR IGNORE INTO photo_people (photo_id, person_id) VALUES (?, ?)",
      [photoId, personId]
    );

    if (result.changes > 0) {
      // Update person's photo count
      const photoCount = await dbGet(
        "SELECT COUNT(*) as count FROM photo_people WHERE person_id = ?",
        [personId]
      );
      await dbRun(
        "UPDATE people SET photo_count = ? WHERE id = ?",
        [photoCount.count, personId]
      );
    }

    res.json({ success: true, photoId, personId, added: result.changes > 0 });
  } catch (err) {
    console.error("❌ /api/photos/:id/tag error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Remove a tag from a photo
app.delete("/api/photos/:id/tag/:personId", authenticateToken, photoIdParam, param('personId').isInt({ min: 1 }).toInt(), validate, async (req, res) => {
  try {
    const photoId = req.params.id;
    const personId = req.params.personId;

    // Remove from photo_people junction table
    const result = await dbRun(
      "DELETE FROM photo_people WHERE photo_id = ? AND person_id = ?",
      [photoId, personId]
    );

    // Also unset person_id on any face embeddings for this photo/person combo
    await dbRun(
      "UPDATE face_embeddings SET person_id = NULL WHERE photo_id = ? AND person_id = ?",
      [photoId, personId]
    );

    if (result.changes > 0) {
      // Update person's photo count
      const photoCount = await dbGet(
        "SELECT COUNT(*) as count FROM photo_people WHERE person_id = ?",
        [personId]
      );
      await dbRun(
        "UPDATE people SET photo_count = ? WHERE id = ?",
        [photoCount.count, personId]
      );

      // Update face count
      const faceCount = await dbGet(
        "SELECT COUNT(*) as count FROM face_embeddings WHERE person_id = ?",
        [personId]
      );
      await dbRun(
        "UPDATE people SET face_count = ? WHERE id = ?",
        [faceCount.count, personId]
      );
    }

    res.json({ success: true, photoId, personId, removed: result.changes > 0 });
  } catch (err) {
    console.error("❌ /api/photos/:id/tag/:personId error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Bulk tag photos with a person
app.post("/api/photos/bulk/tag", authenticateToken, async (req, res) => {
  try {
    const { photoIds, personId } = req.body;

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: "photoIds must be a non-empty array" });
    }

    if (!personId || !Number.isInteger(Number(personId))) {
      return res.status(400).json({ error: "Valid personId is required" });
    }

    // Verify the person exists
    const person = await dbGet("SELECT * FROM people WHERE id = ?", [personId]);
    if (!person) {
      return res.status(404).json({ error: "Person not found" });
    }

    let added = 0;
    let skipped = 0;
    const errors = [];

    for (const photoId of photoIds) {
      try {
        const result = await dbRun(
          "INSERT OR IGNORE INTO photo_people (photo_id, person_id) VALUES (?, ?)",
          [photoId, personId]
        );
        result.changes > 0 ? added++ : skipped++;
      } catch (e) {
        errors.push(`Failed to tag photo ${photoId}: ${e.message}`);
      }
    }

    // Update person's photo count
    const photoCount = await dbGet(
      "SELECT COUNT(*) as count FROM photo_people WHERE person_id = ?",
      [personId]
    );
    await dbRun(
      "UPDATE people SET photo_count = ? WHERE id = ?",
      [photoCount.count, personId]
    );

    res.json({ success: true, added, skipped, errors, total: photoIds.length });
  } catch (err) {
    console.error("❌ /api/photos/bulk/tag error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Search people by name
app.get("/api/people/search", authenticateToken, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    const people = await dbAll(`
      SELECT
        p.id,
        p.name,
        p.photo_count,
        p.face_count,
        p.thumbnail_photo_id
      FROM people p
      WHERE p.name LIKE ?
      ORDER BY p.photo_count DESC
      LIMIT 20
    `, [`%${query}%`]);

    res.json(people.map(person => ({
      id: person.id,
      name: person.name,
      photoCount: person.photo_count || 0,
      faceCount: person.face_count || 0,
      thumbnailUrl: person.thumbnail_photo_id
        ? `/thumbnails/${person.thumbnail_photo_id}`
        : null,
    })));
  } catch (err) {
    console.error("❌ /api/people/search error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get count of unidentified faces
app.get("/api/faces/unidentified/count", authenticateToken, async (req, res) => {
  try {
    const result = await dbGet(`
      SELECT COUNT(DISTINCT photo_id) as photoCount, COUNT(*) as faceCount
      FROM face_embeddings
      WHERE person_id IS NULL
    `);

    res.json({
      photoCount: result?.photoCount || 0,
      faceCount: result?.faceCount || 0,
    });
  } catch (err) {
    console.error("❌ /api/faces/unidentified/count error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get people tagged in a specific photo
app.get("/api/photos/:id/people", authenticateToken, photoIdParam, validate, async (req, res) => {
  try {
    const photoId = req.params.id;

    const people = await dbAll(`
      SELECT
        p.id,
        p.name,
        p.photo_count,
        p.thumbnail_photo_id
      FROM people p
      INNER JOIN photo_people pp ON p.id = pp.person_id
      WHERE pp.photo_id = ?
      ORDER BY p.name
    `, [photoId]);

    res.json(people.map(person => ({
      id: person.id,
      name: person.name,
      photoCount: person.photo_count || 0,
      thumbnailUrl: person.thumbnail_photo_id
        ? `/thumbnails/${person.thumbnail_photo_id}`
        : null,
    })));
  } catch (err) {
    console.error("❌ /api/photos/:id/people error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ========== ALBUM ENDPOINTS ==========

// Get all albums for the current user
app.get("/api/albums", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const albums = await dbAll(`
      SELECT
        a.id,
        a.name,
        a.description,
        a.cover_photo_id,
        a.created_at,
        a.updated_at,
        COUNT(pa.photo_id) as photo_count
      FROM albums a
      LEFT JOIN photo_albums pa ON a.id = pa.album_id
      WHERE a.user_id = ?
      GROUP BY a.id
      ORDER BY a.updated_at DESC
    `, [userId]);

    res.json(albums.map(album => ({
      id: album.id,
      name: album.name,
      description: album.description,
      coverPhotoId: album.cover_photo_id,
      photoCount: album.photo_count || 0,
      createdAt: album.created_at,
      updatedAt: album.updated_at,
    })));
  } catch (err) {
    console.error("❌ /api/albums error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get a specific album with its photos
app.get("/api/albums/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    const albumId = parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (isNaN(albumId)) {
      return res.status(400).json({ error: "Invalid album ID" });
    }

    // Get album details (only if it belongs to the user)
    const album = await dbGet(`
      SELECT id, name, description, cover_photo_id, created_at, updated_at
      FROM albums
      WHERE id = ? AND user_id = ?
    `, [albumId, userId]);

    if (!album) {
      return res.status(404).json({ error: "Album not found" });
    }

    // Get photos in the album
    const photos = await dbAll(`
      SELECT p.id, p.filename, p.full_path, p.is_favorite, pa.added_at
      FROM photos p
      INNER JOIN photo_albums pa ON p.id = pa.photo_id
      WHERE pa.album_id = ?
      ORDER BY pa.added_at DESC
    `, [albumId]);

    res.json({
      id: album.id,
      name: album.name,
      description: album.description,
      coverPhotoId: album.cover_photo_id,
      createdAt: album.created_at,
      updatedAt: album.updated_at,
      photos: photos.map(p => ({
        id: p.id,
        filename: p.filename,
        isFavorite: !!p.is_favorite,
        addedAt: p.added_at,
      })),
    });
  } catch (err) {
    console.error("❌ /api/albums/:id error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Create a new album
app.post("/api/albums", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: "Album name is required" });
    }

    const result = await dbRun(`
      INSERT INTO albums (user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `, [userId, name.trim(), description?.trim() || null]);

    res.status(201).json({
      id: result.lastID,
      name: name.trim(),
      description: description?.trim() || null,
      photoCount: 0,
    });
  } catch (err) {
    console.error("❌ POST /api/albums error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Update an album (rename/description)
app.put("/api/albums/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    const albumId = parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (isNaN(albumId)) {
      return res.status(400).json({ error: "Invalid album ID" });
    }

    const { name, description, coverPhotoId } = req.body;

    // Verify ownership
    const album = await dbGet(`SELECT id FROM albums WHERE id = ? AND user_id = ?`, [albumId, userId]);
    if (!album) {
      return res.status(404).json({ error: "Album not found" });
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: "Album name cannot be empty" });
      }
      updates.push('name = ?');
      params.push(name.trim());
    }

    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description?.trim() || null);
    }

    if (coverPhotoId !== undefined) {
      updates.push('cover_photo_id = ?');
      params.push(coverPhotoId);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    updates.push("updated_at = datetime('now')");
    params.push(albumId, userId);

    await dbRun(`
      UPDATE albums SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
    `, params);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ PUT /api/albums/:id error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Delete an album
app.delete("/api/albums/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    const albumId = parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (isNaN(albumId)) {
      return res.status(400).json({ error: "Invalid album ID" });
    }

    // Verify ownership and delete
    const result = await dbRun(`DELETE FROM albums WHERE id = ? AND user_id = ?`, [albumId, userId]);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Album not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /api/albums/:id error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Add a single photo to an album
app.post("/api/albums/:id/photos", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    const albumId = parseInt(req.params.id, 10);
    const { photoId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (isNaN(albumId)) {
      return res.status(400).json({ error: "Invalid album ID" });
    }

    const validPhotoId = validatePhotoId(photoId);
    if (validPhotoId === null) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }

    // Verify album ownership
    const album = await dbGet(`SELECT id FROM albums WHERE id = ? AND user_id = ?`, [albumId, userId]);
    if (!album) {
      return res.status(404).json({ error: "Album not found" });
    }

    // Add photo to album (ignore if already exists)
    await dbRun(`
      INSERT OR IGNORE INTO photo_albums (photo_id, album_id, added_at)
      VALUES (?, ?, datetime('now'))
    `, [validPhotoId, albumId]);

    // Update album's updated_at
    await dbRun(`UPDATE albums SET updated_at = datetime('now') WHERE id = ?`, [albumId]);

    // Set cover photo if this is the first photo
    const coverCheck = await dbGet(`SELECT cover_photo_id FROM albums WHERE id = ?`, [albumId]);
    if (!coverCheck.cover_photo_id) {
      await dbRun(`UPDATE albums SET cover_photo_id = ? WHERE id = ?`, [validPhotoId, albumId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ POST /api/albums/:id/photos error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Bulk add photos to an album
app.post("/api/albums/:id/photos/bulk", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    const albumId = parseInt(req.params.id, 10);
    const { photoIds } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (isNaN(albumId)) {
      return res.status(400).json({ error: "Invalid album ID" });
    }

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: "photoIds array is required" });
    }

    // Verify album ownership
    const album = await dbGet(`SELECT id, cover_photo_id FROM albums WHERE id = ? AND user_id = ?`, [albumId, userId]);
    if (!album) {
      return res.status(404).json({ error: "Album not found" });
    }

    // Add each photo
    let added = 0;
    for (const photoId of photoIds) {
      const validId = validatePhotoId(photoId);
      if (validId !== null) {
        try {
          await dbRun(`
            INSERT OR IGNORE INTO photo_albums (photo_id, album_id, added_at)
            VALUES (?, ?, datetime('now'))
          `, [validId, albumId]);
          added++;
        } catch {
          // Ignore individual insert errors
        }
      }
    }

    // Update album's updated_at
    await dbRun(`UPDATE albums SET updated_at = datetime('now') WHERE id = ?`, [albumId]);

    // Set cover photo if not set
    if (!album.cover_photo_id && photoIds.length > 0) {
      const firstValidId = validatePhotoId(photoIds[0]);
      if (firstValidId !== null) {
        await dbRun(`UPDATE albums SET cover_photo_id = ? WHERE id = ?`, [firstValidId, albumId]);
      }
    }

    res.json({ success: true, added });
  } catch (err) {
    console.error("❌ POST /api/albums/:id/photos/bulk error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Remove a photo from an album
app.delete("/api/albums/:id/photos/:photoId", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    const albumId = parseInt(req.params.id, 10);
    const photoId = validatePhotoId(req.params.photoId);

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (isNaN(albumId)) {
      return res.status(400).json({ error: "Invalid album ID" });
    }

    if (photoId === null) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }

    // Verify album ownership
    const album = await dbGet(`SELECT id, cover_photo_id FROM albums WHERE id = ? AND user_id = ?`, [albumId, userId]);
    if (!album) {
      return res.status(404).json({ error: "Album not found" });
    }

    // Remove photo from album
    await dbRun(`DELETE FROM photo_albums WHERE album_id = ? AND photo_id = ?`, [albumId, photoId]);

    // Update album's updated_at
    await dbRun(`UPDATE albums SET updated_at = datetime('now') WHERE id = ?`, [albumId]);

    // If removed photo was the cover, update cover to another photo or null
    if (album.cover_photo_id === photoId) {
      const newCover = await dbGet(`
        SELECT photo_id FROM photo_albums WHERE album_id = ? LIMIT 1
      `, [albumId]);
      await dbRun(`UPDATE albums SET cover_photo_id = ? WHERE id = ?`, [newCover?.photo_id || null, albumId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /api/albums/:id/photos/:photoId error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ========== TAGS ENDPOINTS ==========

// Get all tags (for autocomplete/search)
app.get("/api/tags", authenticateToken, async (req, res) => {
  try {
    const { type, q } = req.query;

    let query = `SELECT id, name, type, color FROM tags`;
    const params = [];
    const conditions = [];

    if (type) {
      conditions.push(`type = ?`);
      params.push(type);
    }

    if (q) {
      conditions.push(`name LIKE ?`);
      params.push(`%${q}%`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY name ASC LIMIT 100`;

    const tags = await dbAll(query, params);
    res.json(tags);
  } catch (err) {
    console.error("❌ /api/tags error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Create a new tag
app.post("/api/tags", authenticateToken, async (req, res) => {
  try {
    const { name, type = 'user', color } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: "Tag name is required" });
    }

    const validTypes = ['user', 'ai', 'person'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid tag type" });
    }

    // Check if tag already exists
    const existing = await dbGet(
      `SELECT id, name, type, color FROM tags WHERE name = ? AND type = ?`,
      [name.trim().toLowerCase(), type]
    );

    if (existing) {
      return res.json(existing); // Return existing tag instead of error
    }

    const result = await dbRun(
      `INSERT INTO tags (name, type, color) VALUES (?, ?, ?)`,
      [name.trim().toLowerCase(), type, color || null]
    );

    res.status(201).json({
      id: result.lastID,
      name: name.trim().toLowerCase(),
      type,
      color: color || null,
    });
  } catch (err) {
    console.error("❌ POST /api/tags error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get tags for a specific photo
app.get("/api/photos/:id/tags", authenticateToken, photoIdParam, validate, async (req, res) => {
  try {
    const photoId = req.params.id;

    const tags = await dbAll(`
      SELECT t.id, t.name, t.type, t.color, pt.added_by, pt.added_at
      FROM tags t
      INNER JOIN photo_tags pt ON t.id = pt.tag_id
      WHERE pt.photo_id = ?
      ORDER BY t.type, t.name
    `, [photoId]);

    res.json(tags);
  } catch (err) {
    console.error("❌ /api/photos/:id/tags error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Add a tag to a photo
app.post("/api/photos/:id/tags", authenticateToken, photoIdParam, validate, async (req, res) => {
  try {
    const photoId = req.params.id;
    const { tagId, tagName, tagType = 'user' } = req.body;
    const userId = req.user?.uid;

    let finalTagId = tagId;

    // If tagName is provided instead of tagId, find or create the tag
    if (!finalTagId && tagName) {
      const existingTag = await dbGet(
        `SELECT id FROM tags WHERE name = ? AND type = ?`,
        [tagName.trim().toLowerCase(), tagType]
      );

      if (existingTag) {
        finalTagId = existingTag.id;
      } else {
        const result = await dbRun(
          `INSERT INTO tags (name, type) VALUES (?, ?)`,
          [tagName.trim().toLowerCase(), tagType]
        );
        finalTagId = result.lastID;
      }
    }

    if (!finalTagId) {
      return res.status(400).json({ error: "Either tagId or tagName is required" });
    }

    // Add the tag to the photo
    await dbRun(
      `INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, added_by, added_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [photoId, finalTagId, userId]
    );

    // Return the tag details
    const tag = await dbGet(`SELECT id, name, type, color FROM tags WHERE id = ?`, [finalTagId]);

    res.json({ success: true, tag });
  } catch (err) {
    console.error("❌ POST /api/photos/:id/tags error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Remove a tag from a photo
app.delete("/api/photos/:id/tags/:tagId", authenticateToken, photoIdParam, tagIdParam, validate, async (req, res) => {
  try {
    const photoId = req.params.id;
    const tagId = req.params.tagId;

    await dbRun(
      `DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?`,
      [photoId, tagId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /api/photos/:id/tags/:tagId error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------------- AI TAG GENERATION ----------------

// Check Ollama health
app.get("/api/ai/health", authenticateToken, async (req, res) => {
  try {
    const isHealthy = await checkOllamaHealth();
    res.json({
      available: isHealthy,
      model: process.env.OLLAMA_MODEL || 'mistral:latest'
    });
  } catch (err) {
    console.error("❌ /api/ai/health error:", err);
    res.json({ available: false, error: err.message });
  }
});

// Generate AI tags for a single photo
app.post("/api/photos/:id/generate-tags", authenticateToken, async (req, res) => {
  const photoId = parseInt(req.params.id, 10);

  try {
    // Check Ollama availability
    const ollamaOk = await checkOllamaHealth();
    if (!ollamaOk) {
      return res.status(503).json({ error: "AI service unavailable" });
    }

    // Get photo details
    const photo = await dbGet("SELECT * FROM photos WHERE id = ?", [photoId]);
    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    // Get existing tags
    const existingTags = await dbAll(
      `SELECT t.name FROM tags t
       JOIN photo_tags pt ON pt.tag_id = t.id
       WHERE pt.photo_id = ?`,
      [photoId]
    );

    // Get people tagged in photo
    const people = await dbAll(
      `SELECT p.name FROM people p
       JOIN photo_people pp ON pp.person_id = p.id
       WHERE pp.photo_id = ?`,
      [photoId]
    );

    // Build metadata for AI
    const photoData = {
      filename: photo.filename,
      existingTags: existingTags.map(t => t.name),
      people: people.map(p => p.name),
      dateTaken: photo.created_at,
      exif: {}, // Could be extended to include EXIF data if stored
    };

    // Generate tags
    const generatedTags = await generateTags(photoData);

    if (generatedTags.length === 0) {
      return res.json({ success: true, tags: [], message: "No new tags generated" });
    }

    // Add generated tags to database
    const addedTags = [];
    for (const tagName of generatedTags) {
      // Create or get the tag
      let tag = await dbGet(
        "SELECT * FROM tags WHERE name = ? AND type = 'ai'",
        [tagName]
      );

      if (!tag) {
        const result = await dbRun(
          "INSERT INTO tags (name, type) VALUES (?, 'ai')",
          [tagName]
        );
        tag = { id: result.lastID, name: tagName, type: 'ai' };
      }

      // Check if already linked to photo
      const existing = await dbGet(
        "SELECT 1 FROM photo_tags WHERE photo_id = ? AND tag_id = ?",
        [photoId, tag.id]
      );

      if (!existing) {
        await dbRun(
          "INSERT INTO photo_tags (photo_id, tag_id, added_by) VALUES (?, ?, 'ai')",
          [photoId, tag.id]
        );
        addedTags.push(tag);
      }
    }

    console.log(`✅ Generated ${addedTags.length} AI tags for photo ${photoId}`);
    res.json({ success: true, tags: addedTags });

  } catch (err) {
    console.error("❌ POST /api/photos/:id/generate-tags error:", err);
    res.status(500).json({ error: "Failed to generate tags" });
  }
});

// Bulk generate AI tags for multiple photos
app.post("/api/photos/bulk/generate-tags", authenticateToken, async (req, res) => {
  const { photoIds, limit = 10 } = req.body;

  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    return res.status(400).json({ error: "photoIds array required" });
  }

  // Limit batch size
  const idsToProcess = photoIds.slice(0, Math.min(limit, 50));

  try {
    // Check Ollama availability
    const ollamaOk = await checkOllamaHealth();
    if (!ollamaOk) {
      return res.status(503).json({ error: "AI service unavailable" });
    }

    const results = [];

    for (const photoId of idsToProcess) {
      try {
        // Get photo details
        const photo = await dbGet("SELECT * FROM photos WHERE id = ?", [photoId]);
        if (!photo) {
          results.push({ photoId, success: false, error: "Not found" });
          continue;
        }

        // Get existing tags
        const existingTags = await dbAll(
          `SELECT t.name FROM tags t
           JOIN photo_tags pt ON pt.tag_id = t.id
           WHERE pt.photo_id = ?`,
          [photoId]
        );

        // Get people tagged in photo
        const people = await dbAll(
          `SELECT p.name FROM people p
           JOIN photo_people pp ON pp.person_id = p.id
           WHERE pp.photo_id = ?`,
          [photoId]
        );

        // Build metadata for AI
        const photoData = {
          filename: photo.filename,
          existingTags: existingTags.map(t => t.name),
          people: people.map(p => p.name),
          dateTaken: photo.created_at,
          exif: {},
        };

        // Generate tags
        const generatedTags = await generateTags(photoData);
        const addedTags = [];

        for (const tagName of generatedTags) {
          let tag = await dbGet(
            "SELECT * FROM tags WHERE name = ? AND type = 'ai'",
            [tagName]
          );

          if (!tag) {
            const result = await dbRun(
              "INSERT INTO tags (name, type) VALUES (?, 'ai')",
              [tagName]
            );
            tag = { id: result.lastID, name: tagName, type: 'ai' };
          }

          const existing = await dbGet(
            "SELECT 1 FROM photo_tags WHERE photo_id = ? AND tag_id = ?",
            [photoId, tag.id]
          );

          if (!existing) {
            await dbRun(
              "INSERT INTO photo_tags (photo_id, tag_id, added_by) VALUES (?, ?, 'ai')",
              [photoId, tag.id]
            );
            addedTags.push(tag);
          }
        }

        results.push({ photoId, success: true, tagsAdded: addedTags.length });

      } catch (err) {
        results.push({ photoId, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalTagsAdded = results.reduce((sum, r) => sum + (r.tagsAdded || 0), 0);

    console.log(`✅ Bulk AI tagging: ${successCount}/${idsToProcess.length} photos, ${totalTagsAdded} tags added`);
    res.json({
      success: true,
      processed: idsToProcess.length,
      successful: successCount,
      totalTagsAdded,
      results
    });

  } catch (err) {
    console.error("❌ POST /api/photos/bulk/generate-tags error:", err);
    res.status(500).json({ error: "Failed to generate tags" });
  }
});

// ========== MEMORIES ENDPOINTS ==========

// In-memory lock to prevent concurrent generation runs
let memoriesGenerating = false;

// List all memories (newest first)
app.get("/api/memories", authenticateToken, async (req, res) => {
  try {
    const memories = await dbAll(`
      SELECT
        m.id,
        m.title,
        m.narrative,
        m.cover_photo_id,
        m.event_date_start,
        m.event_date_end,
        m.location_label,
        m.photo_count,
        m.confidence
      FROM memories m
      ORDER BY m.event_date_start DESC
    `);

    const token = req.headers.authorization?.substring(7) || req.query.token;
    const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

    res.json(
      memories.map((m) => ({
        id: m.id,
        title: m.title,
        narrative: m.narrative,
        coverPhotoUrl: m.cover_photo_id
          ? `/thumbnails/${m.cover_photo_id}?${authParams}`
          : null,
        photoCount: m.photo_count,
        eventDateStart: m.event_date_start,
        eventDateEnd: m.event_date_end,
        locationLabel: m.location_label,
        confidence: m.confidence,
      }))
    );
  } catch (err) {
    console.error("❌ GET /api/memories error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Search memories via FTS5
app.get("/api/memories/search", authenticateToken, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) {
      return res.redirect("/api/memories");
    }

    // Convert "word1 word2" to "word1* AND word2*" for prefix + AND matching
    const terms = q.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '')}"*`).join(" AND ");

    const memories = await dbAll(`
      SELECT
        m.id,
        m.title,
        m.narrative,
        m.cover_photo_id,
        m.event_date_start,
        m.event_date_end,
        m.location_label,
        m.photo_count,
        m.confidence
      FROM memories m
      JOIN memories_fts fts ON fts.rowid = m.id
      WHERE memories_fts MATCH ?
      ORDER BY fts.rank
    `, [terms]);

    const token = req.headers.authorization?.substring(7) || req.query.token;
    const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

    res.json(
      memories.map((m) => ({
        id: m.id,
        title: m.title,
        narrative: m.narrative,
        coverPhotoUrl: m.cover_photo_id
          ? `/thumbnails/${m.cover_photo_id}?${authParams}`
          : null,
        photoCount: m.photo_count,
        eventDateStart: m.event_date_start,
        eventDateEnd: m.event_date_end,
        locationLabel: m.location_label,
        confidence: m.confidence,
      }))
    );
  } catch (err) {
    console.error("❌ GET /api/memories/search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// Get a single memory with its photos
app.get("/api/memories/:id", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid memory ID" });
    }

    const memory = await dbGet(`
      SELECT
        m.id,
        m.title,
        m.narrative,
        m.cover_photo_id,
        m.event_date_start,
        m.event_date_end,
        m.location_label,
        m.photo_count,
        m.confidence
      FROM memories m
      WHERE m.id = ?
    `, [id]);

    if (!memory) {
      return res.status(404).json({ error: "Memory not found" });
    }

    const photos = await dbAll(`
      SELECT
        p.id,
        p.filename,
        p.is_favorite,
        p.created_at
      FROM photos p
      JOIN memory_photos mp ON p.id = mp.photo_id
      WHERE mp.memory_id = ?
      ORDER BY p.id
    `, [id]);

    const token = req.headers.authorization?.substring(7) || req.query.token;
    const cacheBuster = String(Date.now());
    const authParams = `token=${encodeURIComponent(token)}&v=${cacheBuster}`;

    res.json({
      id: memory.id,
      title: memory.title,
      narrative: memory.narrative,
      coverPhotoId: memory.cover_photo_id,
      coverPhotoUrl: memory.cover_photo_id
        ? `/thumbnails/${memory.cover_photo_id}?${authParams}`
        : null,
      photoCount: memory.photo_count,
      eventDateStart: memory.event_date_start,
      eventDateEnd: memory.event_date_end,
      locationLabel: memory.location_label,
      confidence: memory.confidence,
      photos: photos.map((p) => ({
        id: p.id,
        filename: p.filename,
        thumbnailUrl: `/thumbnails/${p.id}?${authParams}`,
        fullUrl: `/thumbnails/${p.id}?full=true&${authParams}`,
        isFavorite: Boolean(p.is_favorite),
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    console.error("❌ GET /api/memories/:id error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Update a memory (title, narrative, location, cover photo)
app.put("/api/memories/:id", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid memory ID" });
    }

    const memory = await dbGet("SELECT id FROM memories WHERE id = ?", [id]);
    if (!memory) {
      return res.status(404).json({ error: "Memory not found" });
    }

    const { title, narrative, locationLabel, coverPhotoId } = req.body;

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: "Title cannot be empty" });
      }
      updates.push('title = ?');
      params.push(title.trim());
    }

    if (narrative !== undefined) {
      updates.push('narrative = ?');
      params.push(narrative?.trim() || null);
    }

    if (locationLabel !== undefined) {
      updates.push('location_label = ?');
      params.push(locationLabel?.trim() || null);
    }

    if (coverPhotoId !== undefined) {
      if (coverPhotoId !== null) {
        // Validate that the photo belongs to this memory
        const belongs = await dbGet(
          "SELECT 1 FROM memory_photos WHERE memory_id = ? AND photo_id = ?",
          [id, coverPhotoId]
        );
        if (!belongs) {
          return res.status(400).json({ error: "Photo does not belong to this memory" });
        }
      }
      updates.push('cover_photo_id = ?');
      params.push(coverPhotoId);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    await dbRun(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`, params);

    // Sync FTS index
    await upsertMemoryFts(id);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ PUT /api/memories/:id error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Generate AI title/narrative/location for a single memory (returns suggestions, does NOT save)
app.post("/api/memories/:id/generate", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid memory ID" });
    }

    const memory = await dbGet(
      `SELECT id, event_date_start, event_date_end, center_lat, center_lng, photo_count
       FROM memories WHERE id = ?`,
      [id]
    );
    if (!memory) {
      return res.status(404).json({ error: "Memory not found" });
    }

    // Gather people in this memory's photos
    const people = await dbAll(
      `SELECT DISTINCT p.name
       FROM people p
       JOIN photo_people pp ON p.id = pp.person_id
       JOIN memory_photos mp ON pp.photo_id = mp.photo_id
       WHERE mp.memory_id = ?`,
      [id]
    );

    // Gather top tags
    const tags = await dbAll(
      `SELECT t.name, COUNT(*) as cnt
       FROM tags t
       JOIN photo_tags pt ON t.id = pt.tag_id
       JOIN memory_photos mp ON pt.photo_id = mp.photo_id
       WHERE mp.memory_id = ?
       GROUP BY t.name
       ORDER BY cnt DESC
       LIMIT 10`,
      [id]
    );

    const startDate = new Date(memory.event_date_start);
    const m = startDate.getMonth();
    const season = m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "fall" : "winter";

    const metadata = {
      eventDateStart: memory.event_date_start,
      eventDateEnd: memory.event_date_end,
      centerLat: memory.center_lat,
      centerLng: memory.center_lng,
      photoCount: memory.photo_count,
      people: people.map((p) => p.name),
      tags: tags.map((t) => t.name),
      season,
    };

    const result = await generateNarrative(metadata);

    res.json({
      title: result.title || null,
      narrative: result.narrative || null,
      locationLabel: result.locationLabel || null,
    });
  } catch (err) {
    console.error("❌ POST /api/memories/:id/generate error:", err);
    res.status(500).json({ error: "Failed to generate narrative" });
  }
});

// Trigger memory generation (clustering + narratives)
app.post("/api/memories/generate", authenticateToken, async (req, res) => {
  if (memoriesGenerating) {
    return res.status(409).json({ error: "Memory generation already in progress" });
  }

  memoriesGenerating = true;
  try {
    console.log("🧠 Starting memory generation...");

    // Step 1: Cluster photos into events
    const clusterResult = await generateMemories();
    console.log(`✅ Clustering: ${clusterResult.created} created, ${clusterResult.skipped} skipped`);

    // Step 2: Generate AI narratives for new memories
    const narrativeCount = await generateNarratives();
    console.log(`✅ Narratives: ${narrativeCount} generated`);

    // Rebuild FTS index after generation
    await rebuildMemoriesFts();

    res.json({
      created: clusterResult.created,
      skipped: clusterResult.skipped,
      narrativesGenerated: narrativeCount,
    });
  } catch (err) {
    console.error("❌ POST /api/memories/generate error:", err);
    res.status(500).json({ error: "Memory generation failed" });
  } finally {
    memoriesGenerating = false;
  }
});

// Full regeneration: delete all memories, re-cluster, and enrich with AI
app.post("/api/memories/regenerate", authenticateToken, async (req, res) => {
  if (memoriesGenerating) {
    return res.status(409).json({ error: "Memory generation already in progress" });
  }

  const { confirm } = req.body || {};
  if (!confirm) {
    return res.status(400).json({ error: "Confirmation required. Send { confirm: true } to proceed." });
  }

  memoriesGenerating = true;
  try {
    console.log("🔄 Starting full memory regeneration...");
    const result = await regenerateAllMemories();
    // Rebuild FTS index after full regeneration
    await rebuildMemoriesFts();
    console.log(`✅ Regeneration complete: ${result.created} created, ${result.enriched} enriched.`);
    res.json(result);
  } catch (err) {
    console.error("❌ POST /api/memories/regenerate error:", err);
    res.status(500).json({ error: "Memory regeneration failed: " + err.message });
  } finally {
    memoriesGenerating = false;
  }
});

// Delete a memory
app.delete("/api/memories/:id", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid memory ID" });
    }

    const result = await dbRun("DELETE FROM memories WHERE id = ?", [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Memory not found" });
    }

    // Remove from FTS index
    await deleteMemoryFts(id);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /api/memories/:id error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------------- DUPLICATE DETECTION ----------------

let duplicateScanRunning = false;

app.get("/api/photos/duplicates/stats", authenticateToken, async (req, res) => {
  try {
    const stats = await getScanStats();
    stats.scanning = duplicateScanRunning;
    res.json(stats);
  } catch (err) {
    console.error("❌ GET /api/photos/duplicates/stats error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/photos/duplicates", authenticateToken, async (req, res) => {
  try {
    const groups = await getDuplicateGroups();
    const token = req.headers.authorization?.substring(7) || req.query.token;
    const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

    res.json(
      groups.map((g) => ({
        groupId: g.groupId,
        count: g.count,
        photos: g.photos.map((p) => ({
          id: p.id,
          filename: p.filename,
          dateTaken: p.date_taken,
          width: p.width,
          height: p.height,
          thumbnailUrl: `/thumbnails/${p.id}?${authParams}`,
          fullUrl: `/photos/${p.id}?${authParams}`,
        })),
      }))
    );
  } catch (err) {
    console.error("❌ GET /api/photos/duplicates error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/photos/bursts", authenticateToken, async (req, res) => {
  try {
    const groups = await getBurstGroups();
    const token = req.headers.authorization?.substring(7) || req.query.token;
    const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

    res.json(
      groups.map((g) => ({
        groupId: g.groupId,
        count: g.count,
        photos: g.photos.map((p) => ({
          id: p.id,
          filename: p.filename,
          dateTaken: p.date_taken,
          width: p.width,
          height: p.height,
          thumbnailUrl: `/thumbnails/${p.id}?${authParams}`,
          fullUrl: `/photos/${p.id}?${authParams}`,
        })),
      }))
    );
  } catch (err) {
    console.error("❌ GET /api/photos/bursts error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/photos/scan-duplicates", authenticateToken, async (req, res) => {
  if (duplicateScanRunning) {
    return res.status(409).json({ error: "Scan already in progress" });
  }

  duplicateScanRunning = true;
  res.json({ started: true, message: "Duplicate scan started in background" });

  try {
    const result = await scanAll((done, total, hashed, failed) => {
      console.log(`  Hashing: ${done}/${total} (${hashed} ok, ${failed} failed)`);
    });
    console.log("✅ Duplicate scan complete:", result);
  } catch (err) {
    console.error("❌ Duplicate scan failed:", err);
  } finally {
    duplicateScanRunning = false;
  }
});

// ---------------- ERROR HANDLER ----------------
app.use(errorHandler);

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://127.0.0.1:${PORT}`);
});
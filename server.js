// FILE: server.js
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import sharp from "sharp";
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
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(cors({ origin: allowedOrigins, credentials: true, methods: ["GET", "POST", "DELETE", "OPTIONS"] }));
app.use(express.json());

(async () => {
  try {
    await dbRun("ALTER TABLE photos ADD COLUMN is_deleted INTEGER DEFAULT 0");
  } catch (err) {
    if (!/duplicate column/i.test(err?.message || "")) {
      console.error("Failed to add is_deleted column:", err);
    }
  }
})();

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
    req.user = decodedToken; // Attach user info to request
    console.log(`Γ£à Auth success: ${decodedToken.email}`);
    next();
  } catch (error) {
    console.error("Γ¥î Token verification failed:", error);
    console.error(`   Received token: ${token.substring(0, 50)}...`);
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
        console.error(`Γ¥î Security: Invalid full_path in database for ID ${id}`);
        filePath = null;
      }

      if (!filePath || filePath.includes('.thumb.') || !fs.existsSync(filePath)) {
        console.log(`ΓÜá∩╕Å  Searching for FULL image ID ${id}...`);
        filePath = findFileRecursive(PHOTO_ROOT, row.filename);
      }

      if (!filePath || !fs.existsSync(filePath)) {
        console.error(`Γ¥î Full image not found for ID ${id}`);
        return res.status(404).json({ error: "Image not found" });
      }
      
      console.log(`Γ£à Serving FULL image ID ${id}: ${filePath}`);
      
      // Use Sharp to process full image
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
      
      const maxW = Number(req.query.w || 2400);
      
      sharp(filePath)
        .rotate()
        .resize({ width: maxW, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .on("error", (e) => {
          console.error(`Γ¥î Sharp error for ID ${id}:`, e.message);
          if (!res.headersSent) res.status(500).json({ error: "Failed to process image" });
        })
        .pipe(res);
    } else {
      // Serve thumbnail (original behavior)
      filePath = row.thumbnail_path;

      // Security: Validate database path is within PHOTO_ROOT
      if (filePath && !isPathWithinRoot(filePath)) {
        console.error(`Γ¥î Security: Invalid thumbnail_path in database for ID ${id}`);
        filePath = null;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        const thumbName = `${row.filename}.thumb.jpg`;
        filePath = findFileRecursive(PHOTO_ROOT, thumbName);
      }

      if (!filePath || !fs.existsSync(filePath)) {
        let originalPath = row.full_path;

        if (originalPath && !isPathWithinRoot(originalPath)) {
          console.error(`Î“Â¥Ã® Security: Invalid full_path in database for ID ${id}`);
          originalPath = null;
        }

        if (!originalPath || !fs.existsSync(originalPath)) {
          originalPath = findFileRecursive(PHOTO_ROOT, row.filename);
        }

        if (!originalPath || !fs.existsSync(originalPath)) {
          return res.status(404).json({ error: "Thumbnail not found" });
        }

        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=3600");

        sharp(originalPath)
          .rotate()
          .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80, progressive: true })
          .on("error", (e) => {
            console.error(`Î“Â¥Ã® Sharp thumbnail fallback error for ID ${id}:`, e.message);
            if (!res.headersSent) res.status(500).json({ error: "Failed to generate thumbnail" });
          })
          .pipe(res);
        return;
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      
      const stream = fs.createReadStream(filePath);
      stream.on("error", (err) => {
        console.error(`Γ¥î Stream error for thumbnail ID ${id}:`, err.message);
        if (!res.headersSent) res.status(500).json({ error: "Failed to load thumbnail" });
      });
      stream.pipe(res);
    }
  } catch (err) {
    console.error("Γ¥î Thumbnail/Image error:", err);
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

    sharp(filePath)
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
    
    const row = await dbGet("SELECT filename FROM photos WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "Photo not found" });

    const filePath = getPhotoPathOr404(res, row.filename);
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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
  const ftsQuery = sanitized.map(t => '"' + t + '"').join(' OR ');
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
    const allTerms   = [...new Set([q, ...concepts])];
    console.log(`🔍 Search "${q}" offset=${offset} → person:${personName} date:${JSON.stringify(dateRange)} concepts:${concepts.slice(0,3).join(',')}`);

    // All sources in parallel — fetch innerLimit so pagination works
    const [ftsRows, personRows, tagRows, dateRows] = await Promise.all([
      searchFTS(allTerms, innerLimit),
      personName ? searchByPerson(personName, innerLimit) : Promise.resolve([]),
      searchByTags(tagTerms, innerLimit),
      dateRange  ? searchByDateRange(dateRange, innerLimit) : Promise.resolve([])
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

    // Merge: person > date > fts > tags > semantic, then slice to requested page
    const combined = mergeResults([personRows, dateRows, ftsRows, tagRows, semanticRows], innerLimit);
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
      meta: { personName, dateRange, concepts, sources: { person: personRows.length, date: dateRows.length, fts: ftsRows.length, tags: tagRows.length, semantic: semanticRows.length } }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ALBUMS
app.get("/api/albums", authenticateToken, async (_req, res) => {
  try {
    const tableCheck = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='albums'");
    if (!tableCheck) return res.json([]);
    const cols = await dbAll(`PRAGMA table_info(albums)`);
    const hasPhotoCount = cols.some((r) => r.name === 'photo_count');
    const rows = hasPhotoCount
      ? await dbAll(`SELECT id, name, photo_count AS photoCount FROM albums ORDER BY id DESC`)
      : await dbAll(`SELECT id, name, NULL AS photoCount FROM albums ORDER BY id DESC`);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: "Failed to load albums" });
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
  // Fetch one extra to detect hasMore
  const groups = await dbAll(
    `
    SELECT ${column} as groupId, COUNT(*) as count
    FROM photos
    WHERE ${column} IS NOT NULL
    GROUP BY ${column}
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
    WHERE ${column} IN (${placeholders})
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
      "UPDATE photos SET is_deleted = ? WHERE id = ?",
      [isDeleted ? 1 : 0, photoId]
    );
    updated += Number(result?.changes || 0);
  }

  return updated;
}

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

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`≡ƒÜÇ Backend running on http://127.0.0.1:${PORT}`);
});

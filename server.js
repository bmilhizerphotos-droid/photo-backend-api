// ===== DIAGNOSTIC =====
console.log("SERVER FILE LOADED");

// ---------------- IMPORTS ----------------
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import sharp from "sharp";

import { dbGet, dbAll } from "./db.js";
import { processAllFaces, isProcessing, getFaceStatus } from "./face-detector.js";

// ---------------- PATH SETUP ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------- FIREBASE INIT ----------------
console.log("Initializing Firebase");

const serviceAccountPath = path.join(__dirname, "firebase-service-account.json");
if (!fs.existsSync(serviceAccountPath)) {
  throw new Error("Missing firebase-service-account.json");
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log("Firebase initialized");

// ---------------- APP INIT ----------------
console.log("Creating Express app");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Clean JSON parse errors (prevents HTML error pages for bad JSON)
app.use((err, _req, res, next) => {
  const isJsonSyntaxError =
    err instanceof SyntaxError &&
    typeof err.message === "string" &&
    err.message.toLowerCase().includes("json");

  if (isJsonSyntaxError) {
    return res.status(400).json({ error: "invalid json" });
  }
  next(err);
});

// ---------------- ROOT ----------------
app.get("/", (_req, res) => {
  res.type("text/plain").send("OK");
});

// ---------------- HEALTH ----------------
app.get("/health", async (_req, res) => {
  try {
    await dbGet("SELECT 1");
    res.json({ status: "ok" });
  } catch (e) {
    console.error("Health check failed:", e);
    res.status(500).json({ error: "health check failed" });
  }
});

// =======================================================
// AUTH (OPTIONAL): verify Firebase ID token if present
// =======================================================

async function verifyFirebaseAuth(req, res, next) {
  try {
    const auth = req.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);

    // Optional auth: if no token, allow.
    // If you want to REQUIRE auth, uncomment:
    // if (!m) return res.status(401).json({ error: "missing authorization" });

    if (!m) return next();

    const token = m[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (_e) {
    return res.status(401).json({ error: "invalid token" });
  }
}

app.use("/api", verifyFirebaseAuth);

// =======================================================
// DB HELPERS (schema-safe)
// =======================================================

function safeTableName(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return null;
  return name;
}

async function tableExists(table) {
  const t = safeTableName(table);
  if (!t) return false;
  const row = await dbGet(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [t]
  );
  return !!row;
}

async function getTableColumns(table) {
  const t = safeTableName(table);
  if (!t) return [];
  const rows = await dbAll(`PRAGMA table_info(${t})`);
  return (rows || []).map((r) => r.name).filter(Boolean);
}

function pickColumns(existing, preferred) {
  const set = new Set(existing);
  const cols = preferred.filter((c) => set.has(c));
  return cols.length ? cols : [];
}

function getBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

function fileExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

// =======================================================
// API: ALBUMS (return ARRAY to satisfy frontend .map())
// =======================================================

app.get("/api/albums", async (_req, res) => {
  try {
    const exists = await tableExists("albums");
    if (!exists) return res.json([]); // safest for UI

    const cols = await getTableColumns("albums");
    const selected = pickColumns(cols, [
      "id",
      "name",
      "title",
      "slug",
      "cover_photo_id",
      "created_at",
      "updated_at",
      "photo_count",
    ]);

    const selectList = selected.length ? selected.join(", ") : "*";
    const albums = await dbAll(`SELECT ${selectList} FROM albums ORDER BY id DESC`);

    // FRONTEND expects an array
    res.json(albums || []);
  } catch (e) {
    console.error("GET /api/albums failed:", e);
    // Still return an array so sidebar doesn't crash
    res.json([]);
  }
});

// =======================================================
// API: PHOTOS LIST (adds image_url + thumbnail_url)
// =======================================================

app.get("/api/photos", async (req, res) => {
  try {
    const exists = await tableExists("photos");
    if (!exists) {
      return res.status(500).json({ error: "photos table not found" });
    }

    const offset = Math.max(0, parseInt(req.query.offset ?? "0", 10) || 0);
    const limitRaw = parseInt(req.query.limit ?? "50", 10) || 50;
    const limit = Math.min(Math.max(limitRaw, 1), 200);

    const cols = await getTableColumns("photos");
    const selected = pickColumns(cols, [
      "id",
      "album_id",
      "filename",
      "original_filename",
      "relative_path",
      "web_path",
      "full_path",
      "thumb_path",
      "thumbnail_path",
      "width",
      "height",
      "taken_at",
      "created_at",
      "updated_at",
      "mime_type",
      "filesize",
      "hash",
    ]);

    const selectList = selected.length ? selected.join(", ") : "*";

    const totalRow = await dbGet("SELECT COUNT(*) AS total FROM photos");
    const total = totalRow?.total ?? 0;

    const rows = await dbAll(
      `SELECT ${selectList} FROM photos ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const base = getBaseUrl(req);
    const photos = (rows || []).map((p) => {
      const id = p.id;
      return {
        ...p,
        image_url: `${base}/api/photos/${id}/file`,
        thumbnail_url: `${base}/api/photos/${id}/thumbnail`,
      };
    });

    res.json({ offset, limit, total, photos });
  } catch (e) {
    console.error("GET /api/photos failed:", e);
    res.status(500).json({ error: "failed to load photos" });
  }
});

// =======================================================
// API: SERVE IMAGE FILES
// =======================================================

async function getPhotoById(id) {
  const exists = await tableExists("photos");
  if (!exists) return null;

  const cols = await getTableColumns("photos");
  const selected = pickColumns(cols, [
    "id",
    "full_path",
    "thumbnail_path",
    "thumb_path",
    "filename",
    "mime_type",
  ]);
  const selectList = selected.length ? selected.join(", ") : "*";
  const row = await dbGet(`SELECT ${selectList} FROM photos WHERE id=?`, [id]);
  return row || null;
}

// GET /api/photos/:id/file
app.get("/api/photos/:id/file", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

    const photo = await getPhotoById(id);
    if (!photo) return res.status(404).json({ error: "not found" });

    const fullPath = photo.full_path;
    if (!fileExists(fullPath)) return res.status(404).json({ error: "file missing" });

    // Let Express handle range requests reasonably for images
    return res.sendFile(fullPath);
  } catch (e) {
    console.error("GET /api/photos/:id/file failed:", e);
    res.status(500).json({ error: "failed to serve file" });
  }
});

// GET /api/photos/:id/thumbnail
app.get("/api/photos/:id/thumbnail", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

    const photo = await getPhotoById(id);
    if (!photo) return res.status(404).json({ error: "not found" });

    const thumbPath = photo.thumbnail_path || photo.thumb_path;
    if (fileExists(thumbPath)) {
      return res.sendFile(thumbPath);
    }

    // On-demand thumbnail generation (cached)
    const fullPath = photo.full_path;
    if (!fileExists(fullPath)) return res.status(404).json({ error: "file missing" });

    const cacheDir = path.join(process.cwd(), "thumb-cache");
    fs.mkdirSync(cacheDir, { recursive: true });

    const cached = path.join(cacheDir, `${id}.jpg`);
    if (fileExists(cached)) {
      return res.sendFile(cached);
    }

    const buf = await sharp(fullPath)
      .rotate()
      .resize({ width: 512, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    fs.writeFileSync(cached, buf);
    res.setHeader("Content-Type", "image/jpeg");
    return res.send(buf);
  } catch (e) {
    console.error("GET /api/photos/:id/thumbnail failed:", e);
    res.status(500).json({ error: "failed to serve thumbnail" });
  }
});

// =======================================================
// API: PHOTO DETAIL EXTRAS EXPECTED BY FRONTEND
// =======================================================

// GET /api/photos/:id/faces
app.get("/api/photos/:id/faces", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

    const exists = await tableExists("faces");
    if (!exists) return res.json([]);

    const cols = await getTableColumns("faces");
    const selected = pickColumns(cols, [
      "id",
      "photo_id",
      "box_x",
      "box_y",
      "box_width",
      "box_height",
      "confidence",
    ]);
    const selectList = selected.length ? selected.join(", ") : "*";

    const faces = await dbAll(
      `SELECT ${selectList} FROM faces WHERE photo_id=? ORDER BY id ASC`,
      [id]
    );

    res.json(faces || []);
  } catch (e) {
    console.error("GET /api/photos/:id/faces failed:", e);
    res.json([]); // keep UI resilient
  }
});

// GET /api/photos/:id/people  (placeholder for now)
app.get("/api/photos/:id/people", async (_req, res) => {
  res.json([]);
});

// GET /api/photos/:id/tags (placeholder for now)
app.get("/api/photos/:id/tags", async (_req, res) => {
  res.json([]);
});

// =======================================================
// 🧠 FACE PROCESSING
// =======================================================

function isConfirmed(req) {
  const bodyVal = req.body?.confirm;
  const queryVal = req.query?.confirm;
  const headerVal = req.get("x-confirm");
  const truthy = new Set([true, 1, "1", "true", "yes", "y", "on"]);
  return truthy.has(bodyVal) || truthy.has(queryVal) || truthy.has(headerVal);
}

app.post("/api/faces/process", async (req, res) => {
  try {
    if (!isConfirmed(req)) {
      return res.status(400).json({ error: "confirm required" });
    }

    if (isProcessing()) {
      return res.status(409).json({ error: "already running" });
    }

    res.json({ started: true });

    processAllFaces().catch((err) => {
      console.error("Face job failed:", err);
    });
  } catch (err) {
    console.error("Process endpoint failed:", err);
    res.status(500).json({ error: "failed to start face processing" });
  }
});

app.get("/api/faces/status", async (_req, res) => {
  try {
    const status = await getFaceStatus();
    res.json(status);
  } catch (err) {
    console.error("Status endpoint failed:", err);
    res.status(500).json({ error: "failed to get face status" });
  }
});

// ---------------- START SERVER ----------------
console.log("About to listen on port", PORT);

app.listen(PORT, () => {
  console.log(`SERVER LISTENING ON http://127.0.0.1:${PORT}`);
});

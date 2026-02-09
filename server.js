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

// ---------------- PATH SETUP ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------- FIREBASE INIT ----------------
const serviceAccountPath = path.join(__dirname, "firebase-service-account.json");
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ---------------- APP INIT ----------------
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ---------------- HELPERS ----------------
async function tableExists(table) {
  const row = await dbGet(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [table]
  );
  return !!row;
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

// ---------------- HEALTH ----------------
app.get("/health", async (_req, res) => {
  try {
    await dbGet("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(500).json({ error: "health check failed" });
  }
});

// =======================================================
// ALBUMS
// =======================================================

app.get("/api/albums", async (_req, res) => {
  if (!(await tableExists("albums"))) return res.json([]);
  const rows = await dbAll(
    `SELECT id, name, photo_count AS photoCount FROM albums ORDER BY id DESC`
  );
  res.json(rows || []);
});

// =======================================================
// PHOTOS LIST
// =======================================================

app.get("/api/photos", async (req, res) => {
  if (!(await tableExists("photos"))) {
    return res.status(500).json({ error: "photos table missing" });
  }

  const offset = parseInt(req.query.offset || "0", 10);
  const limit = parseInt(req.query.limit || "50", 10);
  const base = getBaseUrl(req);

  const rows = await dbAll(
    `SELECT * FROM photos ORDER BY id DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  res.json({
    photos: (rows || []).map((p) => ({
      ...p,
      image_url: `${base}/api/photos/${p.id}/file`,
      thumbnail_url: `${base}/api/photos/${p.id}/thumbnail`,
    })),
  });
});

async function getPhotoById(id) {
  return dbGet(`SELECT * FROM photos WHERE id = ?`, [id]);
}

// =======================================================
// FILE STREAMING (FIXED)
// =======================================================

app.get("/api/photos/:id/file", async (req, res) => {
  const id = Number(req.params.id);
  const photo = await getPhotoById(id);
  if (!photo || !fileExists(photo.full_path)) {
    return res.status(404).end();
  }

  const stat = fs.statSync(photo.full_path);
  const fileSize = stat.size;
  const ext = path.extname(photo.full_path).toLowerCase();
  const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic" };
  const contentType = mimeTypes[ext] || "image/jpeg";
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
    });

    fs.createReadStream(photo.full_path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });

    fs.createReadStream(photo.full_path).pipe(res);
  }
});

app.get("/api/photos/:id/thumbnail", async (req, res) => {
  const id = Number(req.params.id);
  const photo = await getPhotoById(id);
  if (!photo || !fileExists(photo.full_path)) {
    return res.status(404).end();
  }

  const cacheDir = path.join(process.cwd(), "thumb-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${id}.jpg`);

  if (fileExists(cached)) {
    return res.sendFile(cached);
  }

  const buf = await sharp(photo.full_path)
    .rotate()
    .resize({ width: 512, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  fs.writeFileSync(cached, buf);
  res.setHeader("Content-Type", "image/jpeg");
  res.send(buf);
});

// =======================================================
// PEOPLE
// =======================================================

app.get("/api/people", async (req, res) => {
  if (!(await tableExists("people"))) return res.json([]);

  const base = getBaseUrl(req);
  const rows = await dbAll(
    `SELECT id, name, photo_count, thumbnail_photo_id FROM people ORDER BY photo_count DESC`
  );

  res.json(
    (rows || []).map((p) => ({
      id: p.id,
      name: p.name,
      photoCount: p.photo_count,
      thumbnailUrl: p.thumbnail_photo_id
        ? `${base}/api/photos/${p.thumbnail_photo_id}/thumbnail`
        : null,
    }))
  );
});

app.get("/api/people/:id/photos", async (req, res) => {
  const personId = Number(req.params.id);
  if (!Number.isFinite(personId)) return res.json([]);

  const base = getBaseUrl(req);
  const rows = await dbAll(
    `
    SELECT ph.*
    FROM photos ph
    JOIN photo_people pp ON pp.photo_id = ph.id
    WHERE pp.person_id = ?
    ORDER BY ph.id DESC
    `,
    [personId]
  );

  res.json(
    (rows || []).map((p) => ({
      ...p,
      image_url: `${base}/api/photos/${p.id}/file`,
      thumbnail_url: `${base}/api/photos/${p.id}/thumbnail`,
    }))
  );
});

app.get("/api/people/unidentified", async (_req, res) => {
  if (!(await tableExists("faces"))) {
    return res.json({ photoCount: 0, faceCount: 0 });
  }

  const row = await dbGet(`
    SELECT
      COUNT(DISTINCT f.photo_id) AS photoCount,
      COUNT(*) AS faceCount
    FROM faces f
    LEFT JOIN photo_people pp ON pp.photo_id = f.photo_id
    WHERE pp.photo_id IS NULL
  `);

  res.json({
    photoCount: row?.photoCount ?? 0,
    faceCount: row?.faceCount ?? 0,
  });
});

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`SERVER LISTENING ON http://127.0.0.1:${PORT}`);
});

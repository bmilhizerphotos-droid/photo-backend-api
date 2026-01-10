import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import db from "./db.js";

const app = express();
const PORT = 3000;

// --- 1. MANUAL HEADER INJECTION (The "Brute Force" Fix) ---
// This ensures headers are set even if the CORS package is bypassed.
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://photos.milhizerfamilyphotos.org',  // Production
    'http://localhost:5173',                    // Development frontend
    'http://127.0.0.1:5173'                     // Alternative localhost
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");

  // Immediately respond to the browser's "preflight" handshake
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// --- 2. STANDARD CORS MIDDLEWARE ---
// Allow localhost for development, production domain for production
const allowedOrigins = [
  'https://photos.milhizerfamilyphotos.org',  // Production
  'http://localhost:5173',                    // Development frontend
  'http://127.0.0.1:5173'                     // Alternative localhost
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.log(`❌ CORS blocked origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// Database is imported from db.js

// --- 4. API ROUTES ---

// ---------------- HEALTH CHECK ----------------
app.get("/health", async (req, res) => {
  try {
    await db.get("SELECT 1");
    res.json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Health check failed:", err);
    res.status(500).json({
      status: "error",
      message: "Database unreachable",
    });
  }
});

// List all photos
app.get("/api/photos", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);

    const rows = await db.all(
      "SELECT id, filename FROM photos LIMIT ? OFFSET ?",
      [limit, offset]
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        thumbnailUrl: `/thumbnails/${r.id}`,
        fullUrl: `/photos/${r.id}`,
      }))
    );
  } catch (err) {
    console.error("❌ DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------------- UTIL ----------------
function findFileRecursive(root, targetName) {
  const stack = [root];
  const targetLower = targetName.toLowerCase();

  while (stack.length > 0) {
    const dir = stack.pop();
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.name.toLowerCase() === targetLower) {
          return fullPath;
        }
      }
    } catch {
      // ignore permission errors
    }
  }
  return null;
}

// ---------------- THUMBNAILS ----------------
app.get("/thumbnails/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await db.get("SELECT filename FROM photos WHERE id = ?", [id]);
    if (!row) return res.sendStatus(404);

    const thumbName = `${row.filename}.thumb.jpg`;
    const filePath = findFileRecursive("G:/Photos", thumbName);
    if (!filePath) return res.sendStatus(404);

    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error("❌ Thumbnail error:", err);
    res.sendStatus(500);
  }
});

// ---------------- FULL PHOTOS ----------------
app.get("/photos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await db.get("SELECT filename FROM photos WHERE id = ?", [id]);
    if (!row) return res.sendStatus(404);

    const filePath = findFileRecursive("G:/Photos", row.filename);
    if (!filePath) return res.sendStatus(404);

    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error("❌ Photo error:", err);
    res.sendStatus(500);
  }
});

// ---------------- START ----------------
const server = app.listen(PORT, () => {
  console.log("=================================");
  console.log(`🚀 Backend running on http://127.0.0.1:${PORT}`);
  console.log(`📂 Photos root: G:/Photos`);
  console.log("=================================");
});

server.on("error", (err) => {
  console.error("❌ Server failed to start:", err.message);
  process.exit(1);
});

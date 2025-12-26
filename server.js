import express from "express";
import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import cors from "cors";

const app = express();
const PORT = 3000;

// --- 1. MANUAL HEADER INJECTION (The "Brute Force" Fix) ---
// This ensures headers are set even if the CORS package is bypassed.
app.use((req, res, next) => {
  // Explicitly allow your website domain
  res.header("Access-Control-Allow-Origin", "https://photos.milhizerfamilyphotos.org");
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
const corsOptions = {
  origin: 'https://photos.milhizerfamilyphotos.org',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// --- 3. DATABASE CONNECTION ---
const db = new sqlite3.Database("./photos.db", (err) => {
  if (err) {
    console.error("Error connecting to the database:", err.message);
  } else {
    console.log("Connected to the SQLite database.");
  }
});

// --- 4. API ROUTES ---

// List all photos
app.get("/api/photos", (req, res) => {
  const limit = Number(req.query.limit || 200);
  db.all(
    `SELECT id, filename FROM photos ORDER BY id DESC LIMIT ?`,
    [limit],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }
      const results = rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        thumbnailUrl: `/thumbnails/${r.id}`,
        fullUrl: `/photos/${r.id}`,
      }));
      res.json(results);
    }
  );
});

// Serve a thumbnail by ID
app.get("/thumbnails/:id", (req, res) => {
  const id = Number(req.params.id);
  db.get(
    `SELECT thumbnail_path FROM photos WHERE id = ?`,
    [id],
    (err, row) => {
      if (err || !row) return res.status(404).send("Thumbnail not found");
      const filePath = path.resolve(row.thumbnail_path);
      if (!fs.existsSync(filePath)) return res.status(404).send("File missing");
      res.sendFile(filePath);
    }
  );
});

// Serve a full photo by ID
app.get("/photos/:id", (req, res) => {
  const id = Number(req.params.id);
  db.get(
    `SELECT full_path FROM photos WHERE id = ?`,
    [id],
    (err, row) => {
      if (err || !row) return res.status(404).send("Photo not found");
      const filePath = path.resolve(row.full_path);
      if (!fs.existsSync(filePath)) return res.status(404).send("File missing");
      res.sendFile(filePath);
    }
  );
});

// --- 5. START SERVER ---
app.listen(PORT, () => {
  console.log(`Backend server active on port ${PORT}`);
  console.log(`Allowed Origin: https://photos.milhizerfamilyphotos.org`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close(() => {
    console.log('Database connection closed.');
    process.exit(0);
  });
});

import express from "express";
import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import cors from "cors";

const app = express();
const PORT = 3000;

// --- ROBUST SECURITY CONFIGURATION (CORS) ---
// This handles both the data request and the hidden "preflight" handshake.
const corsOptions = {
  origin: 'https://photos.milhizerfamilyphotos.org', // Exact domain, no trailing slash
  methods: ['GET', 'POST', 'OPTIONS'], // Explicitly allow preflight
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200 
};

// 1. Apply CORS to all routes
app.use(cors(corsOptions));

// 2. Explicitly handle PREFLIGHT (OPTIONS) requests
// This stops the "Origin not allowed" error before it starts.
app.options('*', cors(corsOptions)); 

app.use(express.json());

// --- DATABASE CONNECTION ---
const db = new sqlite3.Database("./photos.db", (err) => {
  if (err) {
    console.error("Error connecting to the database:", err.message);
  } else {
    console.log("Connected to the SQLite database.");
  }
});

// --- API ROUTES ---

// 1. List all photos
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

// 2. Serve a thumbnail by ID
app.get("/thumbnails/:id", (req, res) => {
  const id = Number(req.params.id);

  db.get(
    `SELECT thumbnail_path FROM photos WHERE id = ?`,
    [id],
    (err, row) => {
      if (err || !row) {
        return res.status(404).send("Thumbnail not found");
      }

      const filePath = path.resolve(row.thumbnail_path);
      if (!fs.existsSync(filePath)) {
        return res.status(404).send("Thumbnail file missing on disk");
      }

      res.sendFile(filePath);
    }
  );
});

// 3. Serve a full photo by ID
app.get("/photos/:id", (req, res) => {
  const id = Number(req.params.id);

  db.get(
    `SELECT full_path FROM photos WHERE id = ?`,
    [id],
    (err, row) => {
      if (err || !row) {
        return res.status(404).send("Photo not found");
      }

      const filePath = path.resolve(row.full_path);
      if (!fs.existsSync(filePath)) {
        return res.status(404).send("Full photo file missing on disk");
      }

      res.sendFile(filePath);
    }
  );
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`Backend server is active!`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`External Access: https://api.milhizerfamilyphotos.org`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});

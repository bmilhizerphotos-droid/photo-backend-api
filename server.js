import express from "express";
import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import cors from "cors"; // Essential for bridging your different domains

const app = express();
const PORT = 3000;

// --- SECURITY CONFIGURATION ---
// This explicitly tells the browser that your website is allowed to read data from this API.
const corsOptions = {
  origin: 'https://photos.milhizerfamilyphotos.org', // Your frontend URL
  optionsSuccessStatus: 200 // For legacy browser compatibility
};

app.use(cors(corsOptions)); 
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

// Graceful shutdown: Close DB connection when server stops
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});

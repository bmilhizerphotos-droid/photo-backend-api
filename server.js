import express from "express";
import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import cors from "cors"; // Added for cross-origin support

const app = express();
const PORT = 3000;

// Enable CORS so the Cloud Run app can access this local server
app.use(cors()); 

// DB
const db = new sqlite3.Database("./photos.db");

// JSON
app.use(express.json());

// -----------------------------
// API: List photos
// -----------------------------
app.get("/api/photos", (req, res) => {
  const limit = Number(req.query.limit || 200);

  db.all(
    `
    SELECT
      id,
      filename
    FROM photos
    ORDER BY id DESC
    LIMIT ?
    `,
    [limit],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "DB error" });
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

// -----------------------------
// Serve thumbnail BY ID
// -----------------------------
app.get("/thumbnails/:id", (req, res) => {
  const id = Number(req.params.id);

  db.get(
    `SELECT thumbnail_path FROM photos WHERE id = ?`,
    [id],
    (err, row) => {
      if (err || !row) {
        return res.status(404).send("Thumbnail not found");
      }

      const filePath = row.thumbnail_path;

      if (!fs.existsSync(filePath)) {
        console.error("Missing thumbnail:", filePath);
        return res.status(404).send("Thumbnail missing");
      }

      res.sendFile(path.resolve(filePath));
    }
  );
});

// -----------------------------
// Serve FULL image BY ID
// -----------------------------
app.get("/photos/:id", (req, res) => {
  const id = Number(req.params.id);

  db.get(
    `SELECT full_path FROM photos WHERE id = ?`,
    [id],
    (err, row) => {
      if (err || !row) {
        return res.status(404).send("Photo not found");
      }

      const filePath = row.full_path;

      if (!fs.existsSync(filePath)) {
        return res.status(404).send("Photo missing");
      }

      res.sendFile(path.resolve(filePath));
    }
  );
});

// -----------------------------
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

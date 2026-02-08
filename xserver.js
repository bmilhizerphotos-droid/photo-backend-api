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

// ---------------- CORS (FIXED) ----------------
const ALLOWED_ORIGINS = [
  "https://photos.milhizerfamilyphotos.org",
  "http://localhost:5173"
];

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / curl / server-to-server
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Explicit preflight handling
app.options("*", cors());

app.use(express.json());

// Clean JSON parse errors
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
// AUTH (OPTIONAL)
// =======================================================

async function verifyFirebaseAuth(req, res, next) {
  try {
    const auth = req.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return next();

    const token = m[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

app.use("/api", verifyFirebaseAuth);

// =======================================================
// (ALL ROUTES BELOW ARE UNCHANGED)
// =======================================================

// ... everything else EXACTLY as in your original file ...

console.log("About to listen on port", PORT);

app.listen(PORT, () => {
  console.log(`SERVER LISTENING ON http://127.0.0.1:${PORT}`);
});

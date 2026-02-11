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
import sqlite3 from "sqlite3";
import { open as openSqlite } from "sqlite";

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

async function columnExists(table, column) {
  const rows = await dbAll(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
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


const visionSearchCache = new Map();

function getVisionCacheKey(query) {
  return normalizeTerm(query);
}

function getCachedVisionResults(query) {
  const key = getVisionCacheKey(query);
  const entry = visionSearchCache.get(key);
  if (!entry) return null;

  // 5 minute TTL
  if (Date.now() - entry.ts > 5 * 60 * 1000) {
    visionSearchCache.delete(key);
    return null;
  }

  return entry.results;
}

function setCachedVisionResults(query, results) {
  const key = getVisionCacheKey(query);
  visionSearchCache.set(key, { ts: Date.now(), results });
}

async function imageToBase64Jpeg(filePath) {
  const buf = await sharp(filePath)
    .rotate()
    .resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 60 })
    .toBuffer();

  return buf.toString("base64");
}

async function scorePhotoWithVisionAI(query, photo) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const visionModel = process.env.SEARCH_VISION_MODEL || process.env.OLLAMA_VISION_MODEL || "llava:7b";

  const prompt = `You are scoring photo search relevance.
` +
    `User query: "${query}"
` +
    `Return ONLY a decimal number between 0 and 1 where 1 is perfect match and 0 is no match.`;

  const imageBase64 = await imageToBase64Jpeg(photo.full_path);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const resp = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        prompt,
        images: [imageBase64],
        stream: false,
        options: {
          temperature: 0,
          num_predict: 8,
        },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    const raw = String(data?.response || "");
    const match = raw.match(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/);
    if (!match) return null;

    const score = Number(match[1]);
    if (!Number.isFinite(score)) return null;

    return Math.max(0, Math.min(1, score));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function runVisionFallbackSearch(query) {
  const cached = getCachedVisionResults(query);
  if (cached) return cached;

  const visionEnabled = (process.env.SEARCH_VISION_ENABLED || "true").toLowerCase() !== "false";
  if (!visionEnabled) return [];

  const maxCandidates = Math.max(20, Number(process.env.SEARCH_VISION_CANDIDATES || 180));
  const terms = mergeTerms(query, []);
  const candidateIds = new Set();

  // Prefer semantically likely candidates first when label index exists
  if (await tableExists("photo_ai_labels")) {
    for (const term of terms.slice(0, 8)) {
      const rows = await dbAll(
        `
        SELECT photo_id
        FROM photo_ai_labels
        WHERE lower(label) LIKE ?
        ORDER BY confidence DESC
        LIMIT 120
        `,
        [`%${term}%`]
      );

      for (const row of rows || []) {
        candidateIds.add(Number(row.photo_id));
        if (candidateIds.size >= maxCandidates) break;
      }
      if (candidateIds.size >= maxCandidates) break;
    }
  }

  // Add filename-based candidates for broad textual hints
  if (candidateIds.size < maxCandidates) {
    for (const term of terms.slice(0, 8)) {
      const rows = await dbAll(
        `SELECT id FROM photos WHERE lower(filename) LIKE ? ORDER BY id DESC LIMIT 80`,
        [`%${term}%`]
      );

      for (const row of rows || []) {
        candidateIds.add(Number(row.id));
        if (candidateIds.size >= maxCandidates) break;
      }
      if (candidateIds.size >= maxCandidates) break;
    }
  }

  // Fill remainder with recent photos as a general fallback
  if (candidateIds.size < maxCandidates) {
    const remaining = maxCandidates - candidateIds.size;
    const recent = await dbAll(
      `SELECT id FROM photos WHERE full_path IS NOT NULL ORDER BY id DESC LIMIT ?`,
      [Math.max(remaining * 2, 80)]
    );

    for (const row of recent || []) {
      candidateIds.add(Number(row.id));
      if (candidateIds.size >= maxCandidates) break;
    }
  }

  if (!candidateIds.size) return [];

  const ids = [...candidateIds].slice(0, maxCandidates);
  const placeholders = ids.map(() => "?").join(",");
  const candidates = await dbAll(
    `SELECT id, filename, full_path FROM photos WHERE id IN (${placeholders}) ORDER BY id DESC`,
    ids
  );

  const results = [];
  for (const photo of candidates || []) {
    if (!fileExists(photo.full_path)) continue;

    const score = await scorePhotoWithVisionAI(query, photo);
    if (score === null) continue;
    if (score >= 0.58) {
      results.push({ id: photo.id, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 40);
  setCachedVisionResults(query, top);
  return top;
}

function tokenizeQuery(query) {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
  )];
}

function normalizeTerm(term) {
  return String(term || "").toLowerCase().trim();
}

function addTermVariants(terms) {
  const out = new Set();

  for (const raw of terms || []) {
    const t = normalizeTerm(raw);
    if (!t || t.length < 2) continue;
    out.add(t);

    // light singular/plural handling helps queries like dog <-> dogs
    if (t.endsWith("ies") && t.length > 3) out.add(`${t.slice(0, -3)}y`);
    if (t.endsWith("s") && t.length > 3) out.add(t.slice(0, -1));
    if (!t.endsWith("s")) out.add(`${t}s`);
  }

  return [...out].filter((t) => t.length >= 2 && t.length <= 32);
}

function mergeTerms(query, aiTerms = []) {
  const seed = [normalizeTerm(query), ...tokenizeQuery(query), ...(aiTerms || []).map(normalizeTerm)];
  return addTermVariants(seed);
}

function extractFirstJsonObject(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // continue to relaxed extraction
  }

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // continue
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function buildFtsMatchExpression(terms) {
  const expressions = [];

  for (const raw of terms || []) {
    const normalized = normalizeTerm(raw).replace(/"/g, " ").trim();
    if (!normalized || normalized.length < 2) continue;

    const words = normalized
      .split(/[^a-z0-9]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);

    if (!words.length) continue;

    // phrase match for multi-word terms
    if (words.length > 1) {
      expressions.push(`"${words.join(" ")}"`);
    }

    // token-level prefix matching to catch singular/plural and partial forms
    for (const word of words) {
      expressions.push(`"${word}"`);
      expressions.push(`${word}*`);
    }
  }

  return [...new Set(expressions)].join(" OR ");
}

async function expandSearchTermsWithAI(query) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const ollamaModel = process.env.SEARCH_AI_MODEL || process.env.OLLAMA_MODEL || "llama3.2";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);

  try {
    const prompt = `You expand natural language photo searches into concise terms.
Given: "${query}"

Return JSON only in this format:
{"terms":["term 1","term 2","term 3"]}

Rules:
- 3 to 8 short terms
- include direct objects, activities, places, mood, and event type when implied
- lowercase only
- no punctuation-heavy phrases`;

    const resp = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 120,
        },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) return [];

    const data = await resp.json();
    const raw = String(data?.response || "").trim();
    if (!raw) return [];

    const parsed = extractFirstJsonObject(raw);
    if (!Array.isArray(parsed?.terms)) return [];

    return [...new Set(parsed.terms
      .map((t) => String(t).toLowerCase().trim())
      .filter((t) => t.length >= 2 && t.length <= 32)
    )].slice(0, 8);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
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
// ALBUMS (SCHEMA-SAFE)
// =======================================================

app.get("/api/albums", async (_req, res) => {
  if (!(await tableExists("albums"))) return res.json([]);

  const hasPhotoCount = await columnExists("albums", "photo_count");

  const rows = hasPhotoCount
    ? await dbAll(
        `SELECT id, name, photo_count AS photoCount FROM albums ORDER BY id DESC`
      )
    : await dbAll(
        `SELECT id, name, NULL AS photoCount FROM albums ORDER BY id DESC`
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
// FILE STREAMING
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
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
  };
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
// SEARCH (READ-ONLY, ISOLATED)
// =======================================================

app.get("/api/search/index-status", async (_req, res) => {
  if (!(await tableExists("photos"))) {
    return res.json({ totalPhotos: 0, labeledPhotos: 0, coverage: 0 });
  }

  const total = await dbGet(`SELECT COUNT(*) AS c FROM photos`);

  if (!(await tableExists("photo_ai_labels"))) {
    return res.json({ totalPhotos: total?.c ?? 0, labeledPhotos: 0, coverage: 0 });
  }

  const labeled = await dbGet(`SELECT COUNT(DISTINCT photo_id) AS c FROM photo_ai_labels`);
  const totalPhotos = Number(total?.c || 0);
  const labeledPhotos = Number(labeled?.c || 0);
  const coverage = totalPhotos > 0 ? Number((labeledPhotos / totalPhotos).toFixed(4)) : 0;

  res.json({ totalPhotos, labeledPhotos, coverage });
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ photos: [] });

  const debug = req.query.debug === "1";
  const base = getBaseUrl(req);

  const scores = new Map();
  const sourceScores = new Map();
  const addScore = (id, weight, source) => {
    if (!Number.isFinite(Number(id))) return;
    const photoId = Number(id);
    const w = Number(weight) || 0;
    scores.set(photoId, (scores.get(photoId) || 0) + w);

    if (debug && source) {
      const prev = sourceScores.get(photoId) || {};
      prev[source] = (prev[source] || 0) + w;
      sourceScores.set(photoId, prev);
    }
  };

  const hasTags = (await tableExists("tags")) && (await tableExists("photo_tags"));
  const hasPeople = (await tableExists("people")) && (await tableExists("photo_people"));
  const hasAiLabels = await tableExists("photo_ai_labels");

  // 1) AI-assisted expansion for natural-language queries
  const aiTerms = await expandSearchTermsWithAI(q);
  const terms = mergeTerms(q, aiTerms);

  // 2) Existing FTS index (if available)
  const searchDbFile = path.join(process.cwd(), "photo-search.sqlite");
  let ftsMatched = 0;
  if (fileExists(searchDbFile)) {
    let searchDb = null;
    try {
      searchDb = await openSqlite({
        filename: searchDbFile,
        driver: sqlite3.Database,
      });

      const ftsExpr = buildFtsMatchExpression(terms.length ? terms : [q]);
      if (ftsExpr) {
        const matches = await searchDb.all(
          `
          SELECT photo_id
          FROM photo_search_fts
          WHERE photo_search_fts MATCH ?
          LIMIT 180
          `,
          [ftsExpr]
        );

        for (const row of matches || []) addScore(row.photo_id, 10, "fts");
        ftsMatched = (matches || []).length;
      }
    } catch {
      // Ignore FTS failures and continue with metadata + AI search
    } finally {
      if (searchDb) {
        try {
          await searchDb.close();
        } catch {
          // ignore close errors
        }
      }
    }
  }

  // 3) Match tags (best signal for semantic search)
  if (hasTags) {
    for (const term of terms) {
      const rows = await dbAll(
        `
        SELECT pt.photo_id AS photo_id
        FROM photo_tags pt
        JOIN tags t ON t.id = pt.tag_id
        WHERE lower(t.name) LIKE ?
        LIMIT 250
        `,
        [`%${term}%`]
      );

      for (const row of rows || []) addScore(row.photo_id, 6, "tags");
    }
  }

  // 4) Match recognized people names
  if (hasPeople) {
    for (const term of terms) {
      const rows = await dbAll(
        `
        SELECT pp.photo_id AS photo_id
        FROM photo_people pp
        JOIN people pe ON pe.id = pp.person_id
        WHERE lower(pe.name) LIKE ?
        LIMIT 250
        `,
        [`%${term}%`]
      );

      for (const row of rows || []) addScore(row.photo_id, 5, "people");
    }
  }

  // 5) Match pre-indexed AI labels (vision-generated)
  if (hasAiLabels) {
    for (const term of terms) {
      const rows = await dbAll(
        `
        SELECT photo_id, confidence
        FROM photo_ai_labels
        WHERE lower(label) LIKE ?
        ORDER BY confidence DESC
        LIMIT 300
        `,
        [`%${term}%`]
      );

      for (const row of rows || []) {
        const confidence = Number(row.confidence);
        const boost = Number.isFinite(confidence)
          ? 6 + Math.round(Math.max(0, Math.min(1, confidence)) * 4)
          : 8;
        addScore(row.photo_id, boost, "ai_labels");
      }
    }
  }

  // 6) Filename fallback so plain text still works
  for (const term of terms) {
    const rows = await dbAll(
      `SELECT id FROM photos WHERE lower(filename) LIKE ? LIMIT 250`,
      [`%${term}%`]
    );

    for (const row of rows || []) addScore(row.id, 2, "filename");
  }

  // 7) True AI visual fallback: inspect recent images with vision model
  const visionBlendEnabled = (process.env.SEARCH_VISION_BLEND || "true").toLowerCase() !== "false";
  const visionStrongScoreThreshold = Number(process.env.SEARCH_VISION_STRONG_SCORE || 12);
  const visionMinResultsForSkip = Number(process.env.SEARCH_VISION_MIN_RESULTS || 6);

  const currentTopScore = scores.size > 0 ? Math.max(...scores.values()) : 0;
  const shouldUseVision = visionBlendEnabled && (
    scores.size === 0 ||
    scores.size < visionMinResultsForSkip ||
    currentTopScore < visionStrongScoreThreshold
  );

  let visionFallbackCount = 0;
  if (shouldUseVision) {
    const visionMatches = await runVisionFallbackSearch(q);
    for (const m of visionMatches) {
      // blend with existing scores instead of only all-or-nothing fallback
      const visionBoost = 8 + Math.round(m.score * 8);
      addScore(m.id, visionBoost, "vision_fallback");
    }
    visionFallbackCount = visionMatches.length;
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0] - a[0];
    })
    .slice(0, 100);

  const ids = ranked.map(([id]) => id);

  if (!ids.length) return res.json({ photos: [] });

  const placeholders = ids.map(() => "?").join(",");
  const photos = await dbAll(`SELECT * FROM photos WHERE id IN (${placeholders})`, ids);
  const byId = new Map((photos || []).map((p) => [p.id, p]));

  const responsePhotos = ids.map((id) => byId.get(id)).filter(Boolean).map((p) => {
    const score = scores.get(p.id) || 0;
    const payload = {
      ...p,
      image_url: `${base}/api/photos/${p.id}/file`,
      thumbnail_url: `${base}/api/photos/${p.id}/thumbnail`,
      search_score: score,
    };

    if (debug) {
      payload.search_sources = sourceScores.get(p.id) || {};
    }

    return payload;
  });

  const result = { photos: responsePhotos };

  if (debug) {
    result.debug = {
      query: q,
      terms,
      aiTerms,
      tableSupport: { hasTags, hasPeople, hasAiLabels },
      matched: {
        total: responsePhotos.length,
        ftsMatched,
        visionFallbackCount,
      },
      thresholds: {
        visionStrongScoreThreshold,
        visionMinResultsForSkip,
      },
      runtime: {
        currentTopScore,
        shouldUseVision,
      },
    };
  }

  res.json(result);
});

// =======================================================
// PEOPLE
// =======================================================

app.get("/api/people", async (req, res) => {
  if (!(await tableExists("people"))) return res.json([]);

  const base = getBaseUrl(req);

  const rows = await dbAll(
    `SELECT id, name, thumbnail_photo_id, photo_count FROM people ORDER BY photo_count DESC`
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

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`SERVER LISTENING ON http://127.0.0.1:${PORT}`);
});

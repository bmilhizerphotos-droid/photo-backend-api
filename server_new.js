import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Persistent semantic service URL
const SEMANTIC_URL = process.env.SEMANTIC_URL || 'http://127.0.0.1:8000';

app.use(cors());
app.use(express.json());

function parseIntOrDefault(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function groupPhotosWithPeople(photoRows, peopleRows) {
  const peopleMap = new Map();

  for (const r of peopleRows) {
    if (!peopleMap.has(r.photo_id)) peopleMap.set(r.photo_id, []);
    if (r.person_name) peopleMap.get(r.photo_id).push(r.person_name);
  }

  return photoRows.map((p) => ({
    id: p.id,
    filename: p.filename,
    created_at: p.created_at,
    thumbnail_url: `/api/photos/${p.id}/thumbnail`,
    image_url: `/api/photos/${p.id}/file`,
    people: peopleMap.get(p.id) || []
  }));
}

async function fetchPeopleForPhotoIds(photoIds) {
  if (!photoIds || photoIds.length === 0) return [];

  const placeholders = photoIds.map(() => '?').join(',');
  return db.all(
    `
    SELECT
      pp.photo_id AS photo_id,
      pe.name AS person_name
    FROM photo_people pp
    JOIN people pe ON pe.id = pp.person_id
    WHERE pp.photo_id IN (${placeholders})
    `,
    photoIds
  );
}

async function searchPhotosWithFTS(q, limit, offset) {
  return db.all(
    `
    SELECT
      p.id,
      p.filename,
      p.created_at,
      p.thumbnail_path,
      p.full_path
    FROM photo_search_fts
    JOIN photos p ON p.id = photo_search_fts.rowid
    WHERE photo_search_fts MATCH ?
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
    `,
    [q, limit, offset]
  );
}

// NEW: Call persistent semantic service
async function runSemanticSearch({ query, limit }) {
  const url = new URL(`${SEMANTIC_URL}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('k', String(limit));

  const response = await fetch(url.toString(), {
    method: 'GET'
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Semantic service error: ${response.status} ${text}`);
  }

  return response.json();
}

app.get('/api/ai/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const offset = parseIntOrDefault(req.query.offset, 0);
    const limit = parseIntOrDefault(req.query.limit, 50);

    if (!q) {
      return res.json({ query: q, mode: 'empty', photos: [] });
    }

    // 1️⃣ FTS
    const ftsRows = await searchPhotosWithFTS(q, limit, offset);

    const combinedIds = new Set(ftsRows.map(r => r.id));
    const combinedRows = [...ftsRows];

    // 2️⃣ Semantic
    const semanticNeed = Math.max(limit - combinedRows.length, 0);

    if (semanticNeed > 0) {
      try {
        const semanticPayload = await runSemanticSearch({
          query: q,
          limit: Math.max(limit, 50)
        });

        const semanticIds = semanticPayload.results
          .map(r => r.photo_id)
          .filter(id => !combinedIds.has(id));

        if (semanticIds.length > 0) {
          const placeholders = semanticIds.map(() => '?').join(',');
          const semanticRows = await db.all(
            `
            SELECT
              p.id,
              p.filename,
              p.created_at,
              p.thumbnail_path,
              p.full_path
            FROM photos p
            WHERE p.id IN (${placeholders})
            `,
            semanticIds
          );

          const rowById = new Map(semanticRows.map(r => [r.id, r]));

          for (const sid of semanticIds) {
            const row = rowById.get(sid);
            if (row) {
              combinedIds.add(row.id);
              combinedRows.push(row);
            }
          }
        }
      } catch (e) {
        console.warn('Semantic service failed:', e.message);
      }
    }

    // 3️⃣ People join
    const photoIds = combinedRows.map(r => r.id);
    const peopleRows = await fetchPeopleForPhotoIds(photoIds);
    const photos = groupPhotosWithPeople(combinedRows, peopleRows);

    const mode =
      ftsRows.length > 0 && photos.length > ftsRows.length
        ? 'hybrid'
        : ftsRows.length > 0
        ? 'fts'
        : 'semantic';

    res.json({
      query: q,
      mode,
      count: photos.length,
      photos
    });

  } catch (error) {
    console.error('AI search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

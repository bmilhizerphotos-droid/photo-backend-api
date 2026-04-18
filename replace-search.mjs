import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('server.js', 'utf8');
const lines = content.split('\n');

// Verify boundaries
console.log('Line 540:', lines[539].substring(0, 60));
console.log('Line 716:', lines[715].substring(0, 60));
console.log('Total lines:', lines.length);

const newBlock = `// ---------------- SEARCH ----------------
const SEMANTIC_URL = process.env.SEMANTIC_URL || 'http://127.0.0.1:8000';

function parseIntOrDefault(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

// ---- Gemini query expansion ----
async function expandQueryWithGemini(query) {
  if (!GEMINI_API_KEY) return null;
  const prompt = [
    'You are a search assistant for a family photo library. Analyze this search query and return useful search signals as JSON.',
    '',
    'Query: "' + query + '"',
    '',
    'Return ONLY valid JSON (no markdown) with:',
    '- "concepts": 4-10 individual words/short phrases describing photo content (objects, scenes, activities, people types). Include synonyms and related words.',
    '- "personName": a specific person\'s first or full name if the query is searching for someone (null otherwise)',
    '- "dateRange": if a specific time period is implied, { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } (null otherwise)',
    '- "tagTerms": 3-6 exact words likely to appear as object-detection tags (single nouns)',
    '',
    'Examples:',
    '- "birthday party" -> {"concepts":["birthday","party","cake","candles","celebration","balloons","gifts"],"personName":null,"dateRange":null,"tagTerms":["birthday","cake","baby","child"]}',
    '- "Christmas 2019" -> {"concepts":["christmas","tree","gifts","holiday","decorations","santa"],"personName":null,"dateRange":{"start":"2019-12-01","end":"2019-12-31"},"tagTerms":["christmas","tree"]}',
    '- "photos of Haley" -> {"concepts":["person","portrait","family"],"personName":"Haley","dateRange":null,"tagTerms":["woman","girl"]}',
    '- "haley beach" -> {"concepts":["beach","ocean","sand","water","waves","vacation","swimming","summer"],"personName":"Haley","dateRange":null,"tagTerms":["beach","water","swimsuit","woman"]}',
    '- "beach vacation" -> {"concepts":["beach","ocean","sand","water","waves","vacation","swimming","summer"],"personName":null,"dateRange":null,"tagTerms":["beach","water"]}',
  ].join('\\n');

  try {
    const resp = await fetch(
      \`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=\${GEMINI_API_KEY}\`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
        }),
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const match = text.match(/\\{[\\s\\S]*\\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn('Gemini query expansion failed:', e.message);
    return null;
  }
}

// ---- Parse date from raw query text ----
function parseDateFromQuery(query) {
  const q = query.toLowerCase();
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const monthShort  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  for (let i = 0; i < monthNames.length; i++) {
    const re = new RegExp('\\\\b(' + monthNames[i] + '|' + monthShort[i] + ')\\\\s+(\\\\d{4})\\\\b');
    const m = q.match(re);
    if (m) {
      const year = parseInt(m[2], 10);
      const month = i + 1;
      const days = new Date(year, month, 0).getDate();
      return { start: year + '-' + String(month).padStart(2,'0') + '-01', end: year + '-' + String(month).padStart(2,'0') + '-' + days };
    }
  }
  const yearMatch = q.match(/\\b(19|20)\\d{2}\\b/);
  if (yearMatch) {
    const y = yearMatch[0];
    return { start: y + '-01-01', end: y + '-12-31' };
  }
  return null;
}

// ---- Search sources ----
async function searchFTS(terms, limit) {
  if (!terms || terms.length === 0) return [];
  const sanitized = [...new Set(terms.map(t => t.replace(/["*]/g, '').trim()).filter(t => t.length > 1))];
  if (!sanitized.length) return [];
  const ftsQuery = sanitized.map(t => '"' + t + '"').join(' OR ');
  try {
    return await dbAll(
      \`SELECT p.id, p.filename, p.created_at, p.date_taken, p.thumbnail_path, p.full_path
       FROM photo_search_fts f
       JOIN photos p ON p.id = f.rowid
       WHERE f MATCH ?
       ORDER BY rank
       LIMIT ?\`,
      [ftsQuery, limit]
    );
  } catch (e) {
    console.warn('FTS error:', e.message);
    return [];
  }
}

async function searchByPerson(nameTerm, limit) {
  if (!nameTerm) return [];
  return dbAll(
    \`SELECT DISTINCT p.id, p.filename, p.created_at, p.date_taken, p.thumbnail_path, p.full_path
     FROM photo_people pp
     JOIN people pe ON pe.id = pp.person_id
     JOIN photos p ON p.id = pp.photo_id
     WHERE pe.name LIKE ? AND p.is_deleted = 0
     ORDER BY COALESCE(p.date_taken, p.created_at) DESC
     LIMIT ?\`,
    ['%' + nameTerm + '%', limit]
  );
}

async function searchByTags(terms, limit) {
  if (!terms || terms.length === 0) return [];
  const placeholders = terms.map(() => '?').join(',');
  return dbAll(
    \`SELECT DISTINCT p.id, p.filename, p.created_at, p.date_taken, p.thumbnail_path, p.full_path
     FROM photo_tags pt
     JOIN tags t ON t.id = pt.tag_id
     JOIN photos p ON p.id = pt.photo_id
     WHERE t.name IN (\${placeholders}) AND p.is_deleted = 0
     ORDER BY COALESCE(p.date_taken, p.created_at) DESC
     LIMIT ?\`,
    [...terms, limit]
  );
}

async function searchByDateRange(dateRange, limit) {
  if (!dateRange) return [];
  return dbAll(
    \`SELECT id, filename, created_at, date_taken, thumbnail_path, full_path
     FROM photos
     WHERE date_taken BETWEEN ? AND ? AND is_deleted = 0
     ORDER BY date_taken DESC
     LIMIT ?\`,
    [dateRange.start, dateRange.end, limit]
  );
}

async function runSemanticSearch(query, limit) {
  const url = new URL(\`\${SEMANTIC_URL}/search\`);
  url.searchParams.set('q', query);
  url.searchParams.set('k', String(limit));
  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) throw new Error('Semantic ' + resp.status);
  return resp.json();
}

async function fetchPeopleForPhotoIds(photoIds) {
  if (!photoIds || photoIds.length === 0) return [];
  const placeholders = photoIds.map(() => '?').join(',');
  return dbAll(
    \`SELECT pp.photo_id, pe.name AS person_name
     FROM photo_people pp
     JOIN people pe ON pe.id = pp.person_id
     WHERE pp.photo_id IN (\${placeholders})\`,
    photoIds
  );
}

function buildPhotoResponse(rows, peopleRows, base) {
  const peopleMap = new Map();
  for (const r of peopleRows) {
    if (!peopleMap.has(r.photo_id)) peopleMap.set(r.photo_id, []);
    if (r.person_name) peopleMap.get(r.photo_id).push(r.person_name);
  }
  return rows.map(p => ({
    id: p.id,
    filename: p.filename,
    created_at: p.created_at,
    dateTaken: p.date_taken ?? null,
    thumbnail_url: \`\${base}/thumbnails/\${p.id}\`,
    image_url: \`\${base}/display/\${p.id}\`,
    people: peopleMap.get(p.id) || []
  }));
}

function mergeResults(sources, limit) {
  const seen = new Set();
  const out = [];
  for (const rows of sources) {
    for (const row of (rows || [])) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        out.push(row);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

app.get("/api/search", authenticateToken, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(200, parseIntOrDefault(req.query.limit, 100));
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const base = \`\${protocol}://\${host}\`;

    if (!q) return res.json({ query: q, mode: 'empty', photos: [], meta: {} });

    // Gemini expansion and local date parsing in parallel
    const [gemini, localDateRange] = await Promise.all([
      expandQueryWithGemini(q),
      Promise.resolve(parseDateFromQuery(q))
    ]);

    const concepts   = gemini?.concepts?.length ? gemini.concepts  : [q];
    const tagTerms   = gemini?.tagTerms?.length ? gemini.tagTerms  : concepts.slice(0, 4);
    const personName = gemini?.personName        || null;
    const dateRange  = gemini?.dateRange         || localDateRange;
    const allTerms   = [...new Set([q, ...concepts])];

    // All sources in parallel
    const [ftsRows, personRows, tagRows, dateRows] = await Promise.all([
      searchFTS(allTerms, limit),
      personName ? searchByPerson(personName, limit) : Promise.resolve([]),
      searchByTags(tagTerms, limit),
      dateRange  ? searchByDateRange(dateRange, limit) : Promise.resolve([])
    ]);

    // Semantic search — optional
    let semanticRows = [];
    try {
      const payload = await runSemanticSearch(q, limit);
      const ids = (payload.results || []).map(r => r.photo_id);
      if (ids.length > 0) {
        const ph = ids.map(() => '?').join(',');
        const rows = await dbAll(\`SELECT id, filename, created_at, date_taken FROM photos WHERE id IN (\${ph}) AND is_deleted = 0\`, ids);
        const byId = new Map(rows.map(r => [r.id, r]));
        semanticRows = ids.map(id => byId.get(id)).filter(Boolean);
      }
    } catch { /* optional */ }

    // Merge: person > date > fts > tags > semantic
    const combined = mergeResults([personRows, dateRows, ftsRows, tagRows, semanticRows], limit);
    const peopleRows = await fetchPeopleForPhotoIds(combined.map(r => r.id));
    const photos = buildPhotoResponse(combined, peopleRows, base);

    const sources = [];
    if (personRows.length > 0)    sources.push('person');
    if (dateRows.length > 0)      sources.push('date');
    if (ftsRows.length > 0)       sources.push('fts');
    if (tagRows.length > 0)       sources.push('tags');
    if (semanticRows.length > 0)  sources.push('semantic');

    res.json({
      query: q,
      mode: sources.join('+') || 'no-results',
      count: photos.length,
      photos,
      meta: { personName, dateRange, concepts, sources: { person: personRows.length, date: dateRows.length, fts: ftsRows.length, tags: tagRows.length, semantic: semanticRows.length } }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

const before = lines.slice(0, 539).join('\n');
const after  = lines.slice(716).join('\n');
const result = before + '\n' + newBlock + '\n' + after;

writeFileSync('server.js', result, 'utf8');
console.log('Done. New line count:', result.split('\n').length);

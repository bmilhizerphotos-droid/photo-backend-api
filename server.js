import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use('/thumbnails', express.static(path.join(__dirname, 'thumbnails')));

// API Routes
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    const photos = await db.all(
      `SELECT id, filename, thumbnail_url, image_url FROM photos 
       WHERE filename LIKE ? OR full_path LIKE ? 
       ORDER BY created_at DESC`,
      [`%${q}%`, `%${q}%`]
    );
    
    res.json({ photos });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add missing people route
app.get('/api/people', async (req, res) => {
  try {
    const people = await db.all(`
      SELECT p.id, p.name, COUNT(f.photo_id) as photo_count, 
             (SELECT thumbnail_url FROM photos WHERE id = (
               SELECT photo_id FROM faces WHERE person_id = p.id LIMIT 1
             )) as thumbnail_url
      FROM people p
      LEFT JOIN faces f ON p.id = f.person_id
      GROUP BY p.id, p.name
      ORDER BY p.name
    `);
    
    res.json(people);
  } catch (error) {
    console.error('People error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add missing people/unidentified route
app.get('/api/people/unidentified', async (req, res) => {
  try {
    const photoCount = await db.get(`
      SELECT COUNT(*) as count FROM photos 
      WHERE id NOT IN (SELECT DISTINCT photo_id FROM faces)
    `);
    
    const faceCount = await db.get(`
      SELECT COUNT(*) as count FROM faces 
      WHERE person_id IS NULL
    `);
    
    res.json({
      photoCount: photoCount.count,
      faceCount: faceCount.count
    });
  } catch (error) {
    console.error('Unidentified error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add photos route if missing
app.get('/api/photos', async (req, res) => {
  try {
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 50;
    
    const photos = await db.all(`
      SELECT id, filename, thumbnail_url, image_url, created_at 
      FROM photos 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, [limit, offset]);
    
    res.json({ photos });
  } catch (error) {
    console.error('Photos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add photo thumbnail route if missing
app.get('/api/photos/:id/thumbnail', async (req, res) => {
  try {
    const { id } = req.params;
    const photo = await db.get('SELECT thumbnail_path FROM photos WHERE id = ?', [id]);
    
    if (!photo || !photo.thumbnail_path) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }
    
    res.sendFile(path.resolve(photo.thumbnail_path));
  } catch (error) {
    console.error('Thumbnail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add people photos route if missing
app.get('/api/people/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    const photos = await db.all(`
      SELECT p.id, p.filename, p.thumbnail_url, p.image_url 
      FROM photos p
      JOIN faces f ON p.id = f.photo_id
      WHERE f.person_id = ?
      ORDER BY p.created_at DESC
    `, [id]);
    
    res.json({ photos });
  } catch (error) {
    console.error('People photos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

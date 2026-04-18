-- Stores AI-generated captions and keywords per photo
CREATE TABLE IF NOT EXISTS photo_captions (
  photo_id INTEGER PRIMARY KEY,
  caption TEXT,
  keywords TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

-- Full-text search index for photo captions + keywords
CREATE VIRTUAL TABLE IF NOT EXISTS photo_search_fts
USING fts5(
  caption,
  keywords,
  content='photo_captions',
  content_rowid='photo_id'
);

-- Stores whole-image embeddings for visual similarity search
CREATE TABLE IF NOT EXISTS photo_image_embeddings (
  photo_id INTEGER PRIMARY KEY,
  embedding BLOB NOT NULL,
  model TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

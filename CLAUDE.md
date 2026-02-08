# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Family photo gallery app with a Node.js/Express backend API, React/TypeScript frontend, and SQLite database. Photos are stored on the local filesystem and indexed into SQLite. The app includes face detection (TensorFlow.js), duplicate/burst detection, and AI narrative generation (Google Gemini).

## Development Commands

```bash
# Install dependencies (both backend and frontend)
npm install
cd frontend && npm install && cd ..

# Run backend server (port 3001)
npm run server

# Run frontend dev server (port 5173, proxies /api to backend)
npm run dev:frontend

# Run both together (Windows - opens separate cmd windows)
npm run dev:all

# Background processing scripts
npm run scan-faces              # Full face detection scan
npm run scan-faces:test         # Test with 10 photos, verbose
npm run scan-duplicates         # Full duplicate/burst scan
npm run scan-duplicates:test    # Test with 100 photos, dry-run
npm run populate-paths          # Index photo file paths
npm run populate-paths:test     # Test with 10 photos, dry-run

# Frontend build
npm run build                   # Production build (Vite)

# PM2 process management
pm2 start ecosystem.config.cjs  # Start both services
```

There are no test suites configured. The `:test` script variants run the processing scripts with limited scope and dry-run flags for manual verification.

## Architecture

**Monorepo layout:** Backend at root, frontend in `frontend/`, mobile app in `mobile/` (Expo/React Native).

**Backend (`server.js`, `db.js`):** ES modules (`"type": "module"`). Express REST API serving photos from `PHOTO_ROOT` directory. SQLite database (`photo-db.sqlite`) with async `sqlite` package. Server dynamically selects available columns from the database to stay resilient to schema changes.

**Frontend (`frontend/`):** React 18 + TypeScript + Vite + Tailwind CSS. State managed via React hooks (no external state library). Vite dev server proxies `/api`, `/thumbnails`, `/photos`, `/display` to `http://127.0.0.1:3001`. IPv4 is forced in Vite config to avoid Windows localhost resolution issues.

**Authentication:** Firebase Auth with optional ID token verification. Backend uses `firebase-admin` with a service account file (`firebase-service-account.json`, gitignored). Frontend uses Firebase client SDK.

**Image pipeline:** Thumbnails generated on-demand via Sharp (500x512 JPEG, auto-rotated) and cached in `thumb-cache/`. Full-size images served from `PHOTO_ROOT`.

**ML/AI modules:**
- `face-detector.js` - TensorFlow.js + Face API (SSD MobileNet v1). Models in `faceapi-models/`. Stores 128-float face embeddings and normalized bounding boxes.
- `duplicate-detector.js` - SHA256 hashing for exact duplicates, 2-second time window + same resolution for burst grouping.
- `gemini-narrative.js` - Google Gemini 2.0 Flash for generating memory titles/narratives with retry logic.

**Deployment:** GitHub Actions builds frontend and deploys to Firebase Hosting. Backend can run standalone or via PM2 (`ecosystem.config.cjs`).

## Key Environment Variables

Set in `.env` (copy from `.env.example`):
- `PORT` - Backend port (default: 3001)
- `PHOTO_ROOT` - Filesystem path to photo directory (default: `G:/Photos`)
- `GEMINI_API_KEY` - For AI narrative generation
- `NODE_ENV` - `development` or `production`

## API Pattern

All API endpoints are under `/api/`. Key routes:
- `GET /api/photos?offset=&limit=` - Paginated photo list
- `GET /api/photos/:id/file` - Full-size image
- `GET /api/photos/:id/thumbnail` - Thumbnail (generated on demand)
- `GET /api/photos/:id/faces` - Face detection results
- `POST /api/faces/process` - Start async face detection job
- `GET /api/faces/status` - Job progress

## Database

SQLite with tables including `photos`, `faces`, `face_jobs`, and FTS5 virtual tables. Schema is initialized in `db.js` and extended by individual modules. Face bounding box coordinates are stored as normalized floats (0-1 range).

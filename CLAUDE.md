# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Family photo gallery app with a Node.js/Express backend API, React/TypeScript frontend, and SQLite database. Photos are stored on the local filesystem and indexed into SQLite. The app includes face detection (TensorFlow.js), duplicate/burst detection, and AI narrative generation (Google Gemini).

## Development & Deployment Commands

```bash
# Install dependencies (both backend and frontend)
npm install
cd frontend && npm install && cd ..

# Run backend server (port 3001)
npm run server

# Run frontend dev server (port 5173, proxies /api to backend)
npm run dev:frontend

# Background processing scripts
npm run scan-faces              # Full face detection scan
npm run scan-duplicates         # Full duplicate/burst scan

# PRODUCTION DEPLOYMENT PROTOCOL (Run after every change)
cd frontend && npm run build
git add . && git commit -m "auto-update" && git push origin main
pm2 restart photo-backend photo-frontend
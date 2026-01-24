// Validation script for high-priority fixes
// Run with: node validate-fixes.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHECKS = {
  passed: [],
  failed: [],
  warnings: []
};

function pass(message) {
  CHECKS.passed.push(message);
  console.log('✅', message);
}

function fail(message) {
  CHECKS.failed.push(message);
  console.error('❌', message);
}

function warn(message) {
  CHECKS.warnings.push(message);
  console.warn('⚠️', message);
}

console.log('\n🔍 Validating High-Priority Fixes...\n');

// Check 1: Database schema has path columns
console.log('Check 1: Database Schema');
const dbContent = fs.readFileSync('db.js', 'utf8');
if (dbContent.includes('full_path TEXT') && dbContent.includes('thumbnail_path TEXT')) {
  pass('Database schema includes path columns');
} else {
  fail('Database schema missing path columns');
}

// Check 2: Database has indexes
if (dbContent.includes('idx_photos_favorite') && 
    dbContent.includes('idx_photos_filename') &&
    dbContent.includes('idx_photo_albums_photo')) {
  pass('Database indexes created');
} else {
  fail('Database indexes missing');
}

// Check 3: server.js uses dbGet/dbRun consistently
console.log('\nCheck 2: Bulk Operations Fix');
const serverContent = fs.readFileSync('server.js', 'utf8');
const dbGetMatches = (serverContent.match(/await db\.get\(/g) || []).length;
const dbRunMatches = (serverContent.match(/await db\.run\(/g) || []).length;

if (dbGetMatches === 0 && dbRunMatches === 0) {
  pass('All db calls use dbGet/dbRun (no raw db.get/db.run)');
} else {
  fail(`Found ${dbGetMatches} db.get() and ${dbRunMatches} db.run() - should be 0`);
}

// Check 4: Port standardized to 3001
console.log('\nCheck 3: Port Standardization');
if (serverContent.includes('const PORT = 3001')) {
  pass('Server uses port 3001');
} else {
  fail('Server not using port 3001');
}

const watchdogContent = fs.readFileSync('ops/watchdog.ps1', 'utf8');
if (watchdogContent.includes('http://127.0.0.1:3001/health')) {
  pass('Watchdog monitors port 3001');
} else {
  fail('Watchdog not monitoring port 3001');
}

const restartContent = fs.readFileSync('ops/restart-everything.ps1', 'utf8');
if (restartContent.includes('$BackendPort  = 3001')) {
  pass('Restart script uses port 3001');
} else {
  fail('Restart script not using port 3001');
}

// Check 5: Firebase Admin authentication
console.log('\nCheck 4: Backend Authentication');
if (serverContent.includes('import admin from "firebase-admin"')) {
  pass('Firebase Admin imported');
} else {
  fail('Firebase Admin not imported');
}

if (serverContent.includes('async function authenticateToken')) {
  pass('Authentication middleware defined');
} else {
  fail('Authentication middleware missing');
}

const protectedEndpoints = [
  '/api/photos", authenticateToken',
  '/thumbnails/:id", authenticateToken',
  '/display/:id", authenticateToken',
  '/photos/:id", authenticateToken',
  '/api/photos/bulk", authenticateToken'
];

let protectedCount = 0;
for (const endpoint of protectedEndpoints) {
  if (serverContent.includes(endpoint)) {
    protectedCount++;
  }
}

if (protectedCount === protectedEndpoints.length) {
  pass(`All ${protectedCount} endpoints protected`);
} else {
  fail(`Only ${protectedCount}/${protectedEndpoints.length} endpoints protected`);
}

// Check 6: Frontend sends auth tokens
console.log('\nCheck 5: Frontend Authentication');
const apiContent = fs.readFileSync('frontend/src/api.ts', 'utf8');
if (apiContent.includes('import { auth } from')) {
  pass('Frontend imports Firebase auth');
} else {
  fail('Frontend missing Firebase auth import');
}

if (apiContent.includes('getAuthToken()')) {
  pass('Frontend has getAuthToken helper');
} else {
  fail('Frontend missing getAuthToken helper');
}

if (apiContent.includes('"Authorization": `Bearer ${token}`')) {
  pass('Frontend sends auth headers');
} else {
  fail('Frontend not sending auth headers');
}

// Check 7: Input validation
console.log('\nCheck 6: Input Validation');
if (serverContent.includes('function validatePhotoId')) {
  pass('Photo ID validation function exists');
} else {
  fail('Photo ID validation function missing');
}

const validateUsages = (serverContent.match(/validatePhotoId\(/g) || []).length;
if (validateUsages >= 4) {
  pass(`Validation used in ${validateUsages} places`);
} else {
  fail(`Validation only used in ${validateUsages} places (expected 4+)`);
}

// Check 8: Duplicate API service removed
console.log('\nCheck 7: Duplicate Files');
if (!fs.existsSync('frontend/src/services/apiService.ts')) {
  pass('Duplicate API service removed');
} else {
  fail('Duplicate API service still exists');
}

// Check 9: Firebase service account exists and is in gitignore
console.log('\nCheck 8: Security');
if (fs.existsSync('firebase-service-account.json')) {
  pass('Firebase service account file exists');
} else {
  warn('Firebase service account file not found - backend will fail to start');
}

const gitignoreContent = fs.readFileSync('.gitignore', 'utf8');
if (gitignoreContent.includes('firebase-service-account.json')) {
  pass('Firebase service account in .gitignore');
} else {
  fail('Firebase service account NOT in .gitignore - SECURITY RISK!');
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('VALIDATION SUMMARY');
console.log('='.repeat(50));
console.log(`✅ Passed: ${CHECKS.passed.length}`);
console.log(`❌ Failed: ${CHECKS.failed.length}`);
console.log(`⚠️  Warnings: ${CHECKS.warnings.length}`);

if (CHECKS.failed.length === 0) {
  console.log('\n🎉 All high-priority fixes validated successfully!');
  console.log('\nNext steps:');
  console.log('1. Backup your database: copy photo-db.sqlite photo-db.sqlite.backup');
  console.log('2. Test backend: npm run server');
  console.log('3. Test frontend: cd frontend && npm run dev');
  console.log('4. Run scan-and-fill-paths.js if you have photos');
  process.exit(0);
} else {
  console.log('\n⚠️  Some checks failed. Please review the output above.');
  process.exit(1);
}

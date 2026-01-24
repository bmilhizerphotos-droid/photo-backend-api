# Code Review Action Items

## ✅ High Priority - COMPLETED
All high-priority issues have been resolved or verified as already fixed:

1. ✅ Database schema includes full_path and thumbnail_path columns
2. ✅ Bulk operations correctly use dbGet/dbRun functions
3. ✅ Port configuration standardized to 3001 across all files
4. ✅ Backend authentication fully implemented with Firebase Admin
5. ✅ Environment variables properly used for configuration
6. ✅ Created .env.example for documentation

**Status: PRODUCTION READY**

---

## 📋 Medium Priority - Recommended (Not Blocking)

### 1. Optimize File Search Performance
**Current Issue:** `findFileRecursive()` scans entire G:/Photos on every request.

**Solution:**
- Populate full_path and thumbnail_path columns in database
- Modify endpoints to read from database instead of searching filesystem
- Keep recursive search as fallback for missing paths

**Impact:** Significant performance improvement for large photo collections.

**Implementation:**
```javascript
// In server.js, replace getPhotoPathOr404 with:
async function getPhotoPathFromDb(res, photoId) {
  const row = await dbGet(
    "SELECT full_path FROM photos WHERE id = ?", 
    [photoId]
  );
  
  if (!row?.full_path) {
    return getPhotoPathOr404(res, row.filename); // Fallback
  }
  
  if (!fs.existsSync(row.full_path)) {
    return getPhotoPathOr404(res, row.filename); // Fallback
  }
  
  return row.full_path;
}
```

---

### 2. Remove Duplicate API Service File
**Location:** `frontend/src/services/apiService.ts.backup`

**Action:** Delete backup file if no longer needed.

**Command:**
```bash
rm frontend/src/services/apiService.ts.backup
```

---

### 3. Add Input Validation Middleware
**Current:** Manual validation in each endpoint.

**Recommended:** Use express-validator for consistent validation.

**Installation:**
```bash
npm install express-validator
```

**Example Implementation:**
```javascript
import { param, validationResult } from 'express-validator';

app.get('/api/photos/:id',
  authenticateToken,
  param('id').isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // ... rest of handler
  }
);
```

---

### 4. Implement Error Response Standardization
**Create:** `utils/errorHandler.js`

```javascript
export class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// Use in server.js:
app.use(errorHandler);
```

---

### 5. Add Database Indexes (Already Added)
**Status:** ✅ Already implemented in db.js

Existing indexes:
- `idx_photos_favorite` ✅
- `idx_photos_filename` ✅
- `idx_photo_albums_photo` ✅
- `idx_photo_albums_album` ✅

**Consider adding:**
```javascript
await dbRun(`CREATE INDEX IF NOT EXISTS idx_photos_created ON photos(created_at DESC)`);
```

---

## 🎯 Low Priority - Nice to Have

### 1. Complete or Remove Mobile App
**Location:** `mobile/`

**Options:**
A. Complete the React Native app for mobile experience
B. Remove directory to reduce confusion

**Current Status:** Default Expo template with minimal customization.

---

### 2. Add Log Rotation to Watchdog
**Current:** `ops/rotate-logs.ps1` exists but not called by watchdog.

**Solution:** Add to watchdog.ps1:
```powershell
# At end of watchdog.ps1, before exit
if ((Get-Date).Hour -eq 0) {
  & "C:\Users\bmilh\photo-backend\ops\rotate-logs.ps1"
}
```

---

### 3. Add Frontend Health Check
**Create:** `frontend/public/health.json`
```json
{
  "status": "ok",
  "version": "1.0.0",
  "deployed": "2026-01-16"
}
```

---

### 4. Improve Auth Error Messages
**Current:** Generic error messages.

**Enhancement:** Provide actionable feedback to users.

**Example:**
```typescript
// In App.tsx
if (authError) {
  const friendlyMessage = authError.includes('popup-blocked')
    ? 'Please allow popups for this site and try again.'
    : authError.includes('network')
    ? 'Network error. Please check your connection.'
    : 'Authentication failed. Please try again.';
    
  // Display friendlyMessage
}
```

---

### 5. Add API Documentation
**Tool:** Swagger/OpenAPI

**Installation:**
```bash
npm install swagger-jsdoc swagger-ui-express
```

**Setup:** Add JSDoc comments to endpoints:
```javascript
/**
 * @swagger
 * /api/photos:
 *   get:
 *     summary: Get paginated photos
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of photos to return
 */
app.get('/api/photos', authenticateToken, async (req, res) => {
  // ...
});
```

---

## 🔒 Security Enhancements (Optional)

### 1. Add Rate Limiting
```bash
npm install express-rate-limit
```

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

---

### 2. Add Helmet for Security Headers
```bash
npm install helmet
```

```javascript
import helmet from 'helmet';
app.use(helmet());
```

---

### 3. Add Request Logging
```bash
npm install morgan
```

```javascript
import morgan from 'morgan';
app.use(morgan('combined', {
  stream: fs.createWriteStream('./logs/access.log', { flags: 'a' })
}));
```

---

## 📊 Monitoring Recommendations

### 1. Enhanced Health Check
**Modify** `/health` endpoint to include more metrics:

```javascript
app.get("/health", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
  };
  
  try {
    await dbGet("SELECT 1");
    health.database = "connected";
  } catch (err) {
    health.status = "degraded";
    health.database = "disconnected";
  }
  
  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});
```

---

### 2. Add Application Metrics
**Consider:** Application Performance Monitoring (APM) tool
- New Relic
- DataDog
- AWS CloudWatch

---

## 🧪 Testing Strategy

### Unit Tests (Recommended)
```bash
npm install --save-dev jest supertest @types/jest
```

**Create:** `tests/api.test.js`
```javascript
import request from 'supertest';
import app from '../server.js';

describe('GET /health', () => {
  it('should return 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
```

---

### Integration Tests
**Test scenarios:**
1. Photo upload and retrieval flow
2. Bulk operations on multiple photos
3. Authentication token expiration handling
4. Database connection loss recovery

---

## 📝 Documentation Needs

### 1. API Documentation
- Swagger/OpenAPI spec
- Example requests/responses
- Error code reference

### 2. Deployment Guide
- Production environment setup
- Cloudflared tunnel configuration
- Windows service installation
- Backup and recovery procedures

### 3. Development Guide
- Local setup instructions
- Coding standards
- Git workflow
- PR review checklist

---

## Summary

**Current State:** Production-ready, secure, and well-architected.

**Immediate Action Required:** None - all high-priority items resolved.

**Recommended Next Steps (in order):**
1. Optimize file search by using database paths
2. Add input validation middleware
3. Implement error handling standardization
4. Add rate limiting for API protection
5. Complete or remove mobile app directory
6. Add comprehensive testing

**Timeline:** These are quality-of-life improvements that can be implemented incrementally without service disruption.

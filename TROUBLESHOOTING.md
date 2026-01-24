# Troubleshooting "Loading more..." Issue

## Current Status
- ✅ Backend running on localhost:3001
- ✅ Backend health check responds: OK
- ✅ Cloudflared tunnel service running
- ✅ Cloudflare Access removed from API
- ❌ Frontend stuck on "Loading more..."

## Step 1: Check Browser Console

1. Open https://photos.milhizerfamilyphotos.org
2. Press **F12** to open Developer Tools
3. Click **Console** tab
4. Look for error messages (red text)

### Common Errors You Might See:

**Error 1: "Failed to fetch photos: 401"**
- **Cause:** API is rejecting requests due to missing authentication token
- **Fix:** This means Firebase authentication isn't working properly

**Error 2: "Failed to fetch photos: 403 Forbidden"**
- **Cause:** Firebase token is invalid or expired
- **Fix:** Sign out and sign in again

**Error 3: "CORS policy blocked"**
- **Cause:** API not allowing requests from frontend domain
- **Fix:** Need to update CORS configuration

**Error 4: "Not authenticated"**
- **Cause:** No user logged in
- **Fix:** Make sure you see the Google Sign-In button and use it

## Step 2: Check Network Tab

1. In Developer Tools, click **Network** tab
2. Refresh the page (F5)
3. Look for the request to `/api/photos`
4. Click on it to see details

### What to Check:

- **Status Code:** Should be 200 (OK)
- **Request Headers:** Should include `Authorization: Bearer <token>`
- **Response:** Should have JSON array of photos

### Common Issues:

**Status: 401 Unauthorized**
```json
{"error": "Unauthorized: No token provided"}
```
**Solution:** Frontend isn't sending Firebase token

**Status: 403 Forbidden**
```json
{"error": "Forbidden: Invalid token"}
```
**Solution:** Firebase token is invalid - sign out and back in

**Status: 500 Internal Server Error**
```json
{"error": "Database error"}
```
**Solution:** Backend database issue - check backend logs

## Step 3: Verify You're Signed In

The app requires Firebase authentication. Look for:

1. **Before Sign In:** You should see a blue "Sign In with Google" button
2. **After Sign In:** You should see your name and photo in the header

If you're **not** seeing the sign-in screen:
- The authentication state might be cached incorrectly
- Clear browser cache and cookies for the site
- Try in an incognito/private window

## Step 4: Check Backend Logs

Open the backend terminal window (or check the service logs):

**Location:** `C:\Users\bmilh\photo-backend\logs\backend.out.log`

Look for recent errors:
```bash
# In PowerShell:
Get-Content C:\Users\bmilh\photo-backend\logs\backend.out.log -Tail 50
```

### What to Look For:

- `❌` symbols indicate errors
- Token verification failures
- Database connection errors
- CORS errors

## Step 5: Test API Directly

### Test 1: Health Check (No Auth)
```powershell
Invoke-WebRequest -Uri "https://api.milhizerfamilyphotos.org/health" -UseBasicParsing
```
**Expected:** Status 200, `{"status":"ok"}`

### Test 2: Photos Endpoint (With Auth - will fail without token)
```powershell
Invoke-WebRequest -Uri "https://api.milhizerfamilyphotos.org/api/photos?limit=1" -UseBasicParsing
```
**Expected:** Status 401, `{"error":"Unauthorized: No token provided"}`
**This is correct** - API requires authentication

## Quick Fixes to Try

### Fix 1: Clear Browser Cache
1. Press **Ctrl+Shift+Delete**
2. Select "Cookies and site data" and "Cached images and files"
3. Select "All time"
4. Click "Clear data"
5. Refresh the page

### Fix 2: Try Incognito Mode
1. Press **Ctrl+Shift+N** (Chrome) or **Ctrl+Shift+P** (Firefox)
2. Go to https://photos.milhizerfamilyphotos.org
3. Try signing in

This tests if the issue is related to cached data.

### Fix 3: Restart Backend Service
```powershell
Restart-Service -Name MilhizerPhotoBackend
```

Wait 10 seconds, then refresh the frontend.

### Fix 4: Check CORS Configuration

The backend might need to explicitly allow your production frontend domain.

**Check:** `C:\Users\bmilh\photo-backend\server.js`

Look for this section:
```javascript
const allowedOrigins = [
  "https://photos.milhizerfamilyphotos.org",
  "http://localhost:5173",
  // ... other origins
];
```

Make sure `https://photos.milhizerfamilyphotos.org` is in the list.

## Expected Behavior After Cloudflare Access Removal

1. Visit https://photos.milhizerfamilyphotos.org
2. See your photo app interface immediately (no Cloudflare login)
3. See "Sign In with Google" button if not logged in
4. Click button → Google login popup
5. After login → see photos loading

## What to Share for Help

If still stuck, share these details:

1. **Browser Console Errors** (screenshot or copy-paste)
2. **Network Tab** - status code of `/api/photos` request
3. **Are you seeing the Sign In button?** Yes/No
4. **Backend logs** - last 20 lines from `backend.out.log`

Run this to get backend logs:
```powershell
Get-Content C:\Users\bmilh\photo-backend\logs\backend.out.log -Tail 20
```

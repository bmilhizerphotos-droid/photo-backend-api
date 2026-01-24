# Image Modal Debug Instructions

## Step 1: Check Console Errors
1. Open browser (Chrome/Edge)
2. Press F12 to open Developer Tools
3. Click **Console** tab
4. Click on any photo thumbnail
5. Look for RED error messages

Common errors to look for:
- "Failed to load resource"
- "CORS policy"
- "CSP violation"
- "Image decode failed"

## Step 2: Inspect the Image Element
1. Keep Developer Tools open (F12)
2. Click the **Elements** tab (or right-click modal → Inspect)
3. Find the `<img>` tag inside the modal
4. Check if it has a `src` attribute with a full URL

Should look like:
```html
<img src="https://photos.milhizerfamilyphotos.org/display/94?token=eyJ..." class="...">
```

## Step 3: Check Image in Network Tab
1. Open F12 → **Network** tab
2. Click on a photo
3. Find the `/display/ID` request
4. Click on it
5. Go to **Preview** tab - do you see the image?
6. Go to **Response** tab - do you see binary data or text?

## Step 4: Test Direct Image URL
1. Click on a photo to open modal
2. Right-click in the black area where image should be
3. Select "Inspect Element"
4. Find the `<img>` tag
5. Right-click the `src` URL → "Open in new tab"
6. Does the image load in the new tab?

## Step 5: Check for Hidden Images
With modal open and Developer Tools open:
1. Click **Elements** tab
2. Find the `<img>` element
3. Look at the **Styles** panel on the right
4. Check if any of these are set:
   - `display: none`
   - `opacity: 0`
   - `visibility: hidden`
   - `width: 0` or `height: 0`

## What to Report Back

Please share:
1. **Console errors** (screenshot or copy-paste)
2. **Does the `<img>` tag have a `src`?** (yes/no and show the URL if yes)
3. **Does image open in new tab?** (yes/no)
4. **Network Preview tab** - shows image or error?
5. **Any CSS hiding the image?** (display, opacity, visibility values)

This will tell us exactly what's broken!

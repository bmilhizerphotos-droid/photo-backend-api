# Family Photo Gallery Backend API

A modern photo gallery backend API built with Node.js, Express, and SQLite. Features a React frontend for browsing family photos with thumbnail generation and pagination.

## Features

- 📸 **Photo Gallery**: Browse family photos with automatic thumbnail generation
- 🔍 **Pagination**: Efficient loading of large photo collections
- 🖼️ **Thumbnail Support**: Automatic thumbnail generation and serving
- 🌐 **CORS Enabled**: Configured for both development and production
- 📱 **Responsive**: Works on desktop and mobile devices
- 🔒 **Secure**: Proper CORS and security headers

## Tech Stack

- **Backend**: Node.js, Express.js, SQLite
- **Frontend**: React, TypeScript, Vite
- **Database**: SQLite with custom photo indexing
- **Styling**: Tailwind CSS

## Quick Start

### Prerequisites
- Node.js 18+
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/photo-backend-api.git
   cd photo-backend-api
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd frontend && npm install && cd ..
   ```

3. **Set up the database**
   ```bash
   # The database will be created automatically when you run the server
   # If you have photos to index, run the photo scanning script
   node scan-and-fill-paths.js
   ```

4. **Start the development servers**
   ```bash
   # Terminal 1: Backend API
   npm run server

   # Terminal 2: Frontend React app
   cd frontend && npm run dev
   ```

5. **Open your browser**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3000

## API Endpoints

### Photos
- `GET /api/photos?limit=50&offset=0` - Get paginated photos
- `GET /thumbnails/:id` - Get photo thumbnail
- `GET /photos/:id` - Get full-size photo
- `GET /health` - Health check

### Response Format
```json
{
  "id": 1,
  "filename": "photo.jpg",
  "thumbnailUrl": "/thumbnails/1",
  "fullUrl": "/photos/1"
}
```

## Project Structure

```
photo-backend-api/
├── db.js                 # Database connection
├── server.js             # Express server with API routes
├── scan-and-fill-paths.js # Photo indexing script
├── frontend/             # React frontend
│   ├── src/
│   │   ├── App.tsx       # Main React component
│   │   ├── api.ts        # API client functions
│   │   └── main.tsx      # React entry point
│   ├── package.json
│   └── vite.config.ts
├── photo-db.sqlite       # SQLite database (auto-generated)
├── logs/                 # Server logs
└── README.md
```

## Configuration

### Photo Directory
Update the photo directory path in `server.js`:
```javascript
const BASE_PHOTO_DIR = "G:/Photos"; // Change this to your photo folder
```

### CORS Origins
Update allowed origins in `server.js` for production:
```javascript
const allowedOrigins = [
  'https://yourdomain.com',  // Production
  'http://localhost:5173',   // Development
];
```

## Development

### Available Scripts
- `npm run server` - Start the backend API server
- `npm run dev` - Start frontend development server (in frontend/ directory)
- `npm run build` - Build frontend for production

### Database Management
- Photos are automatically indexed into SQLite
- Thumbnails are generated on-demand
- Database file: `photo-db.sqlite`

## Deployment

### Backend (Railway, Heroku, etc.)
1. Set `NODE_ENV=production`
2. Configure photo directory path
3. Update CORS origins for your domain
4. Deploy the server

### Frontend (Netlify, Vercel, etc.)
1. Build: `npm run build`
2. Update API base URL for production
3. Deploy the `dist/` folder

## Security Notes

- SQLite database contains only file paths and metadata
- No sensitive data is stored
- CORS is properly configured for your domains
- Service account keys are excluded from version control

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is private/family use only.